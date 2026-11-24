"""Hamasen exterior models for create_landmarks.py --hamasen.

Footprint IDs and field observations are in data/sources/hamasen/pois.json.
Dimensions of architectural details are modelled from the photographs listed in
artifacts/v12/qa/hamasen-polish/landmarks/r2/summary.md.
"""
import json
import math


def poi(api, key):
    path = api.ROOT / 'data/sources/hamasen/pois.json'
    return next(p for p in json.loads(path.read_text(encoding='utf-8'))['landmarks'] if p['id'] == key)


def footprints(api, key):
    records = {b['id']: b for b in api.STRUCT['context']['background']}
    return [records[id] for id in poi(api, key)['buildingIds']]


def footprint_frame(api, outline, edge):
    center = api.centroid(outline)
    cycle = list(zip(outline, outline[1:] + outline[:1]))
    area = sum(x * zz - xx * z for (x, z), (xx, zz) in cycle)
    (x, z), (xx, zz) = cycle[edge]
    yaw = math.atan2(zz - z, x - xx) + (math.pi if area < 0 else 0)
    return center, math.remainder(yaw, math.tau)


def local(frame, point):
    (cx, cz), yaw = frame
    dx, dz = point[0] - cx, point[1] - cz
    c, s = math.cos(yaw), math.sin(yaw)
    return dx * c - dz * s, -dx * s - dz * c


def bounds(poly):
    x, y = zip(*poly)
    return min(x), min(y), max(x), max(y)


def site(api, key, model_id, edge, limit, **placement):
    record = poi(api, key)
    buildings = footprints(api, key)
    frame = footprint_frame(api, buildings[0]['polygon'], edge)
    api.place(model_id, buildings[0].get('osmId'), *frame, note=record['name'], **placement)
    return api.LM(model_id, record['name'], limit), buildings, frame


def views(lm, width, target=(0, 0, 2.5), elevation=22):
    lm.view('front', 154, elevation, width * 1.2, target=target, ortho=width)
    lm.view('back', 334, elevation + 6, width * 1.2, target=target, ortho=width)


def street_view(lm, front, x=0, z=2.7, distance=20, lens=23):
    eye = lm.preview_ground + 1.60
    lm.view('street', 180, math.degrees(math.atan2(eye-z,distance)),
            math.hypot(distance,z-eye), target=(x,front,z), lens=lens)


def paint_sign(lm, text, bg, fg='#faf2d9', span=(4, 1), serif=False, vertical=False, **style):
    return lm.tile(text, 'text', span=span, text=text, bg=bg, fg=fg, serif=serif,
                   vertical=vertical, traditional=True, **style)


def tiles(lm, name, base, shadow, light, courses=9):
    return lm.tile(name, 'roof_channels', span=(2, 2), color=base, shadow=shadow,
                   highlight=light, courses=courses)


def face_strip(lm, x0, x1, y, z0, z1, tile, back=False):
    lm.wall((x1, y) if back else (x0, y), (x0, y) if back else (x1, y), z0, z1, tile)


def roof_along_y(lm, profile, y0, y1, tile, trim, thickness=.17):
    """Closed slab with a transverse profile (x, height), extruded along y."""
    for (x, z), (xx, zz) in zip(profile, profile[1:]):
        lm.quad((x, y0, z), (xx, y0, zz), (xx, y1, zz), (x, y1, z), tile)
        lm.quad((xx, y0, zz-thickness), (x, y0, z-thickness), (x, y1, z-thickness), (xx, y1, zz-thickness), trim)
        lm.quad((x, y0, z-thickness), (xx, y0, zz-thickness), (xx, y0, zz), (x, y0, z), trim)
        lm.quad((xx, y1, zz-thickness), (x, y1, z-thickness), (x, y1, z), (xx, y1, zz), trim)
    for (x, z), normal in [(profile[0], -1), (profile[-1], 1)]:
        pts = [(x, y0, z-thickness), (x, y1, z-thickness), (x, y1, z), (x, y0, z)]
        lm.face(pts if normal > 0 else pts[::-1], trim)


def beam(lm, a, b, width, tile):
    """A rectangular beam between two 3D points, through the shared prism helper."""
    from mathutils import Matrix, Vector
    direction = Vector(b) - Vector(a)
    previous = lm.M
    lm.M = previous @ Matrix.Translation(Vector(a)) @ direction.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    try:
        lm.box(0, 0, 0, width, width, direction.length, tile, bottom=tile)
    finally:
        lm.M = previous


def hip_ridge(lm, z, width, depth, rise, ridge, tile, trim, cells=4):
    """Four sloping sides converging at a short ridge."""
    x, y = width / 2, depth / 2
    points = [(-x,-y,z), (x,-y,z), (x,y,z), (-x,y,z)]
    a, b = (-ridge/2,0,z+rise), (ridge/2,0,z+rise)
    lm.quad(points[0], points[1], b, a, tile, nx=cells)
    lm.quad(points[2], points[3], a, b, tile, nx=cells)
    for i, end in [(1,b), (3,a)]:
        lm.face([points[i], points[(i+1)%4], end], tile)
    lm.face(points[::-1], trim)
    lm.box(0, 0, z+rise-.07, ridge+.18, .23, .17, trim, bottom=trim)


