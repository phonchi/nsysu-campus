#!/usr/bin/env python3
"""Derive schematic portals from original floor polygons; never changes source outlines.

Only parallel, overlapping boundary spans support portals. Nearby spans may differ
by at most max_gap metres (wall/drawing thickness); point/corner contacts never
become doors. Reachability is geometric, not a claim of real-life accessible routes.
"""
from __future__ import annotations
import argparse, hashlib, heapq, json, math
from collections import defaultdict, deque
from pathlib import Path
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union, nearest_points
from shapely.strtree import STRtree


def _polygons(g):
    if g.geom_type == 'Polygon': return [g]
    return [p for child in getattr(g, 'geoms', []) for p in _polygons(child)]


def _segments(poly):
    result=[]
    for ring in [poly.exterior,*poly.interiors]:
        coords=list(ring.coords)
        # A straight shared wall can contain redundant source vertices.
        simple=LineString(coords).simplify(.002,preserve_topology=True)
        pts=list(simple.coords)
        for a,b in zip(pts,pts[1:]):
            if math.dist(a,b)>.02:result.append(LineString([a,b]))
    return result


def _point(p):return [round(float(p[0]),5),round(float(p[1]),5)]


def _span_candidate(sa,sb,width,gap,preferred,preferred_gap=None,sample_fraction=.5):
    a,b=list(sa.coords);c,d=list(sb.coords);length=math.dist(a,b);other=math.dist(c,d)
    if length<width+.03 or other<width+.03:return None
    ux,uy=(b[0]-a[0])/length,(b[1]-a[1])/length
    vx,vy=(d[0]-c[0])/other,(d[1]-c[1])/other
    if abs(ux*vx+uy*vy)<.999: return None
    ts=[(q[0]-a[0])*ux+(q[1]-a[1])*uy for q in [c,d]]
    low=max(0,min(ts));high=min(length,max(ts))
    if high-low<width+.03:return None
    lo,hi=low+width/2+.015,high-width/2-.015
    mid=lo+(hi-lo)*sample_fraction
    best_pref=None
    for ref in preferred:
        target=Point(ref['position'])
        ref_gap=gap if preferred_gap is None else preferred_gap
        if sa.distance(target)>ref_gap+.06 or sb.distance(target)>ref_gap+.06:continue
        t=(target.x-a[0])*ux+(target.y-a[1])*uy
        if lo-.015<=t<=hi+.015:
            best_pref=ref;mid=max(lo,min(hi,t));break
    pa=(a[0]+ux*mid,a[1]+uy*mid)
    pb=sb.interpolate(sb.project(Point(pa)))
    if Point(pa).distance(pb)>gap+1e-6:return None
    # A doorway's complete width must have contact, not just its centre.
    for offset in [-width/2,width/2]:
        if sb.distance(Point(pa[0]+ux*offset,pa[1]+uy*offset))>gap+.01:return None
    pb=(pb.x,pb.y);position=((pa[0]+pb[0])/2,(pa[1]+pb[1])/2)
    return {'position':position,'a':pa,'b':pb,'span':high-low,'gap':math.dist(pa,pb),'preferred':best_pref,
            'tangent':[ux,uy],'width':width}


def _inside_clearance(poly,core,position,tangent,radius=.36):
    best=None
    for sign in [-1,1]:
        normal=(-tangent[1]*sign,tangent[0]*sign)
        near=Point(position[0]+normal[0]*.07,position[1]+normal[1]*.07)
        if not poly.buffer(.001).covers(near):continue
        if core.is_empty:
            check={'passed':False,'insidePosition':None,'inwardNormal':_point(normal),'distanceToRoomCore':None,'coreRadius':radius}
        else:
            inside=nearest_points(core,Point(position))[0]
            gap=inside.distance(Point(position))
            normal_probe=Point(position[0]+normal[0]*radius,position[1]+normal[1]*radius)
            # A nearby deep lobe may not validate a door placed on a thin finger.
            normal_gap=core.distance(normal_probe)
            ok=gap<=1.2 and normal_gap<.05 and poly.buffer(.002).covers(LineString([position,(inside.x,inside.y)]))
            check={'passed':bool(ok),'insidePosition':_point((inside.x,inside.y)),'inwardNormal':_point(normal),'distanceToRoomCore':round(gap,5),'normalProbeCoreGap':round(normal_gap,5),'coreRadius':radius}
        if check['passed']:return check
        if best is None:best=check
    return best or {'passed':False,'insidePosition':None,'inwardNormal':None,'distanceToRoomCore':None,'coreRadius':radius}


