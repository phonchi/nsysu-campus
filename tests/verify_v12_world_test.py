"""tools/verify_v12_world.py 的反例測試：資料正確時沒有錯誤，每一種承諾的檢查都真的會抓到問題。

    python3 -B -m unittest tests/verify_v12_world_test.py

要先跑過 apply_v12_sea.py、apply_v12_bus.py、apply_v12_sports.py、apply_v12_sea_events.py。
"""
import copy
import importlib.util
import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('verify_v12_world', TOOLS / 'verify_v12_world.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
import v12_world_common as C  # noqa: E402

BASE = module.load()


class VerifyV12WorldTests(unittest.TestCase):
    def setUp(self):
        self.d = copy.deepcopy(BASE)

    def errors(self):
        return module.verify(self.d)[0]

    def assertCaught(self, needle):
        found = self.errors()
        self.assertTrue(any(needle in e for e in found), f'沒有抓到「{needle}」；錯誤清單：{found[:8]}')

    def route(self, rid='campus-bus'):
        return next(r for r in self.d['bus']['routes'] if r['id'] == rid)

    def test_authored_data(self):
        self.assertEqual(self.errors(), [])

    # ---- 來源 ----
    def test_unapproved_url(self):
        self.d['sea']['sailingShow']['sources'] = ['https://www.nsysu.edu.tw/']
        self.assertCaught('不是核准的網址')

    def test_unknown_source_id(self):
        self.d['sports']['facilities'][0]['sourceIds'] = ['S15']
        self.assertCaught('不在 S1–S14')

    def test_local_source_outside_data_sources(self):
        self.d['bus']['routes'][0]['sourceFiles'] = ['docs/spec-v12.md']
        self.assertCaught('data/sources/**')

    def test_stray_url_anywhere(self):
        self.d['sea']['seaCenter']['designNote'] = 'https://example.com/map'
        self.assertCaught('不是核准的來源')

    # ---- 幾何 ----
    def test_polygon_outside_play_bounds(self):
        self.d['sports']['facilities'][0]['polygon'][0] = [-900.0, 0.0]
        self.assertCaught('PLAY_BOUNDS')

    def test_self_intersecting_polygon(self):
        poly = self.d['sea']['surfZone']['polygon']
        poly[1], poly[2] = poly[2], poly[1]
        self.assertCaught('自我相交')

    def test_swim_zone_too_far_from_beach(self):
        self.d['sea']['waterBodies'][0]['polygon'][3] = [-420.0, 160.0]
        self.assertCaught('25–60')

    def test_swim_zone_into_breakwater(self):
        self.d['sea']['hazards'][0]['polygon'] = [[-331.0, 150.0], [-380.0, 150.0], [-380.0, 300.0], [-331.0, 300.0]]
        self.assertCaught('伸進禁入區')

    # ---- 帆船 ----
    def test_sailing_crosses_craft_corridor_between_vertices(self):
        boat = self.d['sea']['sailingShow']['boats'][0]
        boat['path'] = [[-490, -0.655, 210], [-420, -0.655, 210], [-490, -0.655, 220]]
        self.assertCaught('corridor 不足 10 m')

    def test_sailing_gap_checks_segments_not_only_vertices(self):
        self.assertEqual(C.path_polygon_gap([[-2, 0], [2, 0]], [[-1,-1],[1,-1],[1,1],[-1,1]]), 0)
        self.assertEqual(C.path_polygon_gap([[-20, 0], [-11, 0]], [[-1,-1],[1,-1],[1,1],[-1,1]]), 10)

    def test_seven_boats(self):
        self.d['sea']['sailingShow']['boats'].pop()
        self.assertCaught('兩隊各 4 艘')

    def test_uneven_teams(self):
        self.d['sea']['sailingShow']['boats'][0]['team'] = 'osaka'
        self.assertCaught('兩隊各 4 艘')

    def test_boat_inside_swim_zone(self):
        self.d['sea']['sailingShow']['boats'][0]['path'] = [[-360.0, -0.6, 150.0], [-360.0, -0.6, 160.0]]
        self.assertCaught('游泳區外側')

    # ---- 公車 ----
    def test_stop_order(self):
        occ = self.route()['stopOccurrences']
        occ[1], occ[2] = occ[2], occ[1]
        self.assertCaught('站序')

    def test_return_trip_must_skip_admin(self):
        r = self.route()
        admin = next(o for o in self.route('orange-1-ext')['stopOccurrences'] if o['stopId'] == 'admin-down')
        r['stopOccurrences'].insert(-1, dict(admin))
        self.assertCaught('站序')

    def test_broken_edge_chain(self):
        leg = self.route()['legs'][2]
        del leg['sourceEdgeIds'][len(leg['sourceEdgeIds']) // 2]
        self.assertCaught('路徑斷開')

    def test_unknown_edge(self):
        self.route()['legs'][0]['sourceEdgeIds'][0] = '0-999999'
        self.assertCaught('不是 graph 上的可行車邊')

    def test_path_gap_between_legs(self):
        self.route()['legs'][3]['path'][0][0] += 30
        self.assertCaught('不連續')

    def test_stale_graph_revision(self):
        self.d['graph']['nodes'][0]['p'][0] += 1
        self.assertCaught('revision')

    def test_tight_turnaround(self):
        patch = next(p for p in self.d['bus']['roadPatches'] if p['id'] == 'la-forecourt')
        cx = sum(p[0] for p in patch['centerline']) / len(patch['centerline'])
        cz = sum(p[2] for p in patch['centerline']) / len(patch['centerline'])
        patch['centerline'] = [[cx + (p[0] - cx) * 0.5, p[1], cz + (p[2] - cz) * 0.5] for p in patch['centerline']]
        self.assertCaught('轉彎半徑')

    # ---- 運動 ----
    def test_missing_venue(self):
        self.d['sports']['facilities'] = [v for v in self.d['sports']['facilities'] if v['id'] != 'rink']
        self.assertCaught('缺少場地 rink')

    def test_track_gate_sequence(self):
        course = next(c for c in self.d['sports']['courses'] if c['mode'] == 'run')
        course['requiredGateSequence'] = course['requiredGateSequence'][:-1]
        self.assertCaught('4 個 gate')

    def test_portal_inside_gym(self):
        if self.d['gymBoxes'] is None:
            self.skipTest('沒有體育館碰撞盒')
        x, z = C.landmark_to_world('gym', 0.0, 0.0)
        self.d['sports']['portals'][0]['exteriorTrigger'] = [x, 0.0, z]
        self.assertCaught('實心碰撞盒')

    def test_equipment_outside_room(self):
        self.d['sports']['equipment'][0]['position'][0] += 100
        self.assertCaught('必須在室內房間裡')

    # ---- 台詞與事件 ----
    def test_line_too_long(self):
        self.d['sea']['lines']['storm']['text'] = '遇' * 29
        self.assertCaught('超過 28 字')

    def test_half_width_punctuation(self):
        self.route()['announcements']['board'] = '歡迎上車,請坐穩。'
        self.assertCaught('半形標點')

    def test_unapproved_claim(self):
        self.route()['announcements']['board'] = '上車請刷卡。'
        self.assertCaught('未核准的敘述')

    def test_surf_step_needs_presentation(self):
        event = next(e for e in self.d['npcs']['events'] if e['id'] == 'ev-surf-class')
        del next(s for s in event['activity']['steps'] if s['kind'] == 'rhythm')['presentation']
        self.assertCaught("presentation:'surf'")

    def test_missing_npc(self):
        self.d['npcs']['npcs'] = [n for n in self.d['npcs']['npcs'] if n['id'] != 'lifeguard-sea']
        self.assertCaught('缺少 NPC lifeguard-sea')

    def test_water_path_on_land(self):
        self.d['sea']['sailingShow']['boats'][0]['path'][0] = [-280, -0.6, 100]
        self.assertCaught('水面探測失敗')

    def test_return_too_far_from_water(self):
        self.d['sea']['waterBodies'][0]['safeReturnPoints'][0][0] += 3
        self.assertCaught('0.4–2.5')

    def test_exit_inside_water(self):
        self.d['sea']['waterBodies'][0]['exitPoints'][0][0] = -350
        self.assertCaught('0.4–2.5')

    def test_launch_too_close_to_water(self):
        self.d['sea']['waterRoutes'][0]['launchPoint'][0] = -330.1
        self.assertCaught('0.4–2.5')

    def test_forecourt_wrong_center(self):
        self.d['bus']['forecourt']['center'] = [-300, -800]
        self.assertCaught('離新中心')

    def test_forecourt_steep_terrain(self):
        patch = next(p for p in self.d['bus']['roadPatches'] if p['id']=='la-forecourt')
        patch['centerline'][0] = [0,100,-900]
        self.assertCaught('地表高差')

    def test_boarding_on_bus_centerline(self):
        s=self.d['bus']['stops'][0]
        s['boardingPoint']=s['berth']['position'][:]
        self.assertCaught('離路徑中心線不足')

    def test_alighting_floats_above_ground(self):
        self.d['bus']['stops'][0]['alightingPoints'][0][1]+=3
        self.assertCaught('不可站立')

    def test_driver_on_bus_centerline(self):
        n=next(n for n in self.d['npcs']['npcs'] if n['id']=='bus-driver-campus')
        p=self.d['bus']['stops'][0]['berth']['position']
        n['schedule']['day']={'at':[p[0],p[2]]}
        self.assertCaught('司機離路徑中心線不足')

    def test_portal_return_inside_solid(self):
        p=self.d['sports']['portals'][0]['exteriorReturnPoints'][0]
        p[0],p[2]=C.landmark_to_world('gym',0,0)
        self.assertCaught('實心碰撞盒')

    def test_equipment_exit_inside_equipment(self):
        e=self.d['sports']['equipment'][0]
        e['exitPoints'][0]=e['position'][:]
        self.assertCaught('器材實心盒')

    def test_missing_scene_for_loader(self):
        self.d['fitness']['scenes']=[]
        self.assertCaught('loader scenes')

    def test_facility_missing_kind(self):
        del self.d['sports']['facilities'][0]['kind']
        self.assertCaught('場地必須有 kind、id')


if __name__ == '__main__':
    unittest.main()
