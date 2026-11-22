"""v12 vehicles and water props (spec-v12 §4): campus buses, SUP, kayak, surfboard, Laser-class dinghy,
paddles, swim-zone buoy, lifeguard chair, sports-field furniture.

Run: "$(cat tools/blender-path.txt)" --background --python tools/create_props_v12.py [-- name ...]

Same conventions as tools/create_props_v4.py (whose helpers are reused): primitives only, vertex colours
(COLOR_0, one material per file), origin at the foot centre / waterline centre, front = -Y in Blender
(+Z in glTF), metres. Output: public/models/props/<name>.glb (meshopt). Anchor points (doors, seats,
grips) are listed in public/models/props/README-v12.json in glTF axes (x, y up, z = -Blender y).
"""
from pathlib import Path
import json, math, sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_props_v4 as v4  # noqa: E402  (helpers, palette, material, build/export)

box, cyl, sph, torus, C = v4.box, v4.cyl, v4.sph, v4.torus, v4.C
C.update(busWhite='#f4f1ea', busTeal='#2a8c99', busOrange='#e8762d', tyre='#23252b', supBlue='#4fb3c8',
         kayakRed='#d9573f', foam='#fbf6ea', sail='#f6f3ec', hullWhite='#eef0f0', buoy='#f08a24', lane='#e04b3a',
         court='#4c8f6e', net='#e8e8e8')

def wheels(xs, ys, r=.5, w=.3):
    out = []
    for x in xs:
        for y in ys:
            out += [cyl((x, y, r), r, w, C['tyre'], seg=12, rot=(0, math.pi / 2, 0)), cyl((x * 1.01, y, r), r * .5, w + .02, C['grey'], seg=8, rot=(0, math.pi / 2, 0))]
    return out

def bus(livery):
    L, W, H = 10.5, 2.5, 3.1
    side = C[livery]; body = C['busOrange'] if livery == 'busOrange' else C['busWhite']
    if livery == 'busOrange': side = C['busWhite']
    p = [box((0, 0, .35 + (H - .35) / 2), (W, L, H - .35), body, bevel=.12),
         box((0, 0, 1.0), (W + .02, L - .3, .35), side),                                   # livery band
         box((0, 0, H - .05), (W - .3, L - 1.0, .12), C['grey']),                          # roof unit
         box((0, -L / 2 - .01, 2.1), (W - .3, .02, 1.3), C['glass']),                      # windscreen
         box((0, L / 2 + .01, 2.2), (W - .4, .02, .9), C['glass']),                        # rear window
         box((0, -L / 2 - .02, 2.95), (1.6, .03, .28), C['ink']),                          # destination sign
         box((0, -L / 2 - .03, 2.95), (1.4, .02, .18), C['yellow']),
         box((0, -L / 2 - .05, .7), (W - .1, .1, .35), C['metal']),                        # bumper
         box((-W / 2 + .9, -L / 2 - .02, .9), (.4, .03, .15), C['glow']), box((W / 2 - .9, -L / 2 - .02, .9), (.4, .03, .15), C['glow'])]
    for sgn in (-1, 1):                                                                    # side windows
        for k in range(5):
            y = -2.6 + k * 1.75
            if sgn < 0 and k == 0: continue                                                # front door bay (right side = -X)
            p.append(box((sgn * (W / 2 + .01), y, 2.1), (.02, 1.55, 1.05), C['glass']))
    p += [box((-W / 2 - .015, -3.9, 1.55), (.02, 1.1, 2.3), C['ink']),                    # front door (right side)
          box((-W / 2 - .02, -3.9, 1.55), (.02, .04, 2.2), C['grey']),
          box((-W / 2 - .015, 1.6, 1.55), (.02, 1.1, 2.3), C['ink'])]                     # rear door
    p += wheels((-W / 2 + .12, W / 2 - .12), (-L / 2 + 2.2, L / 2 - 2.4))
    return p

def bus_campus(): return bus('busTeal')
def bus_orange1(): return bus('busOrange')

def sup_board():
    return [sph((0, 0, .06), 1.0, C['supBlue'], seg=16, rings=6, scale=(.4, 1.6, .06)), box((0, .05, .125), (.55, 1.0, .01), C['foam'])]

def sup_paddle():          # shaft along +Z from the blade tip at the origin; length 1.9
    return [box((0, 0, .25), (.2, .03, .45), C['ink'], bevel=.02), cyl((0, 0, 1.15), .016, 1.5, C['metal']), box((0, 0, 1.9), (.12, .03, .04), C['ink'])]

def kayak():
    return [sph((0, 0, .18), 1.0, C['kayakRed'], seg=16, rings=8, scale=(.36, 1.9, .2)),
            sph((0, .15, .33), 1.0, C['ink'], seg=12, rings=4, scale=(.24, .45, .04)),     # cockpit
            box((0, .3, .26), (.36, .4, .06), C['ink'])]

def kayak_paddle():        # centred, shaft along X; length 2.2
    return [cyl((0, 0, 0), .016, 2.0, C['metal'], rot=(0, math.pi / 2, 0)),
            box((-1.05, 0, 0), (.18, .03, .42), C['yellow'], rot=(0, math.pi / 2, 0), bevel=.02), box((1.05, 0, 0), (.18, .03, .42), C['yellow'], rot=(0, math.pi / 2, 0), bevel=.02)]