def wude(api):
    lm, buildings, frame = site(api,'kaohsiung-butokuden','hamasen-wude',5,3000,elevation=2.28,footings=False)
    lm.preview_ground = -2.23
    x0,y0,x1,y1 = bounds([local(frame,p) for p in buildings[0]['polygon']])
    width,depth = x1-x0-.16,y1-y0-2.9
    cx,cy = (x0+x1)/2,y1-depth/2
    base = lm.tile('rubble','stone',(2,2),color='#98968c',dark='#595a54',rows=7,cols=9)
    cream = lm.solid('#d8d5c6')
    red = lm.tile('brick','brick',(2,2),color='#ad553e',mortar='#c08473',course=6,brick=12)
    window = lm.tile('tall lattice sash','window',(2,3),wall='#b36144',
                     win=(.27,.13,.73,.93),sill='#bcb39b',frame='#6e4235',mull=2,
                     glazing=dict(top='#7b857b',base='#596963',bottom='#39413f',glint=False,rails=5))
    clerestory = lm.tile('clerestory','window',(2,1),wall='#c8c6bb',wall_kind='solid',
                         win=(.28,.28,.72,.71),sill=None,frame='#6e4235',lit='off',
                         glazing=dict(top='#62685c',base='#5c655b',bottom='#393b37',glint=False))
    relief = lm.tile('arrow and target','relief',(1,2),bg='#a95540',stone='#e4dac3',subject='target')
    roof = tiles(lm,'black tile','#494b4c','#252a30','#5e6263')
    dark,wood,deck = [lm.solid(c) for c in ['#343639','#6b4c35','#b19272']]
    front = -depth/2
    with lm.at(cx,cy):
        lm.box(0,0,-2.64,width,depth,2.85,base,cream,cell=(4,3),col=True)
        lm.box(0,0,.21,width+.12,depth+.12,.59,cream)
        lm.box(0,0,.80,width-.19,depth-.19,2.99,window,cream,cell=(3.6,2.99),col=True)
        lm.box(0,0,3.79,width-.16,depth-.16,1.15,clerestory,cream,cell=(3.6,1.15))
        for i in range(8):
            x = (i-3.5)*(width-.9)/7
            for side in [-1,1]:
                y = side*(depth/2-.09)
                lm.box(x,y,.45,.42,.26,4.35,red)
                face_strip(lm,x-.19,x+.19,y+side*.135,3.94,4.66,relief,back=side>0)
        for side in [-1,1]:
            with lm.at(rot=math.pi/2):
                for y in [-5.0,-1.65,1.65,5.0]:
                    lm.box(y,side*width/2,.45,.40,.24,4.26,red)
                    face_strip(lm,y-.18,y+.18,side*(width/2+.125),3.88,4.62,relief,back=side>0)
        hip_ridge(lm,4.94,width+1.4,depth+1.52,1.66,width-10.9,roof,dark,cells=9)
        # Entrance porch and its four paired columns.
        lm.box(0,front-1.33,.21,6.91,3.05,.24,cream,col=True,walk=True)
        for y in [front-2.61,front-.63]:
            for x in [-2.76,-2.27,2.27,2.76]:
                lm.box(x,y,.45,.40,.43,.23,cream,col=True)
                lm.cyl(x,y,.68,.153,2.06,9,cream,cream,r2=.139)
                lm.box(x,y,2.73,.38,.39,.19,cream)
                lm.col(x,y,.67,.31,.31,2.25)
        door = lm.tile('entry lattice','lattice',(2,2),bg='#353834',bar='#634533',n=8)
        face_strip(lm,-1.48,1.48,front-.08,.45,2.60,door)
        profile = [(-3.55,3.10),(-2.94,3.03),(-2.34,3.14),(-1.73,3.38),(-1.13,3.77),
                   (-.54,4.01),(0,4.10),(.54,4.01),(1.13,3.77),(1.73,3.38),(2.34,3.14),(2.94,3.03),(3.55,3.10)]
        roof_along_y(lm,profile,front-3.10,front+.20,roof,wood,.21)
        lm.box(0,front-2.64,2.86,5.83,.22,.21,wood)
        sign = paint_sign(lm,'殿德武','#b66a3e','#292621',span=(3,1),serif=True,aspect=3.67)
        api.plate(lm,-1.04,1.04,front-2.78,3.06,3.63,sign)
        rope = lm.solid('#d1b680')
        for a,b in zip([(-1.45,3.18),(-.72,2.93),(0,2.87),(.72,2.93)],
                       [(-.72,2.93),(0,2.87),(.72,2.93),(1.45,3.18)]):
            beam(lm,(a[0],front-2.89,a[1]),(b[0],front-2.89,b[1]),.069,rope)
        # The platform projects in front of the retaining wall, with stair flights at its two ends.
        deck_front = front-6.43
        lm.box(.65,front-3.25,.02,18.3,6.38,.24,deck,bottom=wood,col=True,walk=True)
        for x in [-7.0,-2.4,2.4,7.94]:
            lm.box(x,deck_front+.40,-2.23,.24,.28,2.25,wood,col=True)
            beam(lm,(x,deck_front+.40,-1.12),(x-1.43,deck_front+.40,.10),.19,wood)
            beam(lm,(x,deck_front+.40,-1.12),(x,deck_front+1.71,.10),.19,wood)
        rail = lm.tile('timber balusters','louvre',(2,1),color='#d8b99b',line='#856c58',vertical=True,n=12)
        for i in range(6):
            a,b = -8.50+i*3.05,-5.45+i*3.05
            face_strip(lm,a,b,deck_front,.32,1.22,rail)
            face_strip(lm,a,b,deck_front+.056,.32,1.22,rail,back=True)
            lm.box(a,deck_front,.25,.121,.122,1.07,wood)
        lm.box(.65,deck_front,1.23,18.3,.12,.12,deck)
        lm.col(.65,deck_front,.26,18.3,.13,1.10)
        lm.stairs(14.3,front-5.30,-2.23,2.05,4.54,2.49,13,wood,deck,rot=math.pi/2)
        for y in [front-6.32,front-4.28]:
            beam(lm,(9.80,y,1.26),(14.33,y,-1.15),.115,deck)
            for j in range(5):
                x=9.86+j*1.07
                lm.box(x,y,.20-j*.58,.096,.104,1.07,wood)
        # Lower the foot of the left flight to meet the terrain. Uniform risers
        # keep the character moving at both keyboard and touch joystick speeds.
        lm.stairs(-12.35,front-8.36,-2.50,3.18,6.76,2.76,19,base,cream)
        lm.box(-11.12,front-.83,.02,5.70,1.62,.24,base,cream,col=True,walk=True)
        marker = paint_sign(lm,'武德殿','#8f8070','#ae2727',span=(1,3),serif=True,vertical=True)
        rock=[(-.56,-.41),(.38,-.48),(.54,-.19),(.44,.38),(-.31,.48),(-.55,.13)]
        with lm.at(-14.62,front-5.74):
            lm.prism(rock,-2.20,-.13,base,base)
            face_strip(lm,-.34,.26,-.471,-1.97,-.40,marker)
            lm.col(0,0,-2.20,1.06,.88,2.07)
        for z,r,h in [(-2.22,.34,.20),(-2.02,.13,.52),(-1.5,.25,.29),(-1.21,.36,.14)]:
            lm.cyl(-9.0,front-7.2,z,r,h,6,cream,cream,r2=r*.8)
    views(lm,43,(0,-2,2.0),elevation=15)
    street_view(lm,cy+front-7.9,z=2.4,distance=18,lens=24)
    return lm


def temple_roof(lm, cx, cy, z, width, depth, rise, roof, enamel, gold, blue, ornaments=1):
    """Splayed eaves and ridge finials with a few short segments per curve."""
    with lm.at(cx,cy,z):
        xs = [-.5,-.44,-.33,0,.33,.44,.5]
        ends = [.67,.24,.02,0,.02,.24,.67]
        for side in [-1,1]:
            ys = [side*depth*.5, side*depth*.27, 0]
            for k in range(len(xs)-1):
                x, xx = xs[k]*width, xs[k+1]*width
                for j, (h, hh) in enumerate([(0,rise*.35),(rise*.35,rise)]):
                    a = (x,ys[j],h+ends[k])
                    b = (xx,ys[j],h+ends[k+1])
                    c = (xx*(1-(j+1)*.09),ys[j+1],hh+ends[k+1]*1.35)
                    d = (x*(1-(j+1)*.09),ys[j+1],hh+ends[k]*1.35)
                    # Ring 1 shares positions with the start of ring 2.
                    a = (a[0]*(1-j*.09),a[1],h+ends[k]*(1 if not j else 1.35))
                    b = (b[0]*(1-j*.09),b[1],h+ends[k+1]*(1 if not j else 1.35))
                    lm.face([a,b,c,d] if side<0 else [b,a,d,c],roof)
                a, b = (x,ys[0],ends[k]), (xx,ys[0],ends[k+1])
                fascia = [(a[0],a[1],a[2]-.14),(b[0],b[1],b[2]-.14),b,a]
                lm.face(fascia if side<0 else fascia[::-1],enamel)
            for k in [0,-1]:
                x = xs[k]*width
                lm.face([(x,ys[0],ends[k]),(x*.91,ys[1],rise*.35+ends[k]*1.35),
                         (x*.82,0,rise+ends[k]*1.35),(x*.82,0,-.14),(x,ys[0],-.14)]
                        [::(1 if side*xs[k] > 0 else -1)],enamel)
        lm.box(0,0,-.15,width*.91,depth,.17,enamel,bottom=enamel)
        for side in [-1,1]:
            ridge = [(0,rise),(.29*width,rise+.05),(.36*width,rise+.31),(.41*width,rise+.97),(.43*width,rise+1.40)]
            for (x,h),(xx,hh) in zip(ridge,ridge[1:]):
                ridge_strip = [(side*x,-.09,h-.08),(side*xx,-.09,hh-.08),
                               (side*xx,-.09,hh+.10),(side*x,-.09,h+.10)]
                twice = ridge_strip if side>0 else ridge_strip[::-1]
                lm.face(twice,enamel)
                lm.face([(a,-b,c) for a,b,c in twice[::-1]],enamel)
                top = [(side*x,-.09,h+.10),(side*xx,-.09,hh+.10),
                       (side*xx,.09,hh+.10),(side*x,.09,h+.10)]
                lm.face(top if side>0 else top[::-1],enamel)
            for k in range(ornaments):
                t = (k+.5)/ornaments
                x = side*width*(.07+.28*t)
                zz = rise+.09+t*t*.31
                lm.cyl(x,0,zz,.17,.32+(k%2)*.19,5,blue if k%2 else gold,enamel,r2=.08)
                beam(lm,(x-.23,-.04,zz+.10),(x+.24,.04,zz+.31),.11,blue)
        lm.cyl(0,0,rise,.22,.68,7,gold,enamel,r2=.08)


def gate_roof(lm, z, width, depth, rise, roof, trim, gold, red):
    hip_ridge(lm,z,width,depth,rise,width*.86,roof,trim,cells=9)
    for side in [-1,1]:
        x = side*width*.43
        lm.cyl(x,0,z+rise-.10,.23,.45,7,trim,trim,r2=.36)
        beam(lm,(x+side*.25,0,z+rise+.26),(x-side*.19,0,z+rise+.79),.28,trim)
        lm.cyl(x-side*.20,0,z+rise+.67,.23,.22,7,trim,trim,r2=.10)
    lm.cyl(0,0,z+rise,.32,.49,8,gold,red,r2=.25)
    lm.cyl(0,0,z+rise+.54,.16,.24,8,red,gold,r2=.035)


