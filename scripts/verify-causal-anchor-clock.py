"""Exact-rational private clock verifier. Import never executes a probe."""
import importlib.util
import math
from fractions import Fraction as F
from pathlib import Path

spec = importlib.util.spec_from_file_location('previous_clock_structure', Path(__file__).with_name('verify-causal-aligned-clock.py'))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
require = legacy.require
NAMES = ('knownArithmeticPhase', 'knownStringPhase')


def rational(x):
    require(type(x) in (int, float) and math.isfinite(x), 'finite numeric value')
    return F(x)


def exact(x):
    return f'{x.numerator}/{x.denominator}'


def anchors(probe, meta):
    require(type(meta['pid']) is int and meta['pid'] > 0, 'process identity')
    require(len(probe['anchors']) == 2, 'exactly two anchors')
    intervals = []
    previous_p, previous_h = F(0), 0
    for a in probe['anchors']:
        require(a['pid'] == meta['pid'], 'anchor process mismatch')
        require(type(a['h']) is str and a['h'].isascii() and a['h'].isdigit()
                and str(int(a['h'])) == a['h'], 'canonical bigint string')
        h = int(a['h'])
        require(previous_h <= h < 2**64, 'hrtime range/order')
        p0, p1 = rational(a['before']), rational(a['after'])
        require(previous_p <= p0 <= p1, 'anchor performance order')
        # C++ casts a nonnegative integer duration to double, then divides by 1e6.
        # Each nearest-rounding step costs <=1 ulp of final p; 4 ulp is conservative.
        f = 4 * max(F(math.ulp(float(p0))), F(math.ulp(float(p1))))
        intervals.append((p0-F(h, 1000000)-f, p1-F(h, 1000000)+f))
        previous_p, previous_h = p1, h
    lo, hi = max(i[0] for i in intervals), min(i[1] for i in intervals)
    require(lo <= hi, 'empty same-clock intersection')
    return lo, hi


def native_check(probe, platform, native):
    numer, denom = platform['timebase']['numer'], platform['timebase']['denom']
    require(type(numer) is int and type(denom) is int and numer > 0 and denom > 0, 'timebase')
    before, after = native['before'], native['after']
    for obs in (before, after):
        require(all(type(obs[k]) is int and obs[k] >= 0 for k in ('absoluteBefore', 'continuous', 'absoluteAfter')), 'native ticks')
        require(obs['absoluteBefore'] <= obs['absoluteAfter'] and obs['absoluteBefore'] <= obs['continuous'], 'native order')
    require(before['absoluteAfter'] <= after['absoluteBefore'] and before['continuous'] <= after['continuous'], 'native lifetime')
    require(after['continuous']*numer < 2**64, 'native conversion overflow')
    r = F(numer, denom)
    for a in probe['anchors']:
        require(before['continuous']*r//1 <= int(a['h']) <= after['continuous']*r//1, 'hrtime outside parent lifetime')
    return r


def verify(profile, probe, platform, native, meta):
    # Reuse only frozen structural validation, not its old clock qualification formula.
    legacy.verify(profile, probe, platform, native)
    require(all(type(profile[k]) is int for k in ('startTime', 'endTime')), 'integer profile timestamps')
    jlo, jhi = anchors(probe, meta)
    r = native_check(probe, platform, native)
    before, after = native['before'], native['after']
    slo = max(0, before['continuous']-before['absoluteAfter'])*r/1000000
    shi = (after['continuous']-after['absoluteBefore'])*r/1000000
    elo, ehi = -999*r/1000000, F(1, 1000)
    lo, hi = jlo+slo-ehi-F(1, 1000000), jhi+shi-elo
    width = hi-lo
    b = probe['bounds']; first, last = probe['anchors']
    require(b['startAfter'] <= first['before'] <= first['after'] <= probe['windows'][0]['start'], 'first anchor placement')
    require(probe['windows'][-1]['end'] <= last['before'] <= last['after'] <= b['stopBefore'], 'last anchor placement')
    require([w['name'] for w in probe['windows']] == list(NAMES), 'known window identities/order')
    require(probe['windows'][0]['end'] <= probe['windows'][1]['start'], 'nonoverlapping windows')
    for stamp, a, z in [(profile['startTime'], b['startBefore'], b['startAfter']),
                        (profile['endTime'], b['stopBefore'], b['stopAfter'])]:
        require(max(F(stamp, 1000)+lo, rational(a)) <= min(F(stamp, 1000)+hi, rational(z)), 'profiler endpoint inconsistency')
    nodes = {n['id']: n for n in profile['nodes']}
    # Leaf self hits only; no inclusive CPU duration attribution.
    counts = {name: dict(certain=0, ambiguous=0, wrong=0) for name in NAMES}
    q = profile['startTime']
    for node, dt in zip(profile['samples'], profile['timeDeltas']):
        q += dt
        name = nodes[node]['callFrame']['functionName']
        if name not in counts:
            continue
        w = probe['windows'][NAMES.index(name)]
        a, z = rational(w['start']), rational(w['end'])
        # Expand observed performance endpoints by their numeric conversion uncertainty.
        f = 4*max(F(math.ulp(float(a))), F(math.ulp(float(z))))
        left, right = F(q, 1000)+lo, F(q, 1000)+hi
        category = 'certain' if a+f <= left and right <= z-f else 'wrong' if right < a-f or left > z+f else 'ambiguous'
        counts[name][category] += 1
    alignment = F(0) <= width <= F(1, 10)
    mapping = all(c['certain'] > 0 and c['wrong'] == 0 for c in counts.values())
    return dict(kind='hrtime-anchor-qualification-v1', qualified=alignment and mapping,
                alignmentQualified=alignment, mappingQualified=mapping,
                failure=None if alignment and mapping else 'clock-interval-width' if not alignment else 'known-function-mapping',
                offsetIntervalExactMs=[exact(lo), exact(hi)], widthExactMs=exact(width), widthMs=float(width),
                sameClockWidthMs=float(jhi-jlo), sleepIntervalWidthMs=float(shi-slo),
                quantizationWidthMs=float(ehi-elo), knownFunctionMapping=counts,
                sampleCount=len(profile['samples']), consumerExecutions=0)


def verify_gc(probe, meta, platform, native):
    require(probe['kind'] == 'GC' and not probe.get('fault'), 'successful GC probe')
    anchors(probe, meta)
    native_check(probe, platform, native)
    require(len(probe['windows']) == 2 and 0 < len(probe['events']) < 100000, 'GC count')
    windows = [(rational(w['start']), rational(w['end'])) for w in probe['windows']]
    require(0 <= windows[0][0] <= windows[0][1] <= windows[1][0] <= windows[1][1], 'GC window order')
    require(probe['anchors'][0]['after'] <= windows[0][0] and windows[-1][1] <= probe['anchors'][1]['before'], 'GC anchor placement')
    overlaps = [0, 0]
    for e in probe['events']:
        start, duration, received = (rational(e[k]) for k in ('startTime', 'duration', 'receivedAt'))
        require(start >= 0 and duration >= 0 and start+duration <= received, 'GC event order')
        for i, (a, z) in enumerate(windows):
            overlaps[i] += int(max(a, start) < min(z, start+duration))
    require(all(overlaps), 'delivered event overlaps each forced-GC window')
    return dict(qualified=True, kind='GC-functional-probe', deliveredEvents=len(probe['events']), windowOverlaps=overlaps,
                limitation='Delivered subset overlap only, not proof of complete GC delivery', consumerExecutions=0)
