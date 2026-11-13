"""Targeted negative cases ensure the build verifier catches the promised regressions."""
import copy
import importlib.util
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
        self.data[2]['npcs'][next(i for i, n in enumerate(self.data[2]['npcs']) if n['id'] == 'jogger-po')]['schedule']['sunset'] = None
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
        self.assertTrue(any('spot spare: no step uses it' in e for e in errors))

    def test_legacy_contract_and_results(self):
        q = self.data[0]['quests'][0]
        q['steps'][0]['id'] = 'changed'
        q['reward'] = 'changed'
        q['steps'][-1]['choices'][0]['result'] = '對方笑著向你道謝。'
        errors = self.errors()
        for text in ('step IDs/count changed', 'reward changed', 'old template result'):
            self.assertTrue(any(text in e for e in errors), errors)

    def test_save_contract_catches_moves_without_a_legacy_order(self):
        quests = self.data[0]['quests']
        mia = next(q for q in quests if q['id'] == 'gate-mia')
        self.assertEqual(mia['revision'], 2)
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
        self.assertTrue(any('gate-lost/return: saved choice ids' in e for e in errors), errors)

    def test_rewritten_quests_end_on_return_with_choices(self):
        for q in self.data[0]['quests']:
            self.assertEqual(q['steps'][-1]['id'], 'return', q['id'])
            self.assertGreaterEqual(len(q['steps'][-1]['choices']), 2, q['id'])
        q = self.data[0]['quests'][0]
        q['steps'].append({'id': 'extra', 'target': 'npc:guard-chung', 'text': 'x', 'lines': [{'who': 'guard-chung', 'text': 'x'}]})
        self.assertTrue(any('gate-lost: delivery must be last' in e for e in self.errors()))

    def test_route_warnings_report_long_legs_and_retracing(self):
        quests, _, npcs, zones, chapters, graph, _ = self.data
        warnings = module.route_warnings(quests, npcs, zones, chapters, graph)
        self.assertTrue(any(w.startswith('tunnel-leaflet: npc:s1 → spot:tunnel-leaflets-mouth is 4') for w in warnings), warnings)
        self.assertTrue(any(w.startswith('library-bookmark: retrace') for w in warnings), warnings)
        self.assertFalse(any(w.startswith('gate-lost:') or w.startswith('arcade-coffee:') for w in warnings), warnings)
        legs, total, net = module.quest_route(next(q for q in quests['quests'] if q['id'] == 'gate-lost'), quests['spots'], module.placements(npcs, zones, chapters, graph)[2], len(chapters['chapters']))
        self.assertLess(total, 25)
        self.assertEqual([a for a, _, _ in legs], ['npc:guard-chung', 'npc:guard-chung', 'spot:gate-notice', 'spot:gate-lost-ledger'])
        # A warning never fails the build: verify() ignores distances.
        lost = next(q for q in quests['quests'] if q['id'] == 'gate-lost')
        lost['steps'][2]['target'] = 'npc:clerk-jie'
        lost['steps'][2]['lines'] = [{'who': 'clerk-jie', 'text': '還沒有人來認領。'}]
        del quests['spots']['gate-lost-ledger']
        self.assertEqual(self.errors(), [])
        warnings = module.route_warnings(quests, npcs, zones, chapters, graph)
        self.assertTrue(any(w.startswith('gate-lost: spot:gate-notice → npc:clerk-jie is 7') for w in warnings), warnings)
        self.assertTrue(any(w.startswith('gate-lost: retrace 100%') for w in warnings), warnings)

    def test_chapter_gate_and_encounter_schedule(self):
        self.data[0]['quests'][0]['accept']['chapterDone'] = 'missing'
        next(e for e in self.data[1]['encounters'] if e['id'] == 'rolling-ball')['when'] = 'sunset'
        errors = self.errors()
        self.assertTrue(any('incorrect chapter gate' in e for e in errors))
        self.assertTrue(any('attribution conflicts' in e for e in errors))


if __name__ == '__main__':
    unittest.main()