def temple(api):
    lm, buildings, frame = site(api,'hamasen-daitian-temple','hamasen-temple',7,4400)
    x0,_,x1,_ = bounds([local(frame,p) for p in buildings[0]['polygon']])
    width = x1-x0-.6
    stone = lm.tile('granite','stone',(2,2),color='#c7c7bc',dark='#939a97')
    pale = lm.solid('#dad9ca')
    dragon = lm.solid('#bec5bd')
    red,dark,gold,green,teal,blue,vermilion = [lm.solid(c) for c in
        ['#b24935','#513034','#e3b65a','#37544c','#448d78','#4699bc','#c3554b']]
    clay = tiles(lm,'yellow orange glazed tile','#e99538','#b6652e','#f5bb56')
    jade = tiles(lm,'green barrel tile','#526c5e','#30483e','#839785')
    paving = lm.tile('red pavers','brick',(2,2),color='#bb7e64',brick=13,course=7)
    carve = lm.tile('octagonal stone grille','relief',(2,2),subject='octagon',bg='#d5d6cb',stone='#9fa6a4')
    wood = lm.tile('lattice panels','lattice',(1,2),bg='#443728',bar='#91563e',n=8)
    sign = paint_sign(lm,'代天宮','#735322','#ffe197',span=(1,3),serif=True,vertical=True)
    crown = paint_sign(lm,'高雄','#735322','#eed093',span=(1,1),serif=True,aspect=2)
    gate_sign = paint_sign(lm,'宮 天 代','#252420','#e9bf66',span=(4,1),serif=True,aspect=4.8)
    plaque = lm.tile('painted bracket frieze','lattice',(2,1),bg='#994638',bar='#deb56c',n=7)
    plaza = [(-.8,-50.7),(17.5,-50.7),(12.5,-14.75),(-10,-14.75)]
    lm.prism(plaza,.01,.08,paving)
    lm.quad(*[(*p,.08) for p in plaza],paving,nx=4,ny=6)
    lm.box(.2,1,-.25,width,27,.87,stone,stone,cell=(3,3),col=True,walk=True)
    lm.box(-1.2,3,.62,width-1.5,19.5,4.63,stone,stone,col=True)
    lm.box(-1.6,13.05,.61,9.50,8.16,4.09,stone,stone,col=True)
    lm.box(0,-10.73,3.86,23.60,1.04,.64,plaque,bottom=gold)
    lm.box(0,-10.67,3.73,23.84,1.17,.15,gold)
    for x in [-10.15,-6.52,6.52,10.15]:
        lm.box(x,-10.38,.62,.70,.84,3.35,stone,col=True)
        lm.box(x,-10.43,3.66,.94,.94,.26,pale)
    for x in [-3.06,3.06]:
        lm.cyl(x,-11.04,.63,.44,3.31,9,stone,stone)
        lm.cyl(x,-11.04,.62,.53,.40,8,pale,pale)
        lm.col(x,-11.04,.62,1.02,1.02,3.33)
        for j in range(10):
            a=j*math.pi*.59; b=(j+1)*math.pi*.59
            beam(lm,(x+.455*math.cos(a),-11.04+.455*math.sin(a),.94+j*.266),
                 (x+.455*math.cos(b),-11.04+.455*math.sin(b),.94+(j+1)*.266),.20,dragon)
        lm.lion(x,-11.29,3.05,.4,.43,dragon,pale)
    for x in [-8.55,8.55]:
        lm.box(x,-10.31,.62,3.24,.62,3.22,stone,col=True)
        face_strip(lm,x-1.46,x+1.46,-10.638,1.34,3.13,carve)
        lm.box(x,-10.64,.71,2.90,.07,.51,pale)
    for x in [-4.80,0,4.80]:
        lm.box(x,-7.11,.64,2.86 if x else 4.14,.23,2.86,wood)
        lm.box(x,-7.28,3.47,3.07 if x else 4.22,.21,.33,plaque)
    for x in [i*1.11 for i in range(-10,11)]:
        lm.box(x,-11.20,3.81,.33,.30,.35,red)
        lm.box(x,-11.31,4.11,.51,.40,.19,gold)
    lm.box(0,-11.46,3.16,1.02,.23,1.34,dark)
    face_strip(lm,-.435,.435,-11.58,3.24,4.24,sign)
    face_strip(lm,-.32,.32,-11.585,4.24,4.44,crown)
    lm.stairs(0,-16.12,.07,9.1,3.64,.56,4,stone,stone)
    for x in [-6.25,6.25]:
        lm.box(x,-15.44,.10,1.03,1.36,.50,stone,col=True)
        lm.lion(x,-15.44,.59,0,.77,stone,gold)
    temple_roof(lm,-.6,2.8,5.17,27.2,23.2,2.8,clay,vermilion,gold,blue,ornaments=2)
    temple_roof(lm,-1.4,3.75,7.55,15.6,14.8,2.18,clay,vermilion,gold,blue,ornaments=2)
    for x in [-7.90,0,7.90]:
        z = 5.11 if x == 0 else 4.46
        temple_roof(lm,x,-10.32,z,9.04,7.24,1.38,clay,vermilion,gold,blue,ornaments=2)
        for side in [-1,1]:
            ridge = [(x+side*u,-10.29,z+h) for u,h in
                     [(.34,1.54),(.68,2.02),(1.12,2.06),(1.62,1.79),(2.12,1.87),(2.55,2.49),(2.84,2.57)]]
            for j,(a,b) in enumerate(zip(ridge,ridge[1:])):
                beam(lm,a,b,.24 if j in [1,4] else .16,[blue,teal,gold,teal,blue,vermilion][j])
            lm.cyl(x+side*2.67,-10.34,z+2.41,.17,.36,6,gold,blue,r2=.105)
    # Freestanding paifang, with compared letterforms on both approaches.
    gate_stone = lm.tile('dark gate granite','stone',(2,2),color='#595e5e',dark='#3c4547')
    with lm.at(8,-49):
        for x in [-7.3,-3.8,3.8,7.3]:
            lm.box(x,0,.02,.70,.87,4.08,gate_stone,col=True)
            lm.box(x,0,.02,1.08,1.14,.58,gate_stone,col=True)
            lm.box(x,0,3.61,1.0,1.04,.48,gold)
        lm.box(0,0,3.86,16.62,1.22,.68,plaque,bottom=red)
        lm.box(0,0,5.26,8.84,1.18,1.21,plaque,bottom=red)
        for direction in [-1,1]:
            api.plate(lm,-1.82,1.82,direction*.60,5.61,6.37,gate_sign,normal=direction)
        gate_roof(lm,4.55,18.07,4.21,1.01,jade,green,gold,red)
        gate_roof(lm,6.49,10.16,3.74,.94,jade,green,gold,red)
        for x in [-5.80,5.80]:
            lm.lion(x,-1.39,.11,0,.75,stone,stone)
    views(lm,71,(2,-20,3.1),elevation=25)
    street_view(lm,-14.5,z=4.1,distance=21,lens=24)
    lm.view('gate',179,4,17,(8,-49,3.95),lens=29)
    return lm


def mrt_palette(lm):
    silver = lm.solid('#f2f3ef')
    metal = lm.solid('#9ba7a8')
    charcoal = lm.solid('#343b3e')
    concrete = lm.tile('stone rainscreen','tiles',(2,2),color='#caccc7',line='#a1a5a1',n=4,m=3)
    glass = lm.tile('glazed frames','band',(2,2),stripes=[(0,1,'glass')],lit='off',mull=1,frame='#a4b9b8')
    louvre = lm.tile('intake','louvre',(2,1),color='#535b5c',line='#7f8888',n=10)
    return silver, metal, charcoal, concrete, glass, louvre


def station_lanes(lm, front, width, finish, metal, dark, glass, rise=.57):
    """Represent the visible stair mouth down to grade in the outdoor scene."""
    lm.box(0,front+4.35,.02,width,8.65,.07,dark)
    lm.box(0,front+.52,.01,width,1.23,rise,finish,col=True,walk=True)
    lm.stairs(0,front+5.5,.02,width*.30,4.5,rise,9,finish,metal,rot=math.pi)
    for x in [-width*.325,-width*.175,width*.175,width*.325]:
        beam(lm,(x,front+1.14,.75+rise),(x,front+5.25,.79),.095,metal)
        lm.box(x,front+1.28,.15,.09,.31,.98,metal,col=True)
    for x in [-width*.254,width*.254]:
        for i in range(8):
            z = .02 + (8-i)*rise/8
            lm.box(x,front+1.24+i*.49,z,width*.13,.49,.055,metal)
    for x in [-width/2,width/2]:
        lm.box(x,front+4.23,.02,.16,8.4,.82,finish,col=True)
        with lm.at(x,front+.95,0,math.pi/2):
            face_strip(lm,.10,3.45,-.075,.87,1.53,glass)
            face_strip(lm,.10,3.45,.075,.87,1.53,glass,back=True)
        beam(lm,(x,front+.48,1.63),(x,front+4.42,1.03),.09,metal)
    lm.box(0,front+8.45,.02,width,.18,.93,dark,col=True)


