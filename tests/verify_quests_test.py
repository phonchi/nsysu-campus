"""Targeted negative cases ensure the build verifier catches the promised regressions."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('verify_quests', Path(__file__).resolve().parents[1] / 'tools/verify_quests.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VerifyQuestsTests(unittest.TestCase):
    def setUp(self):
        self.data = copy.deepcopy(module.load())

    def errors(self):
        return module.verify(*self.data)

    def test_authored_data(self):
        self.assertEqual(self.errors(), [])

    def test_missing_graph_anchor(self):
        del self.data[5]['anchors']['IL']
        self.assertTrue(any('routes.anchor(IL)' in e for e in self.errors()))

    def test_remote_speaker(self):
        self.data[0]['quests'][0]['steps'][1]['lines'][0]['who'] = 's1'
        self.assertTrue(any('speaker s1 is not on location' in e for e in self.errors()))

    def test_inherited_time_without_npc(self):
        stage = next(q for q in self.data[0]['quests'] if q['id'] == 'sea-stage')
        del stage['steps'][1]['when']
        self.data[2]['npcs'][next(i for i, n in enumerate(self.data[2]['npcs']) if n['id'] == 'intl-mia')]['schedule']['sunset'] = None
        self.assertTrue(any('inherited-time NPC absent' in e for e in self.errors()))

    def step_with(self, prefix):
        return next(s for q in self.data[0]['quests'] for s in q['steps'] if s['target'].startswith(prefix))

    def test_bare_zone_step(self):
        self.step_with('spot:')['target'] = 'zone:gate'
        self.assertTrue(any('not a bare zone' in e for e in self.errors()))

    def test_unknown_spot_and_room(self):
        self.step_with('spot:')['target'] = 'spot:nowhere'
        self.step_with('dest:')['target'] = 'dest:SC9999'
        errors = self.errors()
        self.assertTrue(any('unknown target spot:nowhere' in e for e in errors))
        self.assertTrue(any('unknown target dest:SC9999' in e for e in errors))

    def test_room_known_only_by_its_map_label(self):
        # SC4010 has a label on the plan and, until its polygon lands, no room: it must still count.
        self.assertIn('SC4010', module.building_rooms('SC4010'))

    def test_spot_in_a_building_or_out_of_reach(self):
        spots = self.data[0]['spots']
        spots['gate-notice']['stand'] = [spots['gate-notice']['at'][0] + 6, spots['gate-notice']['at'][1]]
        ad = next(l for l in self.data[6]['context']['landmarks'] if l['id'] == 'AD')['polygon']
        spots['admin-planters']['at'] = spots['admin-planters']['stand'] = [sum(p[0] for p in ad) / len(ad), sum(p[1] for p in ad) / len(ad)]
        errors = self.errors()
        self.assertTrue(any('gate-notice: stand point out of reach' in e for e in errors))
        self.assertTrue(any('admin-planters: object inside a building' in e for e in errors))

    def test_wide_radius_and_unused_spot(self):
        self.step_with('spot:')['radius'] = 8
        self.data[0]['spots']['spare'] = dict(self.data[0]['spots']['gate-notice'])
        errors = self.errors()
        self.assertTrue(any('radius over' in e for e in errors))
        self.assertTrue(any('spot spare: no step or work uses it' in e for e in errors))

    def test_legacy_contract_and_results(self):
        q = self.data[0]['quests'][0]
        q['steps'][0]['id'] = 'changed'
        q['reward'] = 'changed'
        q['legacyRewards'] = []
        q['steps'][-1]['choices'][0]['result'] = '對方笑著向你道謝。'
        errors = self.errors()
        for text in ('step IDs/count changed', 'reward changed', 'old template result'):
            self.assertTrue(any(text in e for e in errors), errors)

    def test_save_contract_catches_moves_without_a_legacy_order(self):
        quests = self.data[0]['quests']
        mia = next(q for q in quests if q['id'] == 'gate-mia')
        self.assertEqual(mia['revision'], 3)
        self.assertEqual(mia['legacyStepOrder'], self.data[0]['saveContract']['quests']['gate-mia']['steps'])
        del mia['legacyStepOrder']
        lost = next(q for q in quests if q['id'] == 'gate-lost')
        lost['steps'][1], lost['steps'][2] = lost['steps'][2], lost['steps'][1]
        lost['revision'] = 1
        errors = self.errors()
        self.assertTrue(any('gate-mia: legacyStepOrder must equal' in e for e in errors), errors)
        self.assertTrue(any('gate-lost: steps moved without a revision bump' in e for e in errors), errors)
        self.assertTrue(any('gate-lost: legacyStepOrder must equal' in e for e in errors), errors)

    def test_save_contract_covers_every_quest_and_choice(self):
        quests = self.data[0]['quests']
        del self.data[0]['saveContract']['quests']['math-day']
        self.data[0]['saveContract']['quests']['ghost'] = {'steps': ['return'], 'reward': 'x', 'gate': 'c1-gate', 'choices': {}}
        quests[0]['steps'][-1]['choices'][0]['id'] = 'z'
        errors = self.errors()
        self.assertTrue(any('math-day: quest missing from the save contract' in e for e in errors), errors)
        self.assertTrue(any('ghost: quest in the save contract no longer exists' in e for e in errors), errors)
        self.assertTrue(any('the fourteen quest ids must match the save contract' in e for e in errors), errors)
        self.assertTrue(any('gate-lost/return: saved choice ids' in e for e in errors), errors)

    def test_rewritten_quests_end_on_return_with_choices(self):
        for q in self.data[0]['quests']:
            self.assertEqual(q['steps'][-1]['id'], 'return', q['id'])
            self.assertGreaterEqual(len(q['steps'][-1]['choices']), 2, q['id'])
        q = self.data[0]['quests'][0]
        q['steps'].append({'id': 'extra', 'target': 'npc:guard-chung', 'text': 'x', 'lines': [{'who': 'guard-chung', 'text': 'x'}]})
        self.assertTrue(any('gate-lost: delivery must be last' in e for e in self.errors()))

    def test_route_warnings_come_from_fixtures_not_authored_data(self):
        # v10.2: every quest is audited at each acceptable time. A fixture leg to the seawall and a fixture retrace warn; a warning never fails verify().
        quests, _, npcs, zones, chapters, graph, _, _ = self.data
        placement = module.placements(npcs, zones, chapters, graph)[2]
        legs, total, net = module.quest_route(next(q for q in quests['quests'] if q['id'] == 'gate-lost'), quests['spots'], placement, len(chapters['chapters']), 'day')
        self.assertLess(total, 25)
        self.assertEqual([a for a, _, _ in legs], ['npc:guard-chung', 'npc:guard-chung', 'spot:gate-notice', 'spot:gate-lost-ledger'])
        lost = next(q for q in quests['quests'] if q['id'] == 'gate-lost')
        lost['accept']['times'] = ['day', 'sunset', 'night']
        lost['steps'][2]['target'] = 'npc:clerk-jie'
        lost['steps'][2]['lines'] = [{'who': 'clerk-jie', 'text': '還沒有人來認領。'}]
        del quests['spots']['gate-lost-ledger']
        del lost['works'][1]
        self.assertEqual(self.errors(), [])
        warnings = module.route_warnings(quests, npcs, zones, chapters, graph)
        self.assertTrue(any(w.startswith('gate-lost/day: spot:gate-notice → npc:clerk-jie is 7') for w in warnings), warnings)
        self.assertTrue(any(w.startswith('gate-lost/sunset: retrace 100%') for w in warnings), warnings)
        self.assertTrue(any(w.startswith('gate-lost/night: retrace 100%') for w in warnings), warnings)
        self.assertFalse(any(w.startswith('arcade-coffee') for w in warnings), warnings)

    def test_authored_routes_are_short_once_the_v102_schedules_land(self):
        # npcs.json belongs to the coordinator: with the four spec §2 schedule changes applied in memory, no acceptable time warns.
        quests, _, npcs, zones, chapters, graph, _, _ = self.data
        people = {n['id']: n for n in npcs['npcs']}
        people['photo-ju']['schedule']['day'] = {'at': 'tunnel-west', 'offset': [-9, -3], 'activity': 'Idle'}
        people['club-ocean-ting']['schedule']['day']['offset'] = [9, 9.5]
        people['poet-wen']['schedule']['day'] = {'at': 'library', 'offset': [-7, -7], 'activity': 'Idle'}
        self.assertEqual(self.errors(), [])
        self.assertEqual(module.route_warnings(quests, npcs, zones, chapters, graph), [])
        placement = module.placements(npcs, zones, chapters, graph)[2]
        for q in quests['quests']:
            for time in q['accept']['times']:
                legs, total, _ = module.quest_route(q, quests['spots'], placement, len(chapters['chapters']), time)
                self.assertLessEqual(total, 165, (q['id'], time, total))

    def test_accept_times_are_required_and_checked_against_schedules(self):
        quests = self.data[0]['quests']
        del next(q for q in quests if q['id'] == 'gate-lost')['accept']['times']
        mia = next(q for q in quests if q['id'] == 'gate-mia')
        mia['accept']['times'] = ['day', 'dawn']
        errors = self.errors()
        self.assertTrue(any(e.startswith('gate-lost: accept.times must list') for e in errors), errors)
        self.assertTrue(any(e.startswith('gate-mia: accept.times must list') for e in errors), errors)
        mia['accept']['times'] = ['night']
        self.assertTrue(any(e.startswith('gate-mia/night/chapter-count=') and 'giver is off campus' in e for e in self.errors()))
        stage = next(q for q in quests if q['id'] == 'sea-stage')
        stage['accept']['times'] = ['night']
        for step in stage['steps']:
            step['when'] = 'night'
        self.assertTrue(any('sea-stage/errand-2/night/chapter-count=' in e and 'acceptable while npc:intl-mia is off campus' in e for e in self.errors()))

    def test_legacy_contract_relaxations_still_catch_regressions(self):
        quests = self.data[0]['quests']
        lost = next(q for q in quests if q['id'] == 'gate-lost')
        lost['legacyRewards'] = ['別的名字']
        photo = next(q for q in quests if q['id'] == 'tunnel-photo')
        photo['accept']['chapterDone'] = 'c5-arcade'
        garden = next(q for q in quests if q['id'] == 'admin-garden')
        garden['steps'] = [s for s in garden['steps'] if s['id'] != 'errand-3']
        garden['legacySteps'] = {'errand-3': 'nowhere', 'errand-2': 'return'}
        errors = self.errors()
        self.assertTrue(any(e == 'gate-lost: reward changed' for e in errors), errors)
        self.assertTrue(any(e == 'tunnel-photo: incorrect chapter gate c5-arcade' for e in errors), errors)
        self.assertTrue(any('admin-garden: legacySteps maps errand-3 to missing nowhere' in e for e in errors), errors)
        self.assertTrue(any('admin-garden: legacySteps retires errand-2, which still exists' in e for e in errors), errors)
        self.assertTrue(any("admin-garden: save step IDs/count changed" in e and 'errand-3' in e for e in errors), errors)
        garden['legacySteps'] = {'errand-3': 'return'}
        garden['revision'] = 2
        garden['legacyStepOrder'] = ['errand-1', 'errand-2', 'errand-3', 'return']
        del self.data[0]['spots']['admin-sea-view']
        self.assertFalse(any(e.startswith('admin-garden') or 'admin-sea-view' in e for e in self.errors()), self.errors())
        # The gate may move earlier (tunnel-photo c4 → c2 is authored) but never later; an unknown gate still fails.
        photo['accept']['chapterDone'] = 'c1-gate'
        self.assertFalse(any(e.startswith('tunnel-photo: incorrect chapter gate') for e in self.errors()))

    def test_works_need_existing_spots_kinds_flags_and_one_owner(self):
        quests = self.data[0]['quests']
        lost = next(q for q in quests if q['id'] == 'gate-lost')
        lost['works'][0]['spot'] = 'nowhere'
        lost['works'][1]['variants'][0]['kind'] = 'hologram'
        lost['works'][1]['if'] = {'any': [{'flag': 'quest.gate-lost.return.z'}]}
        mia = next(q for q in quests if q['id'] == 'gate-mia')
        mia['works'] = [{'id': 'steal', 'spot': 'admin-planters', 'if': {'flag': 'quest.gate-mia.done'}, 'variants': []}, {'id': 'steal', 'spot': 'library-shade', 'if': {'flag': 'quest.gate-mia.done'}}]
        errors = self.errors()
        for text in ('gate-lost/work:claim-notice: unknown spot nowhere', 'gate-lost/work:ledger-line: unknown variant kind hologram',
                     'gate-lost/work:ledger-line: condition uses unknown quest flag quest.gate-lost.return.z',
                     'spot admin-planters already belongs to', 'gate-mia/work:steal: missing or duplicate work id'):
            self.assertTrue(any(text in e for e in errors), (text, errors))
        self.assertFalse(any('library-shade already belongs' in e for e in errors), errors)
        del self.data[0]['spots']['library-reco-wall']
        next(q for q in quests if q['id'] == 'library-corner')['works'] = []
        self.assertFalse(any('library-reco-wall' in e and 'no step or work' in e for e in self.errors()))
        self.data[0]['spots']['library-reco-wall'] = {'kind': 'wall', 'label': 'x', 'at': [-58, -61.5], 'stand': [-56, -60.2]}
        self.assertTrue(any('spot library-reco-wall: no step or work uses it' in e for e in self.errors()))

    def test_completion_rewards_match_collection_items(self):
        quests, collection = self.data[0]['quests'], self.data[7]
        lost = next(q for q in quests if q['id'] == 'gate-lost')
        lost['completionRewards'] = [{'kind': 'item', 'itemId': 'item-usb'}]
        mia = next(q for q in quests if q['id'] == 'gate-mia')
        del next(i for i in collection['items'] if i['id'] == 'item-quest-gate-mia')['variants']['b']
        photo = next(q for q in quests if q['id'] == 'tunnel-photo')
        photo['completionRewards'][0]['variantBy'] = 'explore'
        collection['items'].append({'id': 'item-quest-ghost', 'name': 'x', 'desc': 'y', 'group': 'quest'})
        errors = self.errors()
        for text in ('gate-lost: completionRewards must be the one item item-quest-gate-lost', 'collectible item-quest-gate-lost: no quest grants it',
                     'gate-mia: collectible item-quest-gate-mia needs variant b', 'tunnel-photo: variantBy explore is not a choice step', 'collectible item-quest-ghost: no quest grants it'):
            self.assertTrue(any(text in e for e in errors), (text, errors))
        self.assertEqual(sum(1 for i in collection['items'] if i.get('group') == 'quest'), 15)

    def test_schedule_overrides_keep_the_base_zone_and_known_flags(self):
        npcs = self.data[2]
        npcs['scheduleOverrides'] = [
            {'npc': 'intl-mia', 'preset': 'day', 'if': {'flag': 'quest.gate-mia.return.a'}, 'at': 'library', 'offset': [10, -6], 'activity': 'Sit'},
            {'npc': 'intl-mia', 'preset': 'day', 'if': {'flag': 'quest.gate-mia.return.b'}, 'at': 'arcade', 'offset': [14, -5], 'activity': 'Sit'},
            {'npc': 'intl-mia', 'preset': 'night', 'if': {'flag': 'quest.gate-mia.done'}, 'at': 'library'},
            {'npc': 'nobody', 'preset': 'dusk', 'if': {'all': [{'notFlag': 'quest.nope.done'}]}, 'at': 'library'},
        ]
        errors = self.errors()
        self.assertFalse(any('scheduleOverrides[0]' in e for e in errors), errors)
        for text in ('scheduleOverrides[1]: override must keep the base schedule zone library', 'scheduleOverrides[2]: override must keep the base schedule zone None',
                     'scheduleOverrides[3]: unknown npc nobody', 'scheduleOverrides[3]: invalid preset dusk', 'scheduleOverrides[3]: condition uses unknown quest flag quest.nope.done'):
            self.assertTrue(any(text in e for e in errors), (text, errors))

    def test_link_whitelist_matches_the_shared_fixture(self):
        # tests/fixtures/link-cases.json is the coordinator's; the front end (isAllowedLink) reads the same file.
        cases = json.loads((Path(__file__).resolve().parent / 'fixtures/link-cases.json').read_text())
        self.assertTrue(cases['ok'] and cases['bad'])
        for url in cases['ok']:
            self.assertTrue(module.allowed_link(url), url)
        for url in cases['bad']:
            self.assertFalse(module.allowed_link(url), url)
        # Parser-parity cases both sides decide on the raw string (proposed additions to the fixture).
        for url in ('https://MATH.NSYSU.EDU.TW/', 'https://sites.google.com/math.nsysu.edu.tw/', 'https://sites.google.com/math.nsysu.edu.tw?tab=1', 'https://math.nsysu.edu.tw/p/412-1183-915.php?Lang=zh-tw#top'):
            self.assertTrue(module.allowed_link(url), url)
        for url in ('https://math.nsysu.edu.tw:443/', ' https://math.nsysu.edu.tw/', 'https://math.nsysu.edu.tw/ ', 'https://sites.google.com/math.nsysu.edu.tw/../x', 'https://sites.google.com/./math.nsysu.edu.tw',
                    'https://sites.google.com\\math.nsysu.edu.tw', 'https://sites.google.com/%2e%2e/math.nsysu.edu.tw', 'https://sites.google.com/math.nsysu.edu.tw%2Fx', 'https:///math.nsysu.edu.tw', 'HTTPS://math.nsysu.edu.tw:8443/',
                    'https://sites.google.co%6d/math.nsysu.edu.tw', 'https://a%20b.nsysu.edu.tw/', 'https://_x.nsysu.edu.tw/', 'https://math.nsysu.edu.tw./', 
                    'https://math.nsysu.edu.tw/頁', 'https://math.nsysu.edu.tw@attacker.com/', 'https://xn--nsysu.edu.tw/', 'https://.nsysu.edu.tw/', 'ftp://math.nsysu.edu.tw/', None, 7):
            self.assertFalse(module.allowed_link(url), url)

    def test_links_are_limited_and_whitelisted_per_quest_and_step(self):
        quests = self.data[0]['quests']
        freshman = next(q for q in quests if q['id'] == 'math-freshman')
        self.assertEqual(freshman['links'], [{'label': '應數系首頁', 'url': 'https://math.nsysu.edu.tw/'}])
        self.assertEqual([s['id'] for s in freshman['steps'] if s.get('links')], ['office', 'library', 'lab'])
        self.assertEqual(next(q for q in quests if q['id'] == 'math-day')['links'][0]['url'], 'https://highschool-math.nsysu.edu.tw/')
        self.assertEqual(self.errors(), [])
        freshman['links'] = [{'label': 'a', 'url': 'https://math.nsysu.edu.tw/'}] * 3
        freshman['steps'][1]['links'] = [{'label': '', 'url': 'https://math.nsysu.edu.tw/'}, {'label': 'x', 'url': 'http://math.nsysu.edu.tw/'}]
        freshman['steps'][2]['links'] = {'label': 'x', 'url': 'https://math.nsysu.edu.tw/'}
        errors = self.errors()
        for text in ('math-freshman: more than 2 links', 'math-freshman/office: links[0] needs label and url', 'math-freshman/office: links[1] url not allowed http://math.nsysu.edu.tw/', 'math-freshman/library: links must be a list'):
            self.assertTrue(any(text in e for e in errors), (text, errors))

    def test_math_freshman_and_the_renamed_teacher(self):
        quests, npcs, collection = self.data[0]['quests'], self.data[2], self.data[7]
        self.assertEqual([q['id'] for q in quests][-2:], ['math-day', 'math-freshman'])
        self.assertEqual(next(q for q in quests if q['id'] == 'math-day')['next'], ['math-freshman', 'arcade-club'])
        freshman = next(q for q in quests if q['id'] == 'math-freshman')
        self.assertEqual([s['id'] for s in freshman['steps']], ['leaflet', 'office', 'library', 'lab', 'return'])
        self.assertEqual([s['target'] for s in freshman['steps']], ['npc:teacher-chen', 'dest:SC4010', 'dest:SC4009', 'dest:SC2004', 'spot:sc-courtyard-freshman-sign'])
        self.assertEqual(freshman['next'], ['math-day'])
        self.assertEqual(self.data[0]['saveContract']['quests']['math-freshman']['steps'], [s['id'] for s in freshman['steps']])
        chen = next(n for n in npcs['npcs'] if n['id'] == 'teacher-chen')
        self.assertEqual((chen['name'], chen['model'], chen['schedule']['night']), ('陳老師', 'npc-teacher', None))
        self.assertEqual(chen['schedule']['day'], {'at': 'arcade', 'offset': [49.5, -14.5], 'activity': 'Idle'})
        lin = next(n for n in npcs['npcs'] if n['id'] == 'ta-lin')
        self.assertEqual((lin['name'], lin['role']), ('呂老師', '應數系老師'))
        blob = json.dumps([quests, npcs, collection, self.data[0]['spots']], ensure_ascii=False)
        self.assertNotIn('林老師', blob); self.assertNotIn('林助教', blob); self.assertNotIn('助教', blob)
        self.assertIn('arcade-lin-desk', self.data[0]['spots'])  # the spot id stays; only its label changed
        self.assertTrue(any(i['id'] == 'item-quest-math-freshman' and set(i['variants']) == {'a', 'b'} for i in collection['items']))

    def test_seats_registry_and_references(self):
        npcs, zones, graph = self.data[2], self.data[3], self.data[5]
        self.assertEqual(module.verify_seats(npcs, zones, graph), [])
        seats = zones['seats']
        self.assertEqual(zones['zones']['seawall-seat']['seat'], 'seawall-player')
        self.assertEqual(zones['zones']['arcade-seat']['seat'], 'arcade-player')
        for n in npcs['npcs']:
            for time, spec in n['schedule'].items():
                if spec and spec.get('activity') == 'Sit':
                    self.assertEqual(n['model'] != 'monkey', 'seat' in spec, (n['id'], time))
        self.assertEqual(sorted(seats), ['admin-s1', 'arcade-guitar-yun', 'arcade-player', 'bodhi-gardener-hai', 'il-guitar-yun', 'library-mia-desk', 'library-mia-shade', 'library-quiz-dian', 'seawall-guide', 'seawall-player', 'seawall-poet-wen'])
        # Negative cases: dangling reference, a human Sit without a seat, a seat too far, two seats too close, a shared player seat, bad numbers.
        guide = next(n for n in npcs['npcs'] if n['id'] == 'guide')
        guide['schedule']['sunset']['seat'] = 'nowhere'
        del guide['schedule']['night']['seat']
        next(n for n in npcs['npcs'] if n['id'] == 'poet-wen')['schedule']['sunset']['offset'] = [-8, 9]
        seats['arcade-guitar-yun']['foot'] = [-78.9, 127.5]
        zones['zones']['arcade-seat']['seat'] = 'arcade-guitar-yun'
        seats['admin-s1']['yaw'] = float('nan')
        seats['library-quiz-dian']['prop']['kind'] = 'stool'
        npcs['scheduleOverrides'][0]['seat'] = 'il-guitar-yun'
        errors = module.verify_seats(npcs, zones, graph)
        for text in ('guide/sunset: human Sit needs an existing seat (have nowhere)', 'guide/night: human Sit needs an existing seat (have None)', 'poet-wen/sunset: seat seawall-poet-wen is over 1.5 m from the station',
                     'seats arcade-guitar-yun and arcade-player are under 0.7 m apart', 'zone arcade-seat: player seat arcade-guitar-yun is also an NPC seat', 'seat admin-s1: yaw must be finite',
                     'seat library-quiz-dian: prop.kind must be bench', 'seat il-guitar-yun: shared by', 'scheduleOverrides[0]: seat il-guitar-yun is over 1.5 m'):
            self.assertTrue(any(text in e for e in errors), (text, errors))
        # Monkeys never need a seat.
        next(n for n in npcs['npcs'] if n['id'] == 'm1')['schedule']['day']['seat'] = 'nowhere'
        self.assertFalse(any(e.startswith('m1/') for e in module.verify_seats(npcs, zones, graph)))

    def test_chapter_gate_and_encounter_schedule(self):
        self.data[0]['quests'][0]['accept']['chapterDone'] = 'missing'
        next(e for e in self.data[1]['encounters'] if e['id'] == 'rolling-ball')['when'] = 'sunset'
        errors = self.errors()
        self.assertTrue(any('incorrect chapter gate' in e for e in errors))
        self.assertTrue(any('attribution conflicts' in e for e in errors))


if __name__ == '__main__':
    unittest.main()