def _reviewed_override(entry,rooms,cores,vertical_obstacles):
    a,b=entry.get('roomId'),entry.get('neighborRoomId')
    spec=entry.get('suggestedPortal',{})
    if not entry.get('sourceReview') or not all(r in rooms for r in [a,b]):return None,'missing-evidence-or-room'
    positions=spec.get('perRoomPosition',{});width=spec.get('width',0);depth=.65
    if width<.9 or width>1.2 or not all(r in positions for r in [a,b]):return None,'invalid-reviewed-portal-specification'
    pa,pb=positions[a],positions[b];dx,dz=pb[0]-pa[0],pb[1]-pa[1];gap=math.hypot(dx,dz)
    if gap<.001 or gap>1.3:return None,'reviewed-wall-gap-out-of-bounds'
    ux,uz=dx/gap,dz/gap;tx,tz=-uz,ux;center=((pa[0]+pb[0])/2,(pa[1]+pb[1])/2)
    band=Polygon([(center[0]+sx*ux*(gap/2+depth)+sz*tx*width/2,center[1]+sx*uz*(gap/2+depth)+sz*tz*width/2) for sx,sz in [(-1,-1),(-1,1),(1,1),(1,-1)]])
    standing={};checks={}
    for rid in [a,b]:
        core=cores[rid]
        if core.is_empty:return None,f'no-room-body-core:{rid}'
        point=nearest_points(core,Point(positions[rid]))[0];segment=LineString([positions[rid],(point.x,point.y)])
        if segment.length>1.2:return None,f'core-more-than-1.2m-away:{rid}'
        outside=segment.difference(rooms[rid].buffer(.002))
        if outside.difference(band.buffer(.002)).length>.005:return None,f'trace-correction-exceeds-reviewed-door-band:{rid}'
        if not vertical_obstacles.is_empty and segment.intersection(vertical_obstacles).length>.005:return None,'crosses-vertical-service'
        for other,poly in rooms.items():
            if other not in [a,b] and segment.intersection(poly.buffer(-.002)).length>.01:return None,f'crosses-unreviewed-room:{other}'
        standing[rid]=_point((point.x,point.y))
        checks[rid]={'passed':True,'insidePosition':standing[rid],'distanceToRoomCore':round(segment.length,5),'traceCorrection':outside.length>.005,'reviewedDoorBandOnly':True}
    return {'nodes':[a,b],'position':center,'a':pa,'b':pb,'span':width,'gap':gap,'preferred':None,'tangent':[tx,tz],'width':width,'insideChecks':checks,'clearancePositions':standing,'basis':'schematic','preserved':False,'rank':-1,'sourceReview':entry['sourceReview'],'cutDepth':depth,'traceCorrection':{'basis':'schematic','note':entry.get('geometryWarning','Source-reviewed door-leaf tracing artifact; correction limited to this opening band.'),'parallelLeafLines':entry.get('parallelLeafLines',[])}},None