def forecourt_steps(lm, front, finish, half_width, extension, rise=.56):
    """Rounded exposed risers and a matching set of low walkable slabs."""
    for j in range(3):
        width, ext = half_width-j*.28, extension-j*.38
        curve = [(width*math.cos(math.pi*k/12),front-ext*math.sin(math.pi*k/12)) for k in range(13)]
        # Follow the arc from right to left, then close along the rear edge.
        poly = [*curve,(-width,front+.83),(width,front+.83)]
        lm.prism(poly,.01+j*rise/3,.01+(j+1)*rise/3,finish,finish)
        for i in range(9):
            dx=(i-4)*width/4.5
            # Use the deeper edge of the inscribed strip so the collision stays inside the mesh.
            outer=min(1,(abs(dx)+width/9)/width)
            lo = front-ext*math.sqrt(1-outer*outer)*.97
            hi = front+.83
            lm.col(dx,(lo+hi)/2,.01+j*rise/3,2*width/9,hi-lo,rise/3,walk=True)


def transit_pylon(lm, x, y, code, number=None):
    silver, blue = lm.solid('#eef0ed'),lm.solid('#266499')
    accent = '#d68432' if number else '#548954'
    height = 4.20
    lm.box(x,y,.015,.64,.32,height,silver,col=True)
    lm.box(x,y,3.31,.68,.35,.94,blue)
    marker = lm.tile(code+' pylon circle','station_mark',(1,1),text=code,color=accent)
    tall = lm.tile('pylon vertical name','text',(1,4),text='哈瑪星站',bg='#eef0ed',
                   fg='#2e353a',vertical=True,serif=False)
    english = paint_sign(lm,'Hamasen','#eef0ed','#2e353a',span=(2,1),aspect=3.5)
    for side in [-1,1]:
        face = y+side*.183
        face_strip(lm,x-.235,x+.235,face,2.74,3.21,marker,back=side>0)
        face_strip(lm,x-.235,x+.235,face,1.03,2.71 if not number else 2.31,tall,back=side>0)
        face_strip(lm,x-.235,x+.235,face,.83,1.03,english,back=side>0)
        if number:
            badge = lm.tile('pylon exit '+str(number),'station_mark',(1,1),
                            text=str(number),color='#b38a28',number=True)
            face_strip(lm,x-.20,x+.20,face,2.32,2.72,badge,back=side>0)


def station_sign(lm, number, y):
    zh = paint_sign(lm,'哈瑪星站','#f4f5ef','#303735',span=(4,1),aspect=8)
    en = paint_sign(lm,'Hamasen Station','#f4f5ef','#505a58',span=(5,1),aspect=17)
    route = lm.tile('O1 station route','station_mark',text='O1',color='#d98d39')
    digit = lm.tile('exit '+str(number),'station_mark',span=(2,2),text=str(number),color='#b18d22',number=True)
    face_strip(lm,-1.83,1.83,y,3.10,3.56,zh)
    face_strip(lm,-1.69,1.69,y,2.91,3.11,en)
    face_strip(lm,-2.62,-2.01,y,2.92,3.53,route)
    face_strip(lm,2.04,2.68,y,2.88,3.52,digit)


def exit_one(api):
    lm, _, _ = site(api,'mrt-hamasen-exit-1','hamasen-mrt-exit-1',3,2800)
    silver,metal,dark,concrete,glass,louvre = mrt_palette(lm)
    coral = lm.solid('#f2af97')
    rim = lm.solid('#dd9984')
    front = -11.62
    # Asymmetrical stone plant room; its tall right wall is the canopy bearing.
    lm.box(1.1,6.08,-.13,18.74,13.15,8.08,concrete,col=True,cell=(3.5,3))
    lm.box(8.03,-2.07,-.13,4.86,16.21,9.50,concrete,col=True,cell=(3.5,3))
    lm.box(-3.95,.10,.03,5.52,4.30,7.76,concrete,col=True)
    lm.box(8.03,-2.07,9.36,4.91,16.25,.16,silver)
    for x in [-4.42,.33,5.21]:
        face_strip(lm,x-1.80,x+1.80,12.68,3.50,7.58,louvre,back=True)
    with lm.at(rot=math.pi/2):
        for a,b in [(-8.67,-3.58),(-3.23,2.28),(2.57,5.39)]:
            face_strip(lm,a,b,-5.584,4.77,8.84,louvre,back=True)
    station_lanes(lm,front,10.6,concrete,metal,dark,glass)
    forecourt_steps(lm,front,concrete,7.18,2.97)
    lm.box(-6.12,front+3.78,.09,1.22,7.25,.79,concrete,col=True)
    lm.box(-6.12,front+3.78,2.67,1.22,7.25,.36,silver)
    for y in [front+.38,front+2.76,front+5.16,front+7.29]:
        lm.box(-6.1,y,.85,1.22,.16,2.17,silver,col=True)
    with lm.at(-6.38,front+3.77,0,math.pi/2):
        face_strip(lm,-3.35,3.35,.355,.88,2.68,glass,back=True)
    x,y=-6.18,front-.56
    rings = [(.16,.24),(1.02,.185),(2.66,.14),(3.82,.26),(4.10,.33)]
    for (a,r),(b,rr) in zip(rings,rings[1:]):
        lm.cyl(x,y,a,r,b-a,12,silver,silver if b==rings[-1][0] else None,r2=rr)
    lm.col(x,y,.16,.49,.49,3.95)
    profile=[(-9.27,5.33),(-8.34,4.91),(-7.29,4.59),(-6.18,4.33),(-4.8,4.16),
             (-3.35,4.04),(-1.4,4.08),(.64,4.29),(2.56,4.51),(4.02,4.50),(5.72,4.32)]
    roof_along_y(lm,profile,front-1.32,front+9.53,coral,rim,.24)
    for x,z in profile[1:-1:2]:
        beam(lm,(x,front-1.14,z-.30),(x,front+9.41,z-.30),.13,rim)
    for y in [front-.57,front+3.58,front+8.83]:
        for (x,z),(xx,zz) in zip(profile,profile[1:]):
            beam(lm,(x,y,z-.27),(xx,y,zz-.27),.11,rim)
    lm.box(0,front+.10,2.85,10.6,.43,.77,silver)
    station_sign(lm,1,front-.127)
    transit_pylon(lm,-9.05,front-.88,'O1',1)
    views(lm,43,(0,-1.10,3.5),elevation=15)
    street_view(lm,front-2.97,x=-.42,z=3.62,distance=18,lens=29)
    return lm


def exit_two(api):
    lm, _, _ = site(api,'mrt-hamasen-exit-2','hamasen-mrt-exit-2',0,2500)
    silver,metal,dark,concrete,glass,louvre = mrt_palette(lm)
    front,back = -9.5,10.60
    station_lanes(lm,front,9.3,concrete,metal,dark,glass,rise=.55)
    forecourt_steps(lm,front,concrete,7.77,3.3,rise=.55)
    # Muted reflections on a thin pane edge; frame openings retain the through-view.
    glaze_edge = lm.solid('#c7e0e2')
    for x in [-5.76,5.76]:
        for y in [front+.32,front+5.60,front+12.65]:
            lm.box(x,y,.19,.54,.58,3.53,silver,col=True)
        lm.box(x,(front+.37+back)/2,.20,.23,back-front-.37,.95,concrete,col=True)
        lm.col(x,(front+.37+back)/2,1.15,.13,back-front-.37,2.28)
        for y in [front+1.05+i*1.62 for i in range(12)]:
            lm.box(x,y,1.14,.10,.082,2.28,metal)
        for z in [1.16,2.42,3.30]:
            lm.box(x,(front+.70+back)/2,z,.12,back-front-.70,.076,metal)
        lm.box(x,front+8.94,3.40,.265,17.1,.26,louvre)
    lm.box(0,back,.01,11.58,.32,1.15,concrete,col=True)
    lm.col(0,back,1.16,11.52,.14,2.28)
    for x in [i*1.43 for i in range(-4,5)]:
        lm.box(x,back,1.15,.105,.145,2.39,metal)
    for z in [1.16,2.39,3.37]:
        lm.box(0,back,z,11.55,.16,.080,metal)
    for side in [-1,1]:
        for i in range(3):
            x=side*(2.3+i*.88)
            face_strip(lm,x-.12,x+.12,back+.081,2.90,3.33,glaze_edge,back=True)
    # Rounded fascia and standing seam roof around a set-back skylight.
    seam=tiles(lm,'light standing seam roof','#e6e9e6','#c3cac8','#f4f5ec',courses=0)
    roof_along_y(lm,[(-7.36,3.80),(-7.29,3.95),(-7.05,4.04),(0,4.25),
                      (7.05,4.04),(7.29,3.95),(7.36,3.80)],front-1.49,back+.55,seam,silver,.17)
    for y, outward in [(front-1.49,-1),(back+.55,1)]:
        rim = [(-.14,3.70),(.08,3.74),(.16,3.83),(.15,3.92),(.04,3.99),(-.14,4.01)]
        for (dy,z),(dyy,zz) in zip(rim,rim[1:]):
            points = [(-7.23,y+outward*dy,z),(7.23,y+outward*dy,z),
                      (7.23,y+outward*dyy,zz),(-7.23,y+outward*dyy,zz)]
            lm.face(points if outward<0 else points[::-1],silver)
    roof_along_y(lm,[(-3.30,4.18),(0,4.98),(3.30,4.18)],front+4.58,9.73,glass,metal,.10)
    for y in [front+4.58+i*2.88 for i in range(6)]:
        beam(lm,(-3.34,y,4.17),(0,y,4.99),.094,silver)
        beam(lm,(0,y,4.99),(3.34,y,4.17),.094,silver)
    lm.box(0,front+.30,2.83,10.90,.50,.76,silver)
    station_sign(lm,2,front+.044)
    transit_pylon(lm,7.74,front-1.80,'O1',2)
    views(lm,39,(0,-.9,2.25),elevation=16)
    street_view(lm,front-3.30,z=2.36,distance=19,lens=30)
    return lm


