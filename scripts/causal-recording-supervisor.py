"""Private single-use supervisor primitives. Import/CLI do not launch a consumer.

Explicit entry, source/approval binding and independent whole-run replay are separate
capture admission requirements. This module never reads dotenv or host environment.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def schedule(rng):
    jobs = []
    for round_id in range(4):
        cells = [(c, o) for c in ('EAGER', 'DEFERRED') for o in ('U', 'V')]
        rng.shuffle(cells)
        base = len(jobs)
        jobs.extend(dict(id=base+i, round=round_id, condition=c, orientation=o)
                    for i, (c, o) in enumerate(cells))
    return jobs


# Resource monitoring remains byte-identical in the existing tested module.
import importlib.util
_spec=importlib.util.spec_from_file_location('resource_supervisor',Path(__file__).with_name('causal-workload-supervisor.py'))
_base=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_base)
violation=_base.violation
tree_size=_base.tree_size
supervise=_base.supervise


def dispatch(jobs, run_one):
    """Bounded stop bookkeeping; no fallback, retry, replacement or sampling on its own."""
    if len(jobs) != 16 or [j['id'] for j in jobs] != list(range(16)):
        raise ValueError('16 frozen sequential coordinates required')
    if [j['round'] for j in jobs] != [i//4 for i in range(16)]:
        raise ValueError('Frozen round order required')
    expected = {(r, c, o) for r in range(4) for c in ('EAGER', 'DEFERRED') for o in ('U', 'V')}
    if {(j['round'], j['condition'], j['orientation']) for j in jobs} != expected:
        raise ValueError('Incomplete diagnostic coordinates')
    results = []
    for job in jobs:
        try:
            result = run_one(job)
        except Exception as error:
            result = dict(reason=f'dispatch-error:{type(error).__name__}:{error}')
        results.append(dict(job=job, result=result))
        if result.get('reason'):
            break
    return dict(children=results, notRun=jobs[len(results):],
                completed=len(results)==16 and not results[-1]['result'].get('reason'))