def plan_floor_access(floor:dict,portal_width:float=1.2,max_gap:float=.4,service_stair:list|None=None,clearance:float=.42,gallery_width:float=1.4,portal_overrides:list|None=None,_core_preferences:dict|None=None,_allow_core_fallback:bool=True,vertical_entry:list|None=None)->dict:
    """Pure function, no I/O. Coordinates stay in the original floor-local frame."""
    fid=floor['id'];issues=[];rooms={};sources={};invalid=[]
    result={'floorId':fid,'portals':[],'primaryPortalByRoom':{},'entry':None}
    outline=Polygon(floor.get('outline',[]),floor.get('holes',[]))
    if not outline.is_valid or outline.area<.1:
        result['report']={'status':'invalid-outline','issues':[{'type':'invalid-outline'}],'reachableRoomCount':0,'roomCount':len(floor.get('rooms',[]))};return result
    outer_walk=Polygon(outline.exterior).buffer(gallery_width,join_style=3)
    planning_outline=Polygon(outer_walk.exterior,floor.get('holes',[]))
    result['walkOutline']=[_point(p) for p in list(outer_walk.exterior.coords)[:-1]]
    result['walkOutlineBasis']='schematic'
    result['walkOutlineNote']=f'Virtual exterior gallery widened by {gallery_width:g} illustrative metres; source outline, room polygons and holes unchanged.'
    for room in floor.get('rooms',[]):
        rid=room['id'];poly=Polygon(room.get('polygon',[]))
        if not poly.is_valid or poly.area<.02:
            invalid.append(rid);issues.append({'type':'invalid-room-polygon','roomId':rid});continue
        if rid in rooms:raise ValueError(f'duplicate room id {rid}')
        rooms[rid]=poly;sources[rid]=room
        outside=poly.difference(outline).area
        if outside>.02:issues.append({'type':'room-outside-floor','roomId':rid,'outsideArea':round(outside,5)})
    verticals=[]
    for service in floor.get('verticalServices',[]):
        polygon=Polygon(service.get('polygon',[]))
        if polygon.is_valid and not polygon.is_empty:verticals.append(polygon)
        else:issues.append({'type':'invalid-vertical-service','id':service.get('id')})
    vertical_obstacles=unary_union(verticals)
    room_cores={rid:poly.buffer(-.36) for rid,poly in rooms.items()}
    room_core_radii={rid:.36 for rid in rooms}
    for rid,core in room_cores.items():
        if core.is_empty:
            smaller=rooms[rid].buffer(-.30)
            if not smaller.is_empty:
                room_cores[rid]=smaller;room_core_radii[rid]=.30
                issues.append({'type':'small-room-core-radius-reduced','roomId':rid,'radius':.30,'note':'Schematic standing position only; rendered capsule traversal still requires validation.'})
    room_core_choices={};room_components={}
    for rid,core in list(room_cores.items()):
        components=sorted(_polygons(core),key=lambda polygon:-polygon.area)
        if len(components)<=1:continue
        room_components[rid]=components
        door=sources[rid].get('door',{})
        preserve=door.get('basis')=='map-derived' and door.get('position')
        selected=min(range(len(components)),key=lambda n:components[n].distance(Point(door['position']))) if preserve else (_core_preferences or {}).get(rid,0)
        room_cores[rid]=components[selected]
        room_core_choices[rid]={'componentCount':len(components),'componentAreas':[round(part.area,5) for part in components],'selectedComponent':selected,'selectionBasis':'preserve-source-map-door' if preserve else 'largest-body-core','selectedBounds':list(components[selected].bounds)}
    free=planning_outline.difference(unary_union([*rooms.values(),*verticals]))
    raw_free_parts=[p for p in _polygons(free) if p.area>.02]
    cores=[p for p in _polygons(free.buffer(-clearance)) if p.area>.002] if clearance>0 else raw_free_parts
    # Deliberately retain each eroded core separately: union would reconnect thin necks.
    restored=[]
    for core in cores:
        if clearance<=0:restored.append((core,core));continue
        parts=_polygons(core.buffer(clearance).intersection(free))
        # Buffering may touch a disconnected sliver on the other side of a thin wall.
        # Keep only the restored polygon containing this actual connected core.
        if parts:
            restored.append((max(parts,key=lambda p:p.intersection(core).area),core))
    restored.sort(key=lambda item:-item[0].area)
    frees=[p for p,core in restored]
    core_by_free={f'@free-{i:03}':core for i,(p,core) in enumerate(restored)}
    nodes={**rooms,**{f'@free-{i:03}':p for i,p in enumerate(frees)}}
    free_ids=[n for n in nodes if n.startswith('@free-')]
    annotations=floor.get('mapAnnotations',[])
    roots=[]
    for node in free_ids:
        poly=nodes[node];score=sum(a.get('kind') in ['corridor','entrance','stairs'] and poly.distance(Point(a['position']))<.15 for a in annotations if a.get('position'))
        roots.append((score,poly.area,node))
    if not roots:
        result['report']={'status':'no-public-free-space','roomCount':len(rooms),'reachableRoomCount':0,'unreachableRoomIds':list(rooms),'issues':issues+[{'type':'no-public-free-space'}]};return result
    _,_,root=max(roots)
    root_poly=nodes[root]
    entry_refs=[a for a in annotations if a.get('kind') in ['entrance','corridor'] and a.get('position') and root_poly.distance(Point(a['position']))<.4]
    entry=nearest_points(root_poly,Point(entry_refs[0]['position']))[0] if entry_refs else root_poly.representative_point()
    result['entry']=_point((entry.x,entry.y))
    segs={n:_segments(poly) for n,poly in nodes.items()}
    trees={n:STRtree(s) for n,s in segs.items()};node_names=list(nodes);node_tree=STRtree([nodes[n] for n in node_names]);candidates=[];overlaps=[];blocked_manual={};contact_diagnostics=defaultdict(lambda:{'geometricContactSamples':0,'ownInsideRejected':0,'otherNodeRejected':0})
    preferred={}
    for rid,room in sources.items():
        door=room.get('door',{});manual=door.get('basis')=='map-derived' or room.get('reviewStatus','').startswith('outline-checked') or '人工' in door.get('note','')
        if door.get('position') and manual:
            preferred[rid]={'roomId':rid,'position':door['position'],'basis':door.get('basis','schematic'),'manual':True,'width':door.get('width',portal_width)}
    for i,na in enumerate(node_names):
        for j in node_tree.query(nodes[na],predicate='dwithin',distance=max_gap+.001):
            j=int(j)
            if j<=i:continue
            nb=node_names[j]
            if na not in rooms and nb not in rooms:continue
            overlap=nodes[na].intersection(nodes[nb]).area
            if overlap>.02:
                if na in rooms and nb in rooms:overlaps.append({'roomIds':[na,nb],'overlapArea':round(overlap,5)})
                continue
            refs=sorted([preferred[n] for n in [na,nb] if n in preferred],key=lambda p:p['basis']!='map-derived')
            contact_gap=min(max_gap,.02) if clearance>0 and (na not in rooms or nb not in rooms) else max_gap
            # Query segment proximity spatially, avoiding O(vertices_a * vertices_b).
            aa,bb=(na,nb) if len(segs[na])<=len(segs[nb]) else (nb,na)
            found=[]
            for sa in segs[aa]:
                if sa.length<portal_width+.03:continue
                for idx in trees[bb].query(sa,predicate='dwithin',distance=max_gap+.001):
                    candidate_width=min([portal_width]+[ref.get('width',portal_width) for ref in refs])
                    for sample,refs_for_sample in [(.5,refs),(.5,[]),(.2,[]),(.8,[]),(.05,[]),(.95,[])]:
                        contact=_span_candidate(sa,segs[bb][int(idx)],candidate_width,contact_gap,refs_for_sample,preferred_gap=max_gap,sample_fraction=sample)
                        if not contact:continue
                        if aa!=na:contact['a'],contact['b']=contact['b'],contact['a']
                        line=LineString([contact['a'],contact['b']])
                        if not planning_outline.buffer(.015).covers(line):continue
                        if not vertical_obstacles.is_empty and line.intersection(vertical_obstacles).length>.005:continue
                        blocked=False
                        if line.length>.002:
                            for third in node_tree.query(line):
                                nc=node_names[int(third)]
                                if nc in rooms and nc not in [na,nb] and nodes[nc].intersection(line).length>.015:blocked=True;break
                        if blocked:continue
                        checks={rid:_inside_clearance(rooms[rid],room_cores[rid],contact['a'] if rid==na else contact['b'],contact['tangent'],room_core_radii[rid]) for rid in [na,nb] if rid in rooms}
                        contact['insideChecks']=checks
                        standing={rid:check['insidePosition'] for rid,check in checks.items() if check['passed']}
                        for node in [na,nb]:
                            if node in rooms:continue
                            wall_point=contact['a'] if node==na else contact['b']
                            core_point=nearest_points(core_by_free[node],Point(wall_point))[0]
                            segment=LineString([wall_point,(core_point.x,core_point.y)])
                            if segment.length<=1.2 and nodes[node].buffer(.002).covers(segment):standing[node]=_point((core_point.x,core_point.y))
                        contact['clearancePositions']=standing
                        ref=contact['preferred']
                        for rid,check in checks.items():
                            diagnostic=contact_diagnostics[rid];diagnostic['geometricContactSamples']+=1
                            if not check['passed']:diagnostic['ownInsideRejected']+=1
                            elif not all(node in standing for node in [na,nb]):diagnostic['otherNodeRejected']+=1
                        if not all(check['passed'] for check in checks.values()) or not all(node in standing for node in [na,nb]):
                            if ref and ref['basis']=='map-derived':
                                blocked_manual[ref['roomId']]={'nodes':[na,nb],**contact,'position':ref['position'],'preferred':ref}
                            continue
                        rank=0 if ref and ref['basis']=='map-derived' else 1 if ref else 2
                        found.append((rank,contact['gap'],-contact['span'],contact))
            if not found:continue
            contact=min(found,key=lambda x:x[:3])[3];ref=contact['preferred']
            # Keep provenance honest: relocated/projection-adjusted doors become schematic.
            preserved=bool(ref and math.dist(ref['position'],contact['position'])<=max_gap+.06)
            basis='map-derived' if preserved and ref['basis']=='map-derived' else 'schematic'
            if preserved:
                contact['sourceOffset']=math.dist(ref['position'],contact['position'])
                contact['position']=tuple(ref['position'])
            candidates.append({'nodes':[na,nb],**contact,'basis':basis,'preserved':preserved,'rank':0 if basis=='map-derived' else 1 if ref else 2})
    if overlaps:issues.extend({'type':'overlapping-room-polygons',**o} for o in overlaps)
    reviewed_count=0
    for entry_override in [*(portal_overrides or []),*floor.get('virtualPortalOverrides',[])]:
        candidate,error=_reviewed_override(entry_override,rooms,room_cores,vertical_obstacles)
        if error:
            issues.append({'type':'reviewed-portal-override-rejected','roomId':entry_override.get('roomId'),'reason':error,'sourceReview':entry_override.get('sourceReview')})
        else:candidates.append(candidate);reviewed_count+=1
    adjacency=defaultdict(list)
    for index,c in enumerate(candidates):
        a,b=c['nodes'];weight=c['rank']*.3+1+c['gap']*.1
        adjacency[a].append((weight,b,index));adjacency[b].append((weight,a,index))
    # Prim tree retains original room geometry; validated manual portals are kept even if redundant.
    visited={root};selected=set();parents={};queue=[]
    for weight,n,index in adjacency[root]:heapq.heappush(queue,(weight,root,n,index))
    while queue:
        weight,parent,node,index=heapq.heappop(queue)
        if node in visited:continue
        visited.add(node);selected.add(index);parents[node]=index
        for w,n,edge in adjacency[node]:
            if n not in visited:heapq.heappush(queue,(w,node,n,edge))
    for index,c in enumerate(candidates):
        if c['preferred'] and c['preserved']:selected.add(index)
    # The route endpoint must be on the exterior, not at a corridor centroid.
    # An outer room may be the only honest entrance when rooms wrap the public space.
    target=service_stair or [(outline.bounds[0]+outline.bounds[2])/2,outline.bounds[3]+3]
    exterior=Polygon(planning_outline.exterior)
    outer_segments=_segments(exterior)
    outer_tree=STRtree(outer_segments)
    def exterior_contacts(node):
        found=[]
        for sa in segs[node]:
            for idx in outer_tree.query(sa,predicate='dwithin',distance=max_gap+.001):
                sb=outer_segments[int(idx)]
                contact=_span_candidate(sa,sb,portal_width,max_gap,[])
                if not contact:continue
                a,b=list(sa.coords);length=sa.length;ux=(b[0]-a[0])/length;uy=(b[1]-a[1])/length
                tt=max(portal_width/2+.015,min(length-portal_width/2-.015,(target[0]-a[0])*ux+(target[1]-a[1])*uy))
                preferred_position=[a[0]+ux*tt,a[1]+uy*tt]
                preferred_contact=_span_candidate(sa,sb,portal_width,max_gap,[{'position':preferred_position,'basis':'schematic'}])
                if preferred_contact:contact=preferred_contact
                # The exposed point uses the original outer boundary projection.
                outside=contact['b'];connection=LineString([outside,target])
                if not planning_outline.covers(Point(target)) and connection.intersection(planning_outline.buffer(-.015)).length>.025:continue
                core=core_by_free[node] if node not in rooms else room_cores[node]
                if core.is_empty:continue
                inside=nearest_points(core,Point(outside))[0]
                approach=LineString([outside,(inside.x,inside.y)])
                if approach.length>1.2 or not nodes[node].buffer(.005).covers(approach):continue
                contact['entryClearancePosition']=_point((inside.x,inside.y))
                found.append((math.dist(outside,target),node,contact))
        return found
    exterior_options=[]
    if vertical_entry is not None:
        # Storeys off the ground are entered from an interior stair landing, never
        # through a virtual exterior opening.
        landing=Point(vertical_entry);reach=landing.buffer(.75);overlap=sorted(((nodes[n].intersection(reach).area,n) for n in free_ids),reverse=True);entry_node=overlap[0][1] if overlap and overlap[0][0]>.05 else None
        if entry_node in visited:
            stand=nearest_points(core_by_free[entry_node],landing)[0]
            result['entry']=_point(vertical_entry);result['entryNodeId']=entry_node;result['entryClearancePosition']=_point((stand.x,stand.y));result['entryKind']='interior-stair-landing'
        else:
            result['entry']=None;issues.append({'type':'stair-landing-not-in-public-root','position':_point(vertical_entry),'freeNode':entry_node})
    for node in (sorted(visited) if vertical_entry is None else []):
        if node not in rooms:exterior_options.extend(exterior_contacts(node))
    if not exterior_options and vertical_entry is None:
        for rid in rooms:
            if rid in visited:exterior_options.extend(exterior_contacts(rid))
    if exterior_options:
        _,entry_node,contact=min(exterior_options,key=lambda p:p[0])
        result['entry']=_point(contact['b'])
        pid=f'{fid}-entry'
        result['entryPortalId']=pid
        result['entryNodeId']=entry_node
        result['entryClearancePosition']=contact['entryClearancePosition']
        entry_portal={'id':pid,'position':_point(contact['position']),'width':portal_width,
            'roomIds':[entry_node] if entry_node in rooms else [],'nodeIds':['@outside',entry_node],
            'basis':'schematic','kind':'exterior-entry','clearancePositions':{entry_node:contact['entryClearancePosition']},'tangent':_point(contact['tangent']),
            'perRoomPosition':{entry_node:_point(contact['a'])} if entry_node in rooms else {},
            'gap':round(contact['gap'],5),'sharedSpan':round(contact['span'],5)}
        result['portals'].append(entry_portal)
        if entry_node in rooms:result['entryRoomId']=entry_node
    elif vertical_entry is None:
        result['entry']=None
        issues.append({'type':'no-width-qualified-exterior-entry','reason':'neither public root nor a root-connected room shares an unobstructed exterior wall span'})
    portal_ids={}
    for index in sorted(selected):
        c=candidates[index];pid=f'{fid}-portal-{len(result["portals"])+1:03}';portal_ids[index]=pid
        room_ids=[n for n in c['nodes'] if n in rooms]
        portal={'id':pid,'position':_point(c['position']),'width':c['width'],'roomIds':room_ids,
            'nodeIds':c['nodes'],'basis':c['basis'],'gap':round(c['gap'],5),'sharedSpan':round(c['span'],5),
            'tangent':_point(c['tangent']),'insideClearanceChecks':c['insideChecks'],'clearancePositions':c['clearancePositions'],
            'perRoomPosition':{n:_point(c['a'] if n==c['nodes'][0] else c['b']) for n in room_ids}}
        if c.get('sourceReview'):
            portal.update({key:c[key] for key in ['sourceReview','cutDepth','traceCorrection']})
        if c['preferred']:portal['preferredDoorRoomId']=c['preferred']['roomId'];portal['sourceDoorPreserved']=c['preserved'];portal['sourceDoorProjectionOffset']=round(c.get('sourceOffset',0),5)
        result['portals'].append(portal)
    for rid,c in blocked_manual.items():
        if any(p.get('preferredDoorRoomId')==rid and p.get('sourceDoorPreserved') for p in result['portals']):continue
        ref=c['preferred'];room_ids=[n for n in c['nodes'] if n in rooms]
        result['portals'].append({'id':f'{fid}-source-door-{rid}','position':_point(ref['position']),'width':ref['width'],'roomIds':room_ids,'nodeIds':c['nodes'],'basis':'map-derived','sourceDoorPreserved':True,'preferredDoorRoomId':rid,'insideClearanceChecks':c['insideChecks'],'clearancePositions':c['clearancePositions'],'traversableProposal':False,'perRoomPosition':{n:_point(c['a'] if n==c['nodes'][0] else c['b']) for n in room_ids}})
        issues.append({'type':'source-door-inside-clearance-insufficient','roomId':rid,'sourcePosition':ref['position'],'checks':c['insideChecks'],'note':'Source centre/width preserved; excluded from planning reachability edges.'})
    for rid in rooms:
        chosen=parents.get(rid)
        trusted=[i for i in selected if rid in candidates[i]['nodes'] and candidates[i]['basis']=='map-derived']
        if trusted:chosen=trusted[0]
        if chosen is not None:result['primaryPortalByRoom'][rid]=portal_ids[chosen]
    unreachable=[n for n in rooms if n not in visited]
    for rid in unreachable:
        issues.append({'type':'unreachable-room','roomId':rid,'reason':'no-width-qualified-boundary-contact' if not adjacency[rid] else 'island-disconnected-from-public-root','candidateContactCount':len(adjacency[rid]),'contactDiagnostics':contact_diagnostics[rid],
            'roomArea':round(rooms[rid].area,5),'roomBounds':list(rooms[rid].bounds),
            'nearestRestoredFreeDistance':round(min(rooms[rid].boundary.distance(nodes[n]) for n in free_ids),5),
            'nearestBodyCoreDistance':round(min(rooms[rid].boundary.distance(core_by_free[n]) for n in free_ids),5)})
    preserved_rooms={candidates[i]['preferred']['roomId'] for i in selected if candidates[i]['preferred'] and candidates[i]['preserved']}
    preserved_rooms.update(blocked_manual)
    for rid in preferred:
        if rid not in preserved_rooms:issues.append({'type':'manual-door-not-preserved','roomId':rid,'sourcePosition':preferred[rid]['position'],'reason':'source point lacks a width-qualified shared wall span; any alternative is schematic'})
    # Save island membership, including disconnected free-space components, for repair.
    pending=set(nodes)-visited;islands=[]
    while pending:
        start=min(pending);pending.remove(start);component=[start];todo=[start]
        while todo:
            for _,n,_ in adjacency[todo.pop()]:
                if n in pending:pending.remove(n);component.append(n);todo.append(n)
        islands.append({'nodeIds':sorted(component),'roomIds':sorted(n for n in component if n in rooms)})
    result['report']={
        'status':'complete' if result['entry'] and not unreachable and not invalid and not overlaps and not any(i['type']=='room-outside-floor' for i in issues) else 'needs-review',
        'roomCount':len(floor.get('rooms',[])),'validRoomCount':len(rooms),'reachableRoomCount':len(rooms)-len(unreachable),
        'unreachableRoomIds':unreachable,'invalidRoomIds':invalid,'freeComponentCount':len(frees),'rawFreeComponentCount':len(raw_free_parts),'walkableCoreCount':len(cores),'planningClearance':clearance,'galleryWidth':gallery_width,'roomInsideClearance':.36,'roomCorePolicy':'single-largest-except-preserved-map-derived-door','roomCoreSelections':room_core_choices,'roomInsideProbe':'nearest core; wall-normal radius probe','verticalServiceObstacleCount':len(verticals),'rootNodeId':root,
        'rootArea':round(root_poly.area,4),'rootFromMapAnnotations':bool(max(roots)[0]),'candidatePortalCount':len(candidates),'reviewedOverrideCount':reviewed_count,
        'selectedPortalCount':len(result['portals']),'preservedManualDoorCount':len(preserved_rooms),'manualDoorCount':len(preferred),
        'islands':islands,'issues':issues,'maxWallGap':max_gap,'portalWidth':portal_width,
        'limitation':'Public-space components use eroded/restored body-clearance cores without reunifying narrow necks. Room edges and portal contacts remain geometric proposals; actual rendered Recast and capsule traversal must still be verified. No real-site or step-free access certification.'}
    # Bounded exception for the long, source-derived EN basement candidate:
    # choose one viable connected component, never reunify its disconnected cores.
    fallback_room='EN-B1-region-001'
    if _allow_core_fallback and fid=='EN-B1' and fallback_room in unreachable and fallback_room in room_components and sources[fallback_room].get('door',{}).get('basis')!='map-derived':
        attempts=[]
        for component_index in range(1,len(room_components[fallback_room])):
            preferences={**(_core_preferences or {}),fallback_room:component_index}
            alternative=plan_floor_access(floor,portal_width=portal_width,max_gap=max_gap,service_stair=service_stair,clearance=clearance,gallery_width=gallery_width,portal_overrides=portal_overrides,_core_preferences=preferences,_allow_core_fallback=False,vertical_entry=vertical_entry)
            remaining=alternative['report']['unreachableRoomIds']
            attempts.append({'component':component_index,'reachableRoomCount':alternative['report']['reachableRoomCount']})
            if fallback_room not in remaining and set(remaining).issubset(set(unreachable)):
                choice=alternative['report']['roomCoreSelections'][fallback_room]
                choice['selectionBasis']='largest-qualified-single-component-fallback'
                choice['attemptedAlternatives']=attempts
                alternative['report']['issues'].append({'type':'room-single-core-fallback','roomId':fallback_room,'selectedComponent':component_index,'note':'Largest core had no valid portal; selected the first area-ordered component with a complete body-qualified connection. Every portal uses this one component; no union or teleport.'})
                return alternative
    return result