def light_rail(api):
    lm, buildings, frame = site(api,'lrt-hamasen','hamasen-light-rail',1,3800)
    concrete = lm.tile('paving','tiles',(2,2),color='#c3bfb0',line='#9a998e',n=5,m=4)
    silver,steel,tactile = [lm.solid(c) for c in ['#f4f4ec','#b4bfbc','#e1b659']]
    grass = lm.tile('roof grass','foliage',(2,2),base='#799756',dots=['#6b8d53','#86a461','#6d8b50'],n=37)
    roof = tiles(lm,'pale roof seams','#dae0dc','#bec7c5','#eff0e7',courses=0)
    station = paint_sign(lm,'C14 哈瑪星站','#eef0ed','#304b53',span=(5,1),aspect=7)
    for index,building in enumerate(buildings):
        poly = building['polygon']
        other = footprint_frame(api,poly,1)
        cx,cy = local(frame,other[0])
        x0,y0,x1,y1 = bounds([local(other,p) for p in poly])
        end,width = (x1-x0)/2,y1-y0
        track_side = 1 if index else -1
        with lm.at(cx,cy,0,other[1]-frame[1]):
            lm.box(0,0,-.10,2*end-4,width,.36,concrete,cell=(4,3.8),col=True,walk=True)
            for side in [-1,1]:
                with lm.at(side*(end-2),0,0,0 if side>0 else math.pi):
                    lm.face([(-.01,-width/2,.26),(2,-width/2,.015),(2,width/2,.015),(-.01,width/2,.26)],concrete)
                    for y,sign in [(-width/2,-1),(width/2,1)]:
                        pts=[(0,y,-.065),(2,y,-.065),(2,y,.015),(0,y,.26)]
                        lm.face(pts[::(-1 if sign>0 else 1)],concrete)
                    for k in range(4):
                        lm.col(.25+k*.5,0,-.10,.50,width,.32-k*.062,walk=True)
            lm.box(0,track_side*(width/2-.21),.26,2*end-4,.22,.016,tactile)
            outer = -track_side*(width/2-.21)
            inner = track_side*(width/2-.27)
            curl = [(-end+.37,.34),(-end+1.85,.48),(-end+3.27,.92),(-end+4.51,1.62),
                    (-end+6.02,2.59),(-end+7.93,3.43),(-end+10.0,3.91)]
            profile = [*curl[-2:],(end-3.65,3.97),(end-1.14,3.86)] if not index else [(-end+1.10,3.82),(end-1.30,3.84)]
            roof_along_y(lm,profile,min(outer,inner)-.18,max(outer,inner)+.18,
                         grass if not index else roof,silver,.33)
            if not index:
                # Keep the low curl on the outside of the railing. The full-width
                # canopy begins where its underside clears the platform by 2.8 m.
                roof_along_y(lm,curl[:-1],outer-.04,outer+.18,grass,silver,.33)
                for (a,z),(b,zz) in zip(curl,curl[1:]):
                    beam(lm,(a,outer,z-.06),(b,outer,zz-.06),.34,silver)
                lm.col(-end+2.27,outer,.05,3.55,.33,.90)
            for i in range(10 if index else 9):
                x = (-end+2.4 if index else -end+6.2)+i*(2*end-11)/(9 if index else 8)
                if not index and i == 0:
                    x = profile[0][0]+.06  # Put the first crossbar under the raised canopy.
                (a,z0),(b,z1) = next((p,q) for p,q in zip(profile,profile[1:]) if p[0]<=x<=q[0])
                z = z0+(z1-z0)*(x-a)/(b-a)-.33
                lm.cyl(x,outer,.26,.087,z-.26,7,silver,silver)
                lm.col(x,outer,.26,.18,.18,z-.26)
                lm.box(x,0,z-.095,.11,width-.20,.12,silver,bottom=silver)
            # White railings follow both approach ramps, with an open path from each end.
            rail_runs = [(-end+2,end-2,.26,.26)] if index else [
                (-end+2,-15.28,.26,.26),(-13.34,end-2,.26,.26),
            ]
            for a,b,za,zb in [(-end,-end+2,.01,.26),*rail_runs,(end-2,end,.26,.01)]:
                beam(lm,(a,outer,za+1.02),(b,outer,zb+1.02),.065,silver)
                beam(lm,(a,outer,za+.136),(b,outer,zb+.136),.044,silver)
                count=max(2,round((b-a)/.45))
                for j in range(count):
                    t=(j+.5)/count
                    x,z=a+(b-a)*t,za+(zb-za)*t
                    face_strip(lm,x-.022,x+.022,outer-.011,z+.125,z+1.0,silver)
                    face_strip(lm,x-.022,x+.022,outer+.011,z+.125,z+1.0,silver,back=True)
                lm.col((a+b)/2,outer,min(za,zb),b-a,.09,1.02+abs(zb-za))
            if not index:
                # A short ramp at the park footpath's side access.
                a,b = -15.21,-13.41
                edge = width/2
                lm.face([(a,edge,.26),(b,edge,.26),(b,edge+.91,.015),(a,edge+.91,.015)],concrete)
                for j in range(4):
                    lm.col((a+b)/2,edge+(j+.5)*.2275,-.10,b-a,.2275,.32-j*.062,walk=True)
            for x in [-3.2,8.5]:
                lm.box(x,outer+track_side*.26,.26,.74,.46,1.48,silver,col=True)
                sign = lm.tile('equipment face','louvre',(1,1),color='#dce0dc',line='#7e8b86',n=4)
                face_strip(lm,x-.26,x+.26,outer+track_side*.495,.89,1.50,sign,back=track_side>0)
                for side in [-1,1]:
                    api.plate(lm,x-1.32,x+1.32,outer,2.53,2.91,station,out=.045,normal=side)
            if index:
                # A separate sign on the at-grade approach, set outside the clear ramp.
                with lm.at(-end-1.12,outer+.03,0,-math.pi*.36):
                    transit_pylon(lm,0,0,'C14')
    cx,cy = local(frame,api.centroid(buildings[1]['polygon']))
    # Connect the platforms above the track clearance envelope.
    for x in [8.25,11.55,14.85]:
        lm.box(x,cy*.5,3.72,.22,abs(cy)-1.6,.25,silver,bottom=silver)
        for y in [cy+1.38,-1.31]:
            lm.cyl(x,y,.26,.098,3.7,8,silver,silver)
            lm.col(x,y,.26,.20,.20,3.70)
    lm.box(11.55,cy*.5,3.95,7.10,abs(cy)-.95,.145,roof,silver,bottom=silver)
    views(lm,66,(cx/2,cy/2,1.65),elevation=24)
    street_view(lm,cy-2,x=9,z=2.2,distance=20,lens=23)
    lm.view('approach',261,2,29,(10,-4.7,1.7),lens=20)
    return lm


