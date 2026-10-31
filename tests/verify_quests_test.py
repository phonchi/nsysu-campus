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
        stage = self.data[0]['quests'][-1]
        del stage['steps'][1]['when']
        self.data[2]['npcs'][next(i for i, n in enumerate(self.data[2]['npcs']) if n['id'] == 'jogger-po')]['schedule']['sunset'] = None
        self.assertTrue(any('inherited-time NPC absent' in e for e in self.errors()))

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