def _rect(center,length,width,angle):
    ux,uz=math.cos(angle),math.sin(angle);vx,vz=-uz,ux;cx,cz=center;hl,hw=length/2,width/2
    return [[cx-ux*hl-vx*hw,cz-uz*hl-vz*hw],[cx+ux*hl-vx*hw,cz+uz*hl-vz*hw],[cx+ux*hl+vx*hw,cz+uz*hl+vz*hw],[cx-ux*hl+vx*hw,cz-uz*hl+vz*hw]]


def _apron_center(c,length,width):
    ux,uz=math.cos(c['angle']),math.sin(c['angle']);d=length/2+c.get('apron',1.6)/2
    return [c['center'][0]-ux*d,c['center'][1]-uz*d]


def _apply_structure(floor,building_id,structure):
    """Room clipping, stair/lift bodies and landing annotations from campus-structure.json."""
    if not structure:return floor,None
    floor=json.loads(json.dumps(floor));fid=floor['id']
    overrides=structure.get('roomOverrides',{}).get(fid,{})
    rooms=[]
    for room in floor.get('rooms',[]):
        if room['id'] in overrides:
            if overrides[room['id']] is None:continue
            room={**room,'polygon':overrides[room['id']],'structureClipped':True}
        rooms.append(room)
    floor['rooms']=rooms
    services=list(floor.get('verticalServices') or []);notes=list(floor.get('mapAnnotations') or []);landings=[]
    for core in structure.get('stairCores',{}).get(building_id,[]):
        if not any(l['floorId']==fid for l in core['levels']):continue
        services.append({'id':core['id'],'kind':'stair-core','polygon':_rect(core['center'],core['length'],core['width'],core['angle'])})
        landing=_apron_center(core,core['length'],core['width']);landings.append((len(core['levels']),landing))
        notes.append({'kind':'stairs','position':landing,'source':core['id']})
    for lift in structure.get('lifts',{}).get(building_id,[]):
        if any(s['floorId']==fid for s in lift['stops']):
            services.append({'id':lift['id'],'kind':'lift-car','polygon':_rect(lift['center'],lift['size'],lift['size'],lift['angle'])})
    floor['verticalServices']=services;floor['mapAnnotations']=notes
    entry=None
    if floor['level']!=1 and landings:entry=max(landings,key=lambda x:x[0])[1]
    return floor,entry