def railway_museum(api):
    lm, buildings, frame = site(api,'takao-railway-museum','hamasen-railway-museum',3,3200)
    wash = lm.solid('#bcb4a7')
    plinth,wood,metal,fascia = [lm.solid(c) for c in ['#8b8880','#604b3e','#83958b','#a5cbc2']]
    roof = tiles(lm,'hip tiles','#887f73','#6d6359','#a2978a')
    canopy = tiles(lm,'corrugated roof','#c3c0b4','#92948b','#d6d3c7',courses=0)
    shade = tiles(lm,'green corrugated awnings','#688176','#4e665d','#82a091',courses=0)
    window = lm.tile('wood sash','window',(2,2),wall='#bcb4a7',wall_kind='solid',
                     frame='#665d50',sill='#cdc6b5',win=(.32,.24,.68,.86),mull=1,transom=.36,
                     glazing=dict(top='#989f91',base='#75887f',bottom='#4f5e59',glint=False))
    glass = lm.tile('canopy glass','window',(2,2),wall='#a9c4c7',wall_kind='solid',
                    lit='off',win=(0,0,1,1),mull=1,frame='#8caaa9',sill=None,
                    glazing=dict(top='#d5e3de',base='#a7c2c3',bottom='#627f82'))
    door = lm.tile('recessed entrance','lattice',(2,2),bg='#4c5149',bar='#756454',n=6)
    porch = paint_sign(lm,'舊打狗驛故事館','#604b3e',span=(5,1),serif=True,aspect=10)
    width,depth=35.8,9.25
    front,entrance=-depth/2,-12.25
    for x0,x1 in [(-width/2,entrance-1.67),(entrance+1.67,width/2)]:
        lm.box((x0+x1)/2,0,-.10,x1-x0,depth,.43,plinth,wash,col=True)
        lm.box((x0+x1)/2,0,.33,x1-x0,depth-.11,3.52,wash,col=True)
    lm.box(entrance,.65,.015,3.34,7.88,3.83,wash,col=True)
    lm.box(0,0,3.61,width+.58,depth+.46,.25,fascia)
    hip_ridge(lm,3.86,width+.96,depth+1.15,1.46,26.1,roof,wood,cells=9)
    for x in [-16.4,-8.6,-5.5,-1.4,1.7,5.8,8.9,13.0,16.1]:
        face_strip(lm,x-1.28,x+1.28,front+.047,.73,3.51,window)
    for x in [-7.05,.15,7.35,14.55]:
        lm.quad((x-2.73,front-.76,2.89),(x+2.73,front-.76,2.89),
                (x+2.73,front+.028,3.32),(x-2.73,front+.028,3.32),shade,nx=2)
        beam(lm,(x-2.73,front-.76,2.89),(x+2.73,front-.76,2.89),.08,wood)
        for a in [x-2.24,x+2.24]:
            beam(lm,(a,front+.035,2.56),(a,front-.70,2.91),.082,metal)
    with lm.at(entrance,front):
        lm.box(0,-1.43,.007,4.64,2.86,.034,wood,col=True,walk=True)
        lm.box(0,1.27,.018,3.37,.15,2.82,wood,col=True)
        face_strip(lm,-1.57,1.57,1.187,.12,2.68,door)
        for x in [-2.21,2.21]:
            for y in [-2.60,-.22]:
                lm.box(x,y,.02,.10,.18,2.83,wood,col=True)
                for dx in [-.075,.075]:
                    lm.box(x+dx,y,.02,.056,.25,2.82,wood)
            lm.box(x,-1.41,2.76,.19,2.75,.18,wood,bottom=wood)
        for y in [-2.67,-1.73,-.79,.14]:
            for x in [-2.40,2.40]:
                beam(lm,(x,y,2.87),(0,y,3.69),.15 if y in [-2.67,.14] else .065,wood)
        beam(lm,(0,-2.77,3.77),(0,.16,3.77),.104,metal)
        for side in [-1,1]:
            beam(lm,(side*2.39,-2.77,2.94),(side*2.39,.16,2.94),.092,metal)
            # Sparse reflections let the clear part of each pane show the structure behind it.
            for y in [-2.58,-1.64,-.70]:
                pane = [(side*2.34,y,2.99),(side*.05,y,3.792),
                        (side*.05,y+.20,3.792),(side*2.34,y+.36,2.99)]
                pane = pane if side<0 else pane[::-1]
                lm.face(pane,glass)
                lm.face([(x,yy,zz-.016) for x,yy,zz in pane[::-1]],glass)
        lm.box(0,-2.67,2.84,4.46,.19,.16,wood)
        face_strip(lm,-1.93,1.93,-2.782,2.92,3.31,porch)
    for x in [-14.0,-7.0,0,7.0,14.0]:
        face_strip(lm,x-1.31,x+1.31,depth/2,.63,3.66,window,back=True)
    platform=buildings[1]
    frame2=footprint_frame(api,platform['polygon'],3)
    cx,cy=local(frame,frame2[0])
    with lm.at(cx,cy,0,frame2[1]-frame[1]):
        lm.box(0,0,-.14,70.1,9.65,.53,wash,cell=(5,3.1),col=True,walk=True)
        lm.box(0,0,.39,70.1,9.58,.037,plinth,concrete_tile(lm),cell=(3.8,3.1))
        for y in [-4.58,4.58]:
            lm.box(0,y,.42,69.8,.11,.019,lm.solid('#d8c8a0'))
        with lm.at(rot=math.pi/2):
            roof_along_y(lm,[(-4.97,3.99),(-3.02,4.34),(-1.3,4.49),(0,4.54),
                              (1.3,4.49),(3.02,4.34),(4.97,3.99)],-35.24,35.24,canopy,metal,.145)
        for x in [-32,-24,-16,-8,0,8,16,24,32]:
            for side in [-1,1]:
                y=side*3.84
                lm.box(x,y,.42,.18,.21,3.72,metal,col=True)
                lm.box(x,y,.42,.37,.35,.31,plinth)
                pts=[(y,3.11),(y*.96,3.48),(y*.85,3.73),(y*.70,3.88),(y*.56,3.93)]
                for (a,z),(b,zz) in zip(pts,pts[1:]):
                    beam(lm,(x,a,z),(x,b,zz),.102,metal)
                beam(lm,(x,side*3.92,3.92),(x,0,4.42),.095,metal)
            beam(lm,(x,-4.75,3.91),(x,4.75,3.91),.130,metal)
        for x in [-24,-11,3,17]:
            lm.box(x,-3.22,.81,2.55,.49,.10,wood)
            for z in [1.06,1.23]:
                lm.box(x,-3.41,z,2.55,.10,.12,wood)
            for dx in [-.92,.92]:
                lm.box(x+dx,-3.25,.42,.12,.36,.45,metal)
                beam(lm,(x+dx,-3.34,.80),(x+dx,-3.45,1.36),.082,metal)
            lm.col(x,-3.27,.42,2.55,.49,.91)
        for x,name,era in [(19.0,'港雄高','1941'),(-1.0,'雄高','1920'),(-19.0,'狗打','1900')]:
            label = paint_sign(lm,name,'#302923',span=(3,1),serif=True,aspect=4.7)
            year = paint_sign(lm,era,'#302923',span=(2,1),serif=True,aspect=10)
            with lm.at(x,0,0,math.pi/2):
                lm.box(0,0,2.71,2.55,.14,.97,wood)
                for i in [-.93,.93]:
                    lm.box(i,0,3.58,.08,.081,.62,metal)
                for side in [-1,1]:
                    face_strip(lm,-1.24,1.24,side*.075,3.08,3.61,label,back=side>0)
                    face_strip(lm,-1.24,1.24,side*.075,2.83,3.08,year,back=side>0)
        with lm.at(26.2,0,3.22):
            beam(lm,(0,0,.24),(0,0,.95),.073,metal)
            # Face and hands of the platform clock, perpendicular to the platform axis.
            with lm.at(rot=math.pi/2):
                circle = [(.30*math.cos(i*math.tau/12),0,.30*math.sin(i*math.tau/12)) for i in range(12)]
                face = lm.solid('#ede8d7')
                lm.face(circle,face)
                lm.face(circle[::-1],face)
                for side in [-1,1]:
                    beam(lm,(0,side*.017,0),(.13,side*.017,.11),.026,wood)
                    beam(lm,(0,side*.017,0),(-.057,side*.017,.197),.022,wood)
    views(lm,93,(cx*.65,cy*.51,2.1),elevation=24)
    street_view(lm,front,x=-7,z=2.74,distance=20,lens=24)
    lm.view('platform',92,1,24,(cx+3.4,cy,2.20),lens=30)
    return lm


def concrete_tile(lm):
    return lm.tile('concrete deck','tiles',(2,2),color='#b0ada1',line='#938f85',n=6,m=4)


