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
        cells = [(c, o) for c in ('BASE', 'CPU', 'CPU_GC') for o in ('U', 'V')]
        rng.shuffle(cells)
        base = len(jobs)
        jobs.extend(dict(id=base+i, round=round_id, condition=c, orientation=o)
                    for i, (c, o) in enumerate(cells))
    return jobs


def violation(elapsed, child_elapsed, gap, rss, directory_bytes):
    if elapsed > 900: return 'total-deadline'
    if child_elapsed > 30: return 'child-deadline'
    if gap > 1: return 'observation-gap'
    if rss > 256*1024*1024: return 'observed-rss'
    if directory_bytes > 256*1024*1024: return 'directory-size'
    return None


def tree_size(directory):
    return sum(p.stat().st_size for p in directory.rglob('*') if p.is_file())


def supervise(argv, job, root, explicit_environment, start, popen=subprocess.Popen,
              clock=time.monotonic, sleep=time.sleep, memory=None, size=tree_size,
              kill_group=os.killpg):
    """Observe one child; caller MUST stop dispatch if reason is not null."""
    allowed = {'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', '__CF_USER_TEXT_ENCODING'}
    if not isinstance(explicit_environment, dict) or not set(explicit_environment) <= allowed:
        raise ValueError('Explicit allowlist environment required')
    if not all(isinstance(v, str) for v in explicit_environment.values()):
        raise ValueError('Environment values must be strings')
    memory = memory or (lambda pid: int(subprocess.check_output(
        ['ps', '-o', 'rss=', '-p', str(pid)], text=True, timeout=1).strip())*1024)
    begin = clock()
    previous = begin
    observations = []
    reason = violation(begin-start, 0, 0, 0, size(root))
    child = None
    try:
        if not reason:
            with (job/'stdout.log').open('x') as stdout, (job/'stderr.log').open('x') as stderr:
                child = popen(argv, cwd=job, env=explicit_environment, stdout=stdout,
                              stderr=stderr, start_new_session=True)
                while child.poll() is None:
                    try:
                        rss = memory(child.pid)
                    except subprocess.CalledProcessError:
                        if child.poll() is not None: break
                        raise
                    directory_bytes = size(root)
                    after = clock()
                    row = dict(elapsed=after-start, childElapsed=after-begin,
                               gap=after-previous, rssBytes=rss, directoryBytes=directory_bytes)
                    observations.append(row)
                    reason = violation(row['elapsed'], row['childElapsed'], row['gap'], rss, directory_bytes)
                    previous = after
                    if reason: break
                    sleep(0.1)
    except BaseException as error:
        reason = f'observer-or-spawn-error:{type(error).__name__}:{error}'
    finally:
        if child is not None and child.poll() is None:
            try:
                kill_group(child.pid, signal.SIGTERM)
                try: child.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    kill_group(child.pid, signal.SIGKILL)
                    child.wait(timeout=1)
            except ProcessLookupError:
                child.wait(timeout=1)
    ended = clock()
    if not observations and not reason: reason = 'no-resource-observation'
    if not reason: reason = violation(ended-start, ended-begin, ended-previous, 0, size(root))
    if not reason and child.returncode != 0: reason = 'child-exit'
    result = dict(pid=child.pid if child else None, exitCode=child.returncode if child else None,
                  reason=reason, observations=observations, endedElapsed=ended-start)
    with (job/'exit.json').open('x') as f:
        json.dump(result, f, indent=2)
        f.write('\n')
    return result


def dispatch(jobs, run_one):
    """Bounded stop bookkeeping; no fallback, retry, replacement or sampling on its own."""
    if len(jobs) != 24 or [j['id'] for j in jobs] != list(range(24)):
        raise ValueError('24 frozen sequential coordinates required')
    expected = {(r, c, o) for r in range(4) for c in ('BASE', 'CPU', 'CPU_GC') for o in ('U', 'V')}
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
                completed=len(results)==24 and not results[-1]['result'].get('reason'))
