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

    def test_chapter_gate_and_encounter_schedule(self):
        self.data[0]['quests'][0]['accept']['chapterDone'] = 'missing'
        next(e for e in self.data[1]['encounters'] if e['id'] == 'rolling-ball')['when'] = 'sunset'
        errors = self.errors()
        self.assertTrue(any('incorrect chapter gate' in e for e in errors))
        self.assertTrue(any('attribution conflicts' in e for e in errors))


if __name__ == '__main__':
    unittest.main()
