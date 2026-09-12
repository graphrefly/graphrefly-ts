#!/usr/bin/env python3
"""Synthetic full archive verification; no real consumer execution."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v = load('run_verifier', 'verify-causal-recording-run.py')
f = load('synthetic_child', 'causal-recording-fixture.py')


def put(path, value):
    path.write_text(json.dumps(value))


def make_archive(root):
    (root / 'assets').mkdir()
    (root / 'assets' / 'tool.mjs').write_text('// synthetic fixture only\n')
    (root / 'approval.txt').write_text('SYNTHETIC: NOT EXECUTION AUTHORIZATION')
    put(root / 'qualification.json', {'synthetic': True})
    put(root / 'P2-inputs.json', {'synthetic': True})
    jobs, children = [], []
    for round_id in range(4):
        for condition in ('EAGER', 'DEFERRED'):
            for orientation in ('U', 'V'):
                i = len(jobs)
                job = dict(id=i, round=round_id, condition=condition, orientation=orientation)
                jobs.append(job)
                folder = root / f"{job['id']:02d}"
                folder.mkdir()
                put(folder / 'config.json', dict(**job, row=dict(id='cold-P2-summary', group='cold', profile='P2', mode='summary'),
                                                 kind='control', control=True, output=str(folder), scenarioPath=str(root / 'P2-inputs.json')))
                put(folder / 'worker.json', dict(pid=100 + i, timeOrigin=1000000 + i))
                put(folder / 'entry.json', dict(pid=100 + i, timeOrigin=1000000 + i, node='v24.18.0', execArgv=v.FLAGS))
                outcome = dict(pid=100 + i, exitCode=0, reason=None, endedElapsed=i * 6 + 6,
                               observations=[dict(elapsed=i * 6 + j / 2, childElapsed=j / 2,
                                                  gap=.5, rssBytes=1000, directoryBytes=1000) for j in range(1, 13)])
                put(folder / 'exit.json', outcome)
                children.append({'job': job, 'result': outcome})
                put(folder / 'completion.json', dict(completed=True, samples=2400))
                samples, diagnostic, recording = f.fixture(condition, orientation)
                put(folder / 'recording.json',recording)
                (folder / 'samples.jsonl').write_text(''.join(json.dumps(s) + '\n' for s in samples))
                put(folder / 'diagnostic.json', diagnostic)
    reservation = dict(jobs=jobs, flags=v.FLAGS,
                       sourceDigests={'assets/tool.mjs': v.digest(root / 'assets/tool.mjs')},
                       approvalDigest=v.digest(root / 'approval.txt'), qualificationDigest=v.digest(root / 'qualification.json'),
                       scenarioDigest=v.digest(root / 'P2-inputs.json'), nodeDigest='a' * 64)
    put(root / 'reservation.json', reservation)
    put(root / 'result.json', dict(completed=True, children=children, notRun=[]))


class RunVerifierTests(unittest.TestCase):
    def test_full_and_rejections(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_archive(root)
            report = v.verify(root)
            self.assertEqual(report['sampleCount'], 38400)
            self.assertEqual(len(report['ratios']), 48)
            self.assertEqual(report['ratios'][0]['ratios']['p95Ms'], .5)
            self.assertAlmostEqual(report['ratios'][1]['ratios']['constructionSumMs'], .5)
            self.assertNotEqual(report['ratios'][0]['ratios']['commonSpanMs'], 2)
            self.assertTrue(report['consistentFirstBatch'])
            self.assertEqual(len(report['wholePairs']),8)
            self.assertGreater(report['wholePairs'][0]['ratios']['userMs'],1)
            self.assertEqual(report['children'][2]['analysis']['flush']['userMs'],180)
            cases = [
                ('02/recording.json', lambda x: x['checkpoints'].pop(1)),
                ('02/recording.json', lambda x: x['checkpoints'][1].update(wallBefore=0)),
                ('02/recording.json', lambda x: x.update(condition='EAGER')),
                ('reservation.json', lambda x: x['jobs'][1].update(round=x['jobs'][0]['round'], condition=x['jobs'][0]['condition'], orientation=x['jobs'][0]['orientation'])),
                ('reservation.json', lambda x: x.update(approvalDigest='0' * 64)),
                ('reservation.json', lambda x: x.update(sourceDigests={'../outside': '0' * 64})),
                ('reservation.json', lambda x: x['flags'].append('--expose-gc')),
                ('01/entry.json', lambda x: x.update(pid=100)),
                ('01/entry.json', lambda x: x.update(timeOrigin=1000000)),
                ('01/entry.json', lambda x: x.update(node='v22.0.0')),
                ('00/worker.json', lambda x: x.update(pid=101)),
                ('00/config.json', lambda x: x.update(kind='main')),
                ('result.json', lambda x: x.update(completed=False)),
                ('result.json', lambda x: x.update(notRun=['23'])),
                ('00/completion.json', lambda x: x.update(samples=2399)),
            ]
            for path, mutation in cases:
                with self.subTest(path=path, mutation=mutation):
                    target = root / path
                    original = target.read_bytes()
                    value = json.loads(original)
                    mutation(value)
                    put(target, value)
                    with self.assertRaises(ValueError):
                        v.verify(root)
                    target.write_bytes(original)
            for key, value in [('rssBytes', 256 * 1024 ** 2 + 1), ('gap', 1.1), ('childElapsed', 31), ('childElapsed', 2), ('gap', .1), ('directoryBytes', 256 * 1024 ** 2 + 1)]:
                with self.subTest(resource=key):
                    child_original = (root / '00/exit.json').read_bytes()
                    result_original = (root / 'result.json').read_bytes()
                    outcome = json.loads(child_original)
                    outcome['observations'][0][key] = value
                    put(root / '00/exit.json', outcome)
                    result = json.loads(result_original)
                    result['children'][0]['result'] = outcome
                    put(root / 'result.json', result)
                    with self.assertRaises(ValueError):
                        v.verify(root)
                    (root / '00/exit.json').write_bytes(child_original)
                    (root / 'result.json').write_bytes(result_original)


if __name__ == '__main__':
    unittest.main()