def surfboard():
    return [sph((0, 0, .04), 1.0, C['foam'], seg=16, rings=6, scale=(.27, 1.05, .04)), box((0, 0, .085), (.04, 1.9, .005), C['orange']),
            box((0, .9, -.05), (.02, .14, .12), C['ink'])]

def laser_dinghy():        # Laser-class: 4.2 m hull, 6.4 m mast, single sail
    return [sph((0, 0, .2), 1.0, C['hullWhite'], seg=16, rings=6, scale=(.68, 2.1, .2)), box((0, .1, .38), (1.0, 2.4, .04), C['white']),
            cyl((0, -.95, 3.4), .04, 6.2, C['metal']), box((0, -.25, .9), (.05, 1.4, .05), C['metal']),               # mast, boom
            box((0, -.3, 3.4), (.02, 1.3, 5.0), C['sail']), box((0, -.3, 4.8), (.025, .5, .5), C['blue']),           # sail + insignia
            box((0, 2.0, -.2), (.03, .3, .6), C['ink']), box((0, -.2, -.45), (.03, .45, .8), C['ink'])]                # rudder, daggerboard

def swim_buoy():
    return [sph((0, 0, .1), .32, C['buoy'], seg=12, rings=6), cyl((0, 0, .48), .02, .5, C['metal']), box((0, 0, .75), (.02, .3, .2), C['yellow'])]

def lane_float():          # one 2 m section of a lane rope
    return [sph((0, -.9 + k * .2, .0), .06, C['lane'] if k % 3 else C['white'], seg=8, rings=4) for k in range(10)]

def lifeguard_chair():
    return [*[cyl((x, y, 1.0), .05, 2.0, C['white']) for x in (-.4, .4) for y in (-.3, .3)], box((0, 0, 2.05), (1.0, .8, .08), C['red']),
            box((0, .38, 2.45), (1.0, .06, .8), C['red']), *[box((0, -.32, .35 + k * .45), (.9, .05, .05), C['white']) for k in range(4)],
            cyl((0, 0, 3.1), .03, 1.4, C['metal']), sph((0, 0, 3.6), .9, C['yellow'], seg=10, rings=4, scale=(1, 1, .25))]

def fitness_station():     # pull-up bar + bench, for the gym portal room and outdoor corner
    return [cyl((-.8, 0, 1.15), .05, 2.3, C['metal']), cyl((.8, 0, 1.15), .05, 2.3, C['metal']), cyl((0, 0, 2.25), .03, 1.7, C['grey'], rot=(0, math.pi / 2, 0)),
            box((0, -1.0, .45), (.4, 1.3, .1), C['ink'], bevel=.03), box((0, -1.0, .2), (.3, 1.1, .4), C['metal'])]

def treadmill():
    return [box((0, 0, .15), (.75, 1.8, .2), C['ink'], bevel=.04), box((0, 0, .27), (.55, 1.55, .03), C['metal']),
            cyl((-.33, -.8, .7), .03, 1.1, C['grey']), cyl((.33, -.8, .7), .03, 1.1, C['grey']), box((0, -.85, 1.25), (.75, .25, .2), C['ink'], bevel=.03)]

def start_gate():          # track start/finish post with a small sign
    return [cyl((0, 0, .7), .04, 1.4, C['white']), box((0, 0, 1.45), (.5, .04, .3), C['red']), box((0, -.025, 1.45), (.4, .01, .18), C['white'])]

PROPS = dict(bus_campus=bus_campus, bus_orange1=bus_orange1, sup_board=sup_board, sup_paddle=sup_paddle, kayak=kayak,
             kayak_paddle=kayak_paddle, surfboard=surfboard, laser_dinghy=laser_dinghy, swim_buoy=swim_buoy, lane_float=lane_float,
             lifeguard_chair=lifeguard_chair, fitness_station=fitness_station, treadmill=treadmill, start_gate=start_gate)

# glTF axes: x, y up, z = -Blender y (front of the prop is +z).
ANCHORS = {
    'bus_campus': dict(length=10.5, width=2.5, height=3.1, frontDoor=[-1.25, 0.35, 3.9], rearDoor=[-1.25, 0.35, -1.6],
                       seat=[0.55, 0.85, 1.0], driver=[0.6, 1.0, 4.3], note='right side (-x) doors; player hidden or seated at seat while carried'),
    'sup_board': dict(length=3.2, width=0.8, deckY=0.13, stand=[0, 0.13, 0.0]),
    'kayak': dict(length=3.8, width=0.72, seatY=0.22, seat=[0, 0.22, -0.2]),
    'surfboard': dict(length=2.1, width=0.54, deckY=0.08),
    'laser_dinghy': dict(length=4.2, width=1.36, mastHeight=6.5, helm=[0.35, 0.4, -1.2]),
    'sup_paddle': dict(length=1.9, axis='+y from blade tip'), 'kayak_paddle': dict(length=2.2, axis='x, centred'),
}
ANCHORS['bus_orange1'] = ANCHORS['bus_campus']

if __name__ == '__main__':
    names = [a for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if not a.startswith('--') and a in PROPS] or list(PROPS)
    v4.PROPS.clear(); v4.PROPS.update(PROPS)
    meta = [v4.build(n) for n in names]
    (v4.OUT / 'README-v12.json').write_text(json.dumps(dict(generator='tools/create_props_v12.py', license='authored in this repo (see docs/licenses.md)',
                                                           props=meta, anchors=ANCHORS), indent=1, ensure_ascii=False) + '\n')
