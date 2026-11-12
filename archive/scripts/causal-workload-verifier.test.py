#!/usr/bin/env python3
"""Synthetic verifier qualification: no consumer or performance sampling."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('verifier', Path(__file__).with_name('verify-causal-workload-diagnostic.py'))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


def fixture(condition='CPU_GC', orientation='U'):
    orders = [['candidate', 'reference'], ['reference', 'candidate'], ['candidate', 'reference']]
    if orientation == 'V':
        orders = [list(reversed(order)) for order in orders]
    samples, checkpoints = [], []
    for batch, order in enumerate(orders):
        for position, arm in enumerate(order):
            block = batch * 2 + position
            base = block * 10000
            for index in range(400):
                start = base + 10 + index * 10
                samples.append(dict(batch=batch, arm=arm, index=index,
                                    phase='warmup' if index < 100 else 'measured',
                                    start=start, end=start + 2, ms=2))
            for edge, offset in [('warmup', 1), ('measured', 1005), ('end', 4005)]:
                checkpoints.append(dict(batch=batch, arm=arm, edge=edge,
                                        wallBefore=base + offset, wallAfter=base + offset + 1,
                                        user=(base + offset) * 2000, system=(base + offset) * 1000))
    diagnostic = dict(condition=condition, orientation=orientation,
                      checkpoints=[] if condition == 'BASE' else checkpoints,
                      gc=[], disconnectAt=55000 if condition == 'CPU_GC' else None,
                      observerInstalled=condition == 'CPU_GC')
    return samples, diagnostic


class VerifierTests(unittest.TestCase):
    def test_all_conditions_and_orientations(self):
        for condition in ('BASE', 'CPU', 'CPU_GC'):
            for orientation in ('U', 'V'):
                report = v.verify(*fixture(condition, orientation))
                self.assertEqual(len(report['blocks']), 12)
                measured = report['blocks'][1]
                self.assertEqual(measured['p95Ms'], 2)
                self.assertEqual(measured['constructionSumMs'], 600)
                self.assertEqual(measured['commonSpanMs'], 2992)
                self.assertEqual(measured['otherCommonSpanMs'], 2392)

    def test_cpu_greater_than_elapsed_and_nonidentical_boundaries(self):
        report = v.verify(*fixture())['blocks'][1]
        self.assertEqual(report['checkpoint'], dict(elapsedLowerMs=2999, elapsedUpperMs=3001,
                                                   userMs=6000, systemMs=3000))
        self.assertNotEqual(report['commonSpanMs'], report['checkpoint']['elapsedLowerMs'])

    def test_overlap_union_cross_boundary_and_late_callback(self):
        samples, diagnostic = fixture()
        diagnostic['gc'] = [dict(startTime=999, duration=16, receivedAt=2000, kind=1, flags=0),
                            dict(startTime=1000, duration=20, receivedAt=54000, kind=1, flags=0)]
        blocks = v.verify(samples, diagnostic)['blocks']
        self.assertEqual(blocks[0]['gc']['commonSpanOverlapMs'], 3)
        self.assertEqual(blocks[1]['gc']['commonSpanOverlapMs'], 10)
        self.assertEqual(blocks[1]['gc']['constructionOverlapMs'], 2)
        self.assertEqual(blocks[1]['gc']['checkpointOverlapLowerMs'], 14)
        self.assertEqual(blocks[1]['gc']['checkpointOverlapUpperMs'], 15)

    def test_nearest_rank_285_of_300(self):
        samples, diagnostic = fixture('BASE')
        # Retain non-overlap while creating an independently hand-computable rank vector.
        for sample in samples:
            sample['start'] *= 1000
            sample['ms'] = sample['index'] + 1
            sample['end'] = sample['start'] + sample['ms']
        measured = v.verify(samples, diagnostic)['blocks'][1]
        self.assertEqual(measured['p50Ms'], 250.5)
        self.assertEqual(measured['p95Ms'], 385)
        self.assertEqual(measured['constructionSumMs'], 75150)

    def test_reject_sample_mutations(self):
        mutations = {
            'missing': lambda s, d: s.pop(),
            'duplicate': lambda s, d: s.__setitem__(1, copy.deepcopy(s[0])),
            'wrong-phase': lambda s, d: s[0].update(phase='measured'),
            'wrong-duration': lambda s, d: s[0].update(ms=3),
            'nonfinite': lambda s, d: s[0].update(start=float('nan')),
            'negative': lambda s, d: s[0].update(start=-1),
            'boolean-coordinate': lambda s, d: s[0].update(batch=False),
            'overlap': lambda s, d: s[1].update(start=11, end=13),
            'missing-field': lambda s, d: s[0].pop('ms'),
            'orientation': lambda s, d: d.update(orientation='V'),
        }
        for label, mutation in mutations.items():
            with self.subTest(label=label):
                samples, diagnostic = fixture()
                mutation(samples, diagnostic)
                with self.assertRaises(ValueError):
                    v.verify(samples, diagnostic)

    def test_reject_checkpoint_mutations(self):
        mutations = {
            'missing-end': lambda d: d['checkpoints'].pop(),
            'duplicate': lambda d: d['checkpoints'].__setitem__(1, copy.deepcopy(d['checkpoints'][0])),
            'boundary-inside-construction': lambda d: d['checkpoints'][1].update(wallBefore=1011, wallAfter=1012),
            'CPU-decrease': lambda d: d['checkpoints'][1].update(user=0),
            'CPU-fraction': lambda d: d['checkpoints'][1].update(user=1.5),
            'time-reverse': lambda d: d['checkpoints'][1].update(wallAfter=0),
            'base-observation': lambda d: d.update(condition='BASE', observerInstalled=False, disconnectAt=None),
        }
        for label, mutation in mutations.items():
            with self.subTest(label=label):
                samples, diagnostic = fixture()
                mutation(diagnostic)
                with self.assertRaises(ValueError):
                    v.verify(samples, diagnostic)

    def test_reject_gc_mutations(self):
        good = dict(startTime=100, duration=20, receivedAt=200, kind=1, flags=0)
        mutations = {
            'missing-disconnect': lambda d: d.update(disconnectAt=None),
            'early-disconnect': lambda d: d.update(disconnectAt=50000),
            'after-disconnect': lambda d: d['gc'][0].update(receivedAt=55001),
            'receipt-before-event': lambda d: d['gc'][0].update(receivedAt=99),
            'receipt-before-end': lambda d: d['gc'][0].update(receivedAt=110),
            'negative-duration': lambda d: d['gc'][0].update(duration=-1),
            'nonfinite': lambda d: d['gc'][0].update(duration=float('inf')),
            'missing-field': lambda d: d['gc'][0].pop('flags'),
            'wrong-observer': lambda d: d.update(observerInstalled=False),
            'buffer-full': lambda d: d.update(gc=[good] * 100000),
        }
        for label, mutation in mutations.items():
            with self.subTest(label=label):
                samples, diagnostic = fixture()
                diagnostic['gc'] = [copy.deepcopy(good)]
                mutation(diagnostic)
                with self.assertRaises(ValueError):
                    v.verify(samples, diagnostic)

    def test_absent_events_explicitly_do_not_prove_no_gc(self):
        report = v.verify(*fixture())
        self.assertIn('empty is not no GC', report['scope'])
        self.assertEqual(report['blocks'][1]['gc']['constructionOverlapMs'], 0)


if __name__ == '__main__':
    unittest.main()