def sports_field(lm,cx,cy):
    """Oval running track around a hard court, traced from the 2025 orthoimage."""
    green=lm.solid('#739480')
    track=lm.solid('#b87861')
    turf=lm.solid('#8d956f')
    line=lm.solid('#d7d2b5')
    with lm.at(cx,cy):
        def oval(shrink):
            pts=[]
            for side, start in [(1,-90),(-1,90)]:
                for i in range(13):
                    t=math.radians(start+180*i/12)
                    pts.append((side*17+(16-shrink)*math.cos(t),(16-shrink)*math.sin(t)))
            return pts
        lm.face([(x,y,.055) for x,y in oval(0)],track)
        lm.face([(x,y,.060) for x,y in oval(4)],turf)
        for offset in [.45,1.48,2.51,3.54]:
            outer,inner=oval(offset),oval(offset+.075)
            for j,a in enumerate(outer):
                k=(j+1)%len(outer)
                lm.face([(*a,.064),(*outer[k],.064),(*inner[k],.064),(*inner[j],.064)],line)
        lm.box(0,0,.060,37,18,.015,green)
        for x in [-18,0,18]:
            lm.box(x,0,.077,.095,17,.008,line)
        for y in [-8.5,8.5]:
            lm.box(0,y,.077,36,.095,.008,line)
        for x in [-12.2,0,12.2]:
            for k in range(16):
                a,b=2*math.pi*k/16,2*math.pi*(k+1)/16
                lm.face([(x+r*math.cos(t),r*math.sin(t),.087) for r,t in [(2.24,a),(2.24,b),(2.15,b),(2.15,a)]],line)


def elementary_school(api):
    lm, buildings, frame = site(api, 'gushan-elementary-school', 'hamasen-gushan-school', 0, 3700)
    white, gray, steel = [lm.solid(c) for c in ['#f5f3eb', '#9fa5a5', '#556260']]
    brick = lm.tile('brick', 'brick', (2,2), color='#a55440', mortar='#be7766', brick=14, course=7)
    roof = tiles(lm, 'slate pitched roof', '#63696e', '#4a5056', '#7b8185')
    solar = lm.tile('photovoltaics', 'tiles', (2,2), color='#526785', line='#9ca9bb', n=8, m=12)
    pavers = lm.tile('gate square', 'tiles', (2,2), color='#ce9d83', line='#e1bda6', n=7, m=6)
    lawn = lm.solid('#7e9a5b')
    window = lm.tile('upper brick bay', 'window', (2,2), wall='#a55440', win=(.19,.25,.81,.72),
                     frame='#5f5149', sill='#e9ddd1', mull=1)
    arcade = lm.tile('lower arcade', 'arch', (2,2), wall='#a55440', box=(.10,.11,.90,.98),
                     shape='semi', frame='#bc826f', lit='off')
    balcony = lm.tile('upper arcade', 'arch', (2,2), wall='#a55440', box=(.10,.11,.90,.98),
                      shape='semi', frame='#bc826f', parapet='#f1ece2', lit='off')
    tower_window = lm.tile('white lattice arch', 'arch', (3,3), wall='#a55440', box=(.11,.10,.89,.98),
                           frame='#96a09f', mullions=True, lit='off')
    # Left teaching wings: one bay per arch and a narrow band at the third level.
    for x,y,w,d in [(-30.4,-7.6,27.0,24.7),(-6.5,2.2,20.3,21.7)]:
        for z,h,tile in [(.02,3.25,arcade),(3.27,3.15,balcony),(6.42,3.18,window)]:
            lm.box(x,y,z,w,d,h,tile,white,cell=(3.15,h))
        lm.box(x,y,6.30,w+.24,d+.24,.22,white)
        lm.box(x,y,9.43,w+.12,d+.12,.24,white)
        lm.gable(x,y,9.65,w,d,1.42,roof,brick,over=.36,cells=6)
        lm.col(x,y,0,w,d,9.65)
    for x,y in [(-41.0,-16.2),(-19.5,-15.25)]:
        lm.box(x,y,.02,4.9,10.2,11.22,brick,col=True)
        for z in [2.6,5.41,8.35]:
            lm.box(x,y,z,5.0,10.24,.28,white)
            face_strip(lm,x-1.85,x+1.85,y-5.114,z+.28,z+1.53,window)
        lm.gable(x,y,11.24,5.0,10.2,1.28,roof,brick,along_x=False,over=.21)
        for side in [-1,1]:
            beam(lm,(x,y-5.32,12.52),(x+side*2.71,y-5.32,11.23),.17,white)
    # Deep central gabled entrance block. The base is an actual open bay.
    x, front, back = 10.7, -17.18, 26.90
    lm.box(x,(front+back)/2,5.65,14.15,back-front,6.0,brick,col=True,cell=(3.4,3))
    lm.gable(x,(front+back)/2,11.65,14.15,back-front,2.28,roof,brick,
             along_x=False,over=.34,cells=9)
    for side in [-1,1]:
        lm.box(x+side*6.16,(front+back)/2,.02,1.85,back-front,5.68,brick,col=True,cell=(2.8,2.8))
        lm.box(x+side*5.98,front-.29,.02,1.53,.81,5.72,white,col=True)
        lm.cyl(x+side*2.95,front+2.65,.10,.32,4.64,8,white,white)
        lm.col(x+side*2.95,front+2.65,.10,.63,.63,4.64)
        beam(lm,(x,front-.36,13.93),(x+side*7.48,front-.36,11.64),.24,gray)
        for z in [7.64,9.62,10.19]:
            lm.box(x+side*5.14,front-.038,z,3.69,.11,.17,gray)
    lm.box(x,front-.29,4.48,13.51,.82,1.55,white)
    lm.box(x,(front+back)/2,.01,10.6,back-front,.16,pavers,pavers,cell=(4,4),col=True,walk=True)
    face_strip(lm,x-4.28,x+4.28,front-.08,6.01,11.40,tower_window)
    school_name = paint_sign(lm,'高雄市鼓山區鼓山國民小學','#f5f3eb','#44464c',
                             span=(8,1),serif=True,aspect=11)
    face_strip(lm,x-5.43,x+5.43,front-.712,4.92,5.91,school_name)
    # A gap between the low east wing and hall keeps the Wude sightline open.
    lm.box(23.1,-4.7,-.10,10.4,15.0,3.54,brick,col=True)
    lm.box(23.1,-4.7,3.44,10.8,15.3,.25,white)
    lm.box(24.0,-.2,3.55,7.9,6.0,2.21,gray,col=True)
    lm.box(24.0,-.2,5.75,8.2,6.28,.19,white)
    lm.box(41.2,-3.7,-.11,12.3,17.35,4.50,brick,col=True,cell=(3.4,4.5))
    lm.gable(41.2,-3.7,4.39,12.3,17.35,1.38,roof,brick,over=.44,cells=5)
    for side in [-1,1]:
        a = (35.20,-3.7+side*8.26,4.56)
        b = (47.20,a[1],a[2])
        c = (47.20,-3.7+side*.42,5.74)
        d = (35.20,c[1],c[2])
        lm.quad(*([a,b,c,d] if side<0 else [b,a,d,c]),solar,nx=3)
    for y,xs in [(-12.215,[20.2,23.3,26.4]),(-12.39,[37.3,41.2,45.1])]:
        for x in xs:
            face_strip(lm,x-1.15,x+1.15,y,.43,3.01,window)
    lm.box(8,-24.3,.014,13,29,.077,pavers,pavers,cell=(4,5))
    lm.box(-14,-26,.011,30,10,.064,lawn)
    sports_field(lm,12,55)
    # Street edge: open gate, stone name wall and the separately surveyed guardhouse.
    stone = lm.tile('school name stone','stone',(2,2),color='#50595a',dark='#414748',rows=3,cols=5)
    with lm.at(-5.3,-39.8,0,-.12):
        lm.box(0,0,-.08,12.3,.68,1.36,stone,col=True)
        wall_name = paint_sign(lm,'鼓山國民小學','#50595a','#d5d1c5',span=(4,1),aspect=10)
        face_strip(lm,-5.3,3.4,-.345,.39,1.26,wall_name)
    for x in [1.5,2.5,3.5,4.5,5.5]:
        lm.box(x,-39.6,.02,.065,.077,1.07,steel)
    for h in [.15,1.07]:
        lm.box(3.5,-39.6,h,4.55,.09,.075,steel)
    shed = buildings[1]['polygon']
    other = footprint_frame(api, shed, 1)
    sx,sy = local(frame,other[0])
    with lm.at(sx,sy,0,other[1]-frame[1]):
        x0,y0,x1,y1 = bounds([local(other,p) for p in shed])
        w,d = x1-x0,y1-y0
        lm.box(0,0,-.07,w,d,2.68,brick,col=True)
        u,v = (w+.56)/2,(d+.55)/2
        corner = .25
        fascia = [(-u+corner,-v),(u-corner,-v),(u,-v+corner),(u,v-corner),
                  (u-corner,v),(-u+corner,v),(-u,v-corner),(-u,-v+corner)]
        lm.prism(fascia,2.60,3.02,white,white,bottom=white)
        guard_glass = lm.tile('guardhouse glazing','band',(3,1),stripes=[(0,1,'glass')],
                              mull=3,frame='#e9ece8',lit='off')
        for side in [-1,1]:
            face_strip(lm,-w*.40,w*.40,side*(d/2+.015),1.04,2.43,guard_glass,back=side>0)
        with lm.at(rot=math.pi/2):
            face_strip(lm,-d*.40,d*.40,w*.5+.012,1.04,2.43,guard_glass,back=True)
    bark=lm.solid('#685d4a')
    leaves=lm.tile('banyan foliage','foliage',(2,2),base='#597f49',dots=['#466741','#76a155','#7b924f'],n=68)
    for x,y in [(22,-31.5),(40,-29.5),(45,-27.5)]:
        lm.cyl(x,y,.02,.42,3.45,7,bark,bark,r2=.25)
        for dx,dz,r in [(-1.15,3.05,2.35),(1.00,3.18,2.3),(0,4.3,2.37)]:
            api.mound(lm,x+dx,y,r,r*.94,dz+1.88,2,8,leaves,z0=dz)
    views(lm,140,(0,9,5),elevation=32)
    street_view(lm,-40,x=3,z=4.6,distance=23,lens=19)
    lm.view('gate',173,10,54,target=(8,-18,5),ortho=57)
    return lm