def build_access_plan(input_dir:Path,clearance:float=.42,gallery_width:float=1.4)->dict:
    floors={};source_files=[];source_hashes={}
    structure_path=input_dir/'campus-structure.json'
    structure=json.loads(structure_path.read_text()) if structure_path.exists() else None
    review_path=input_dir/'final-three-door-source-review.json'
    review=json.loads(review_path.read_text()) if review_path.exists() else {'entries':[]}
    review_hash=hashlib.sha256(review_path.read_bytes()).hexdigest() if review_path.exists() else None
    allowed={('SC-B1','SC-B1-region-053','SC-B1-region-031'),('EV-4F','EV-4F-region-009','EV-4F-region-008'),('EV-6F','EV-6F-region-017','EV-6F-region-016')}
    for entry in review['entries']:
        if (entry['floorId'],entry['roomId'],entry['neighborRoomId']) not in allowed:raise ValueError('Unapproved reviewed override outside final three cases')
        entry['sourceReview']={'report':str(review_path),'entryId':entry['floorId']+':'+entry['roomId']+':'+entry['neighborRoomId'],'sha256':review_hash}
    for bid,sha in review.get('sourceBuildingSHA256',{}).items():
        if hashlib.sha256((input_dir/(bid+'.json')).read_bytes()).hexdigest()!=sha:raise ValueError('Source review is stale for '+bid)
    for building_id in ['SC','EN','BI','PH','CH','EC','MS','EV']:
        path=input_dir/f'{building_id}.json'
        if not path.exists():continue
        source_bytes=path.read_bytes();data=json.loads(source_bytes);source_files.append(str(path));source_hashes[path.name]=hashlib.sha256(source_bytes).hexdigest()
        for floor in data['floors']:
            floor,vertical_entry=_apply_structure(floor,building_id,structure)
            print('planning',floor['id'],flush=True);floors[floor['id']]=plan_floor_access(floor,service_stair=None,clearance=clearance,gallery_width=gallery_width,portal_overrides=[entry for entry in review['entries'] if entry['floorId']==floor['id']],vertical_entry=vertical_entry)
    total=sum(f['report']['roomCount'] for f in floors.values());reachable=sum(f['report']['reachableRoomCount'] for f in floors.values())
    return {'version':1,'basis':'schematic','units':'metres','coordinates':'unaltered floor-local x,z',
        'method':'original room polygons + explicitly schematic exterior gallery + body-clearance free-space cores + parallel contact + public-root spanning tree; no grid replacement','planningClearance':clearance,'galleryWidth':gallery_width,
        'sourceReviewHash':review_hash,'sourceReviewFile':str(review_path) if review_hash else None,'sourceFiles':source_files,'sourceSHA256':source_hashes,'structureSHA256':hashlib.sha256(structure_path.read_bytes()).hexdigest() if structure else None,'floors':floors,'summary':{'floors':len(floors),'rooms':total,'reachableRooms':reachable,'unreachableOrInvalidRooms':total-reachable,'completeFloors':sum(f['report']['status']=='complete' for f in floors.values())}}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input-dir',type=Path,default=Path('public/data/walkthrough'));parser.add_argument('--output',type=Path,default=Path('public/data/walkthrough/access-plan.json'));parser.add_argument('--clearance',type=float,default=.42);parser.add_argument('--gallery-width',type=float,default=1.4);args=parser.parse_args()
    report=build_access_plan(args.input_dir,clearance=args.clearance,gallery_width=args.gallery_width);args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    summary={'summary':report['summary'],'sourceReviewHash':report['sourceReviewHash'],'sourceSHA256':report['sourceSHA256'],'accessPlanSHA256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'floors':{fid:{'reachableRooms':f['report']['reachableRoomCount'],'rooms':f['report']['roomCount'],'rate':f['report']['reachableRoomCount']/f['report']['roomCount'] if f['report']['roomCount'] else None,'status':f['report']['status'],'issues':f['report']['issues'],'unreachableRoomIds':f['report'].get('unreachableRoomIds',[])} for fid,f in report['floors'].items()}}
    args.output.with_name(args.output.stem+'-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report['summary']))

if __name__=='__main__':main()
