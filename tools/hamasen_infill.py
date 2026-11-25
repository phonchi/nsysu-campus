"""Photo-bounded street infill. Road, landmark and resident geometry are placement constraints."""
from collections import Counter
import json
import math

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree


SHOP_STREETS = {'臨海二路', '鼓山一路', '麗雄街', '鼓元街', '鼓波街', '濱海一路', '濱海二路', '哨船街', '登山街', '延平街'}
RESIDENT_CLEARANCE = .65
GRAPH_CLEARANCE = 1.05


def resident_paths(source):
    residents = source['residents']
    for resident in residents['talkable']:
        for entry in resident['schedule'].values():
            yield resident['id'], Point(entry['at'])
    for resident in residents['ambient']:
        yield resident['id'], LineString(resident['route'])


def landmark_polygons(root, *, margin=.45, walking=False):
    folder = root/'public/models/landmarks'
    placements = json.loads((folder/'placements.json').read_text())
    for name, placement in placements.items():
        if not name.startswith('hamasen-'):
            continue
        x, z = placement['centroid']
        sine, cosine = math.sin(placement['yaw']), math.cos(placement['yaw'])
        def world(u, v):
            return x+u*cosine+v*sine, z-u*sine+v*cosine
        for item in json.loads((folder/f'{name}.collision.json').read_text())['boxes']:
            u, y, v = item['center']
            w, h, d = item['size']
            if walking and (y+h/2 < .20 or y-h/2 > 1.74):
                continue
            s, c = math.sin(item['yaw']), math.cos(item['yaw'])
            yield Polygon([world(u+a*c+b*s, v-a*s+b*c)
                           for a,b in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]).buffer(margin)
        if not walking and placement.get('levelPad'):
            yield Polygon([world(*point) for point in placement['levelPad']])