def ferry(api):
    record = poi(api, 'gushan-ferry-pier')
    center = (record['x'],record['z'])
    east,west = 364.59,357.39
    north,south = 712.57,752.54
    min_x,max_x = center[1]-south,center[1]-north
    cy = center[0]-(east+west)/2
    depth = east-west
    front,back = cy-depth/2,cy+depth/2
    split = min_x+25.25
    api.place('hamasen-gushan-ferry',205060865,center,math.pi/2,note=record['name'])
    lm = api.LM('hamasen-gushan-ferry',record['name'],2450)
    white, silver, charcoal, blue, sky, foam = [lm.solid(c) for c in
        ['#faf9f0','#c5cecf','#333e44','#1978ca','#279ddd','#f4fbff']]
    glass = lm.tile('dark curtain wall','band',(2,2),stripes=[(0,1,'glass')],mull=3,lit='off')
    pavers = lm.tile('concourse tiles','tiles',(2,2),color='#babbaf',line='#a3a49c',n=6,m=5)
    louvre = lm.tile('long charcoal louvres','louvre',(2,2),color='#56636a',line='#839096',n=15)
    cladding = lm.tile('white wall panels','tiles',(2,2),color='#eceee8',line='#bfc6c5',n=3,m=3)
    # At yaw pi/2, local X increases north. Leave a millimetre for the stored yaw rounding.
    collision_end = center[1]-744+.001
    def solid_box(left,right,y,d,z,h,tile,walk=False):
        lm.box((left+right)/2,y,z,right-left,d,h,tile,bottom=tile)
        left = max(left,collision_end)
        right = min(right,max_x)
        if left < right:
            lm.col((left+right)/2,y,z,right-left,d,h,walk=walk)
    solid_box(min_x,max_x,cy,depth,-.22,.31,pavers,walk=True)
    # A boarding barrier marks the end of the playable deck, past the cross passage.
    barrier_x = collision_end+.20
    for y in [front+.08,cy,back-.08]:
        lm.box(barrier_x,y,.09,.15,.16,1.16,silver)
    for z in [.26,1.15]:
        lm.box(barrier_x,cy,z,.10,depth,.09,silver)
    for k in range(1,36):
        lm.box(barrier_x,front+k*depth/36,.33,.035,.035,.82,silver)
    lm.col(barrier_x,cy,.09,.15,depth,1.15,tag='south-boarding-barrier')
    solid_box(min_x,split,cy,depth,3.21,2.88,louvre)
    solid_box(split,max_x,cy,depth,.088,5.98,cladding)
    lm.box((min_x+max_x)/2,cy,6.06,max_x-min_x+.22,depth+.28,.30,white)
    # Only the service room, posts and overhead floor occupy the boarding hall.
    solid_box(min_x,min_x+5.65,cy,depth,.088,3.13,cladding)
    for x in [min_x+5.8,min_x+11.95,min_x+18.0,split-.34]:
        for y in [front+.30,back-.37]:
            lm.cyl(x,y,.09,.22,3.17,9,white,white)
            if collision_end+.22 <= x <= max_x-.22:
                lm.col(x,y,.09,.44,.44,3.17)
    for y, reverse in [(front,False),(back,True)]:
        offset = .016 if reverse else -.016
        for z,z1 in [(1.01,2.78),(3.68,4.38),(4.62,5.44)]:
            for i in range(4):
                a = split+.27+i*(max_x-split-.54)/4
                b = a+(max_x-split-.54)/4
                face_strip(lm,a,b,y+offset,z,z1,glass,back=reverse)
        lm.box((split+max_x)/2,y+offset,3.10,max_x-split,.13,.25,white)
        lm.box((min_x+split)/2,y+offset,3.12,split-min_x,.40,.25,silver)
    lm.box(min_x+2.5,front-.02,.15,1.64,.10,2.06,glass)
    # The wave is modelled in depth and stays vertically clear over the gates.
    profile = [
        (0.38,.27,3.73),(0.72,.18,4.88),(1.45,.45,5.65),(2.44,1.52,6.02),
        (3.73,2.79,6.33),(5.7,3.79,6.25),(8.4,4.18,6.00),(11.0,4.02,5.69),
        (13.2,3.57,5.37),(15.1,3.52,5.52),(17.1,3.54,5.77),(19.1,3.53,5.90),
        (21.0,3.47,5.44),(22.6,3.47,4.83),(24.1,3.65,4.89),(25.4,4.17,5.09)
    ]
    wave = lm.tile('lettered ferry wave','ferry_wave',(12,4),profile=profile)
    u0, u1 = profile[0][0], profile[-1][0]
    for (x,a,b),(xx,c,d) in zip(profile,profile[1:]):
        u,v = (x-u0)/(u1-u0),(xx-u0)/(u1-u0)
        x,xx = min_x+x,min_x+xx
        lm.face([(x,front-.48,a),(xx,front-.48,c),(xx,front-.48,d),(x,front-.48,b)],
                wave,[(u,a/6.4),(v,c/6.4),(v,d/6.4),(u,b/6.4)])
        lm.face([(x,front-.10,a),(xx,front-.10,c),(xx,front-.48,c),(x,front-.48,a)],blue)
        lm.face([(x,front-.48,b),(xx,front-.48,d),(xx,front-.10,d),(x,front-.10,b)],sky)
    for i in range(4):
        x = min_x+.15+i*.40
        beam(lm,(x,front+.04,3.05),(x-.20,front+.04,6.68-i*.087),.18,silver)
    # The 2025 harbour view identifies the red name and the blue-and-white fins.
    harbor = paint_sign(lm,'哈瑪星','#56636a','#f47a64',span=(5,1),serif=True,aspect=5)
    harbor_en = paint_sign(lm,'Hamasen','#edf0e9','#353c3d',span=(3,1),aspect=6)
    pier = paint_sign(lm,'鼓山輪渡站','#e9e9df','#725645',span=(6,1),serif=True,aspect=8)
    face_strip(lm,min_x+9.5,min_x+16.3,back+.026,4.61,5.97,harbor,back=True)
    face_strip(lm,min_x+10.5,min_x+15.3,back+.028,4.06,4.86,harbor_en,back=True)
    face_strip(lm,min_x+11.0,min_x+19.0,back+.19,2.77,3.31,pier,back=True)
    for x in [min_x+3.02,min_x+7.0]:
        for j,color in enumerate([blue,sky,foam,blue]):
            xx=x+j*.24
            lm.wall((xx+.24,back+.21),(xx,back+.21),3.15,6.2,color)
    # Street-side queuing canopy, set out of the open ferry bays.
    lm.box(split+6.4,front-.91,2.54,16.7,2.12,.23,white,bottom=white)
    for x in [split-.70,split+3.7,split+8.1,split+12.5]:
        solid_box(x-.085,x+.085,front-1.82,.17,.09,2.48,white)
        beam(lm,(x,front-1.85,2.77),(x,front-.28,3.54),.10,white)
    lm.box(split+6,front-1.82,1.04,13.6,.11,.10,white)
    views(lm,52,(0,cy,3.10),elevation=14)
    street_view(lm,front-1.82,z=3.25,distance=23,lens=20)
    return lm


BUILDERS = {
    'hamasen-wude': wude,
    'hamasen-temple': temple,
    'hamasen-mrt-exit-1': exit_one,
    'hamasen-mrt-exit-2': exit_two,
    'hamasen-light-rail': light_rail,
    'hamasen-railway-museum': railway_museum,
    'hamasen-gushan-school': elementary_school,
    'hamasen-gushan-ferry': ferry,
}