def fill_streets(root, evidence, models, roads, graph, protected, round_points, street_margin, street_reserves):
    """Use only confirmed roof bands. Generate one solid footprint per 4–6 m bay."""
    bands = unary_union([Polygon(p) for p in evidence['frontageBands']])
    residents = json.loads((root/'data/sources/hamasen/content-final.json').read_text())
    centres = [row['p'][::2] for row in graph['nodes']]
    # The generated arcade/POI edges may sit beneath roofs. Reserve the immutable
    # campus edge prefix here. The district streets already have their own masks.
    route_clearance = [LineString([centres[a], centres[b]]).buffer(GRAPH_CLEARANCE)
                       for a,b,*_ in graph['edges'][:graph.get('hamasen', {}).get('baseEdges', len(graph['edges']))]
                       if max(centres[a][0], centres[b][0]) >= 240 and max(centres[a][1], centres[b][1]) >= 135]
    exclusion = unary_union([street_reserves, *route_clearance, *landmark_polygons(root),
                             *(path.buffer(RESIDENT_CLEARANCE) for _, path in resident_paths(residents)),
                             *(LineString(path).buffer(.60) for path in evidence['shopApproaches']),
                             *protected, Polygon(evidence['portalParking']), Polygon(evidence['schoolGround'])])
    footprints = [Polygon(b['polygon'], b.get('holes', [])) for b in models]
    keep = STRtree(footprints)
    generated = []
    occupied = []
    report = Counter()
    for trace in evidence.get('shopFootprints', []):
        polygon = Polygon(trace['polygon'])
        if polygon.intersects(exclusion) or any(polygon.intersects(footprints[int(i)]) for i in keep.query(polygon)):
            raise ValueError(f'Photo-based approach for {trace["shop"]} overlaps existing access or a footprint')
        model = {'id':f'hamasen-infill-shop-{trace["shop"]}', 'name':None, 'district':'hamasen',
                 'polygon':trace['polygon'], 'synthetic':True, 'street':trace['street'], 'storeys':trace['levels'],
                 'heightM':trace['heightM'], 'facade':'shophouse', 'tone':'tile', 'roofShape':trace['roofShape'],
                 'frontage':{'edge':0, 'commercial':True}}
        generated.append(model)
        occupied.append(polygon)
        report[trace['street']] += 1
    for trace in evidence.get('tracedRows', []):
        polygon = Polygon(trace['polygon'])
        if (polygon.intersects(exclusion)
            or any(polygon.intersects(footprints[int(i)]) for i in keep.query(polygon))
            or any(polygon.intersects(other) for other in occupied)):
            raise ValueError(f'Photo-based street house {trace["id"]} overlaps existing access or a footprint')
        generated.append({
            'id':f'hamasen-infill-r3-{trace["id"]}', 'name':None, 'district':'hamasen',
            'polygon':trace['polygon'], 'synthetic':True, 'street':trace['street'], 'storeys':trace['levels'],
            'heightM':round(3.12*trace['levels']+.18,2), 'facade':'shophouse', 'tone':'tile', 'roofShape':'flat',
            'frontage':{'edge':0, 'commercial':trace['street'] in SHOP_STREETS},
        })
        occupied.append(polygon)
        report[trace['street']] += 1
    for road, _, line in roads:
        if road['name'] not in SHOP_STREETS or road['bridge']:
            continue
        for segment, (a,b) in enumerate(zip(line.coords, list(line.coords)[1:])):
            length = math.dist(a,b)
            if length < 5:
                continue
            tx,tz = (b[0]-a[0])/length, (b[1]-a[1])/length
            for side in (-1,1):
                nx,nz = -tz*side,tx*side
                minimum = road['width']/2+street_margin(road)+.03
                def points(u0, u1, near, far):
                    return [(a[0]+tx*u+nx*v, a[1]+tz*u+nz*v)
                            for u,v in [(u0,near),(u1,near),(u1,far),(u0,far)]]
                scan = Polygon(points(0,length,minimum,minimum+18))
                neighbours = [footprints[int(i)] for i in keep.query(scan, predicate='intersects')]
                # Existing front edges contribute a setback only if they are genuinely in this row.
                row_edges = []
                for poly in neighbours:
                    strip = poly.intersection(scan)
                    if strip.is_empty or strip.area < 7:
                        continue
                    local = transform(lambda x,z: ((x-a[0])*tx+(z-a[1])*tz,
                                                    (x-a[0])*nx+(z-a[1])*nz), strip)
                    lo, setback, hi, _ = local.bounds
                    if minimum <= setback <= minimum+5:
                        row_edges.append((lo, hi, setback))
                count = max(1, round(length/5))
                width = length/count
                if not 4 <= width <= 6:
                    continue
                last = None
                for i in range(count):
                    u0,u1 = i*width,(i+1)*width
                    middle = (u0+u1)/2
                    adjacent = sorted((max(lo-middle,middle-hi,0),d) for lo,hi,d in row_edges)
                    setback = adjacent[0][1] if adjacent and adjacent[0][0] < 13 else minimum+.45
                    # Quantize offsets so bays with the same street line share their edge.
                    setback = minimum+round((setback-minimum)*2)/2
                    free = None
                    for near in dict.fromkeys((setback, minimum, minimum+.50)):
                        for depth in (10.0, 8.2, 6.6):
                            poly = Polygon(round_points(points(u0,u1,near,near+depth)))
                            if (bands.intersection(poly).area < poly.area*.82 or poly.intersects(exclusion)
                                or any(poly.intersection(other).area > .002 for other in [*neighbours,*occupied])):
                                continue
                            free = poly
                            break
                        if free is not None:
                            break
                    if free is None:
                        last = None
                        continue
                    polygon = list(free.exterior.coords)[:-1]
                    identity = f'{road["id"].removeprefix("hamasen-osm-")}-{segment}-{side+1}-{i}'
                    levels = 2+(int(road['osmId'])+segment+i*11+(side+1)*3)%3
                    model = {'id':f'hamasen-infill-{identity}', 'name':None, 'district':'hamasen',
                             'polygon':polygon, 'synthetic':True, 'street':road['name'], 'storeys':levels,
                             'heightM':round(3.12*levels+.15+(i%4)*.14, 2), 'facade':'shophouse',
                             'tone':'tile','roofShape':'flat', 'frontage':{'edge':0,'commercial':True}}
                    if last is not None and last['polygon'][1] == polygon[0] and last['polygon'][2] == polygon[3]:
                        shared = min(model['heightM'],last['heightM'])
                        last.setdefault('sharedWalls', {})['1'] = shared
                        model.setdefault('sharedWalls', {})['3'] = shared
                    occupied.append(free)
                    generated.append(model)
                    report[road['name']] += 1
                    last = model
    return generated, report
