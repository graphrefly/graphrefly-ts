"""Offline frozen-source replay. No subprocess, clock probe or consumer launch."""
import hashlib
import importlib.util
import json
import tarfile
import tempfile
from pathlib import Path

D = Path(__file__).resolve().parent
ROOT = D.parents[3]
def read(p): return json.loads(p.read_text())
def sha(b): return hashlib.sha256(b).hexdigest()
plan = read(D/'plan.json')
assert read(D/'plan.json.claim.json')['planSha256'] == sha((D/'plan.json').read_bytes())
for file, digest in read(D/'evidence-index.json').items():
    assert sha((D/file).read_bytes()) == digest, file
with tempfile.TemporaryDirectory() as tmp, tarfile.open(D/'frozen-inputs.tar.gz') as archive:
    frozen = Path(tmp)
    members = {m.name:m for m in archive.getmembers()}
    assert set(members) == set(plan['files'])
    for file, digest in plan['files'].items():
        assert members[file].isfile()
        data = archive.extractfile(members[file]).read()
        assert sha(data) == digest
        current = ROOT/file
        if current.exists(): assert sha(current.read_bytes()) == digest, file
        dest = frozen/file
        assert dest.resolve().is_relative_to(frozen.resolve())
        dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(data)
    spec = importlib.util.spec_from_file_location('frozen_anchor', frozen/'scripts/verify-causal-anchor-clock.py')
    v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
    result = read(D/'probes/result.json')
    assert result['probesQualified'] and not result['captureToolingQualified']
    assert result['consumerExecutions'] == 0 and result['notRun'] == []
    assert [c['kind'] for c in result['children']] == ['CPU','CPU','CPU','GC']
    assert read(D/'probes/timebase.json') == plan['platform']['timebase']
    widths=[]; samples=0; certain=ambiguous=wrong=0; max_rss=0; max_gap=0
    pids=set(); previous_end=0
    for i, c in enumerate(result['children']):
        folder=D/'probes'/f'{i:02d}'
        outcome=read(folder/'exit.json'); assert outcome == c['outcome']
        assert outcome['reason'] is None and outcome['exitCode'] == 0
        assert outcome['pid'] not in pids; pids.add(outcome['pid'])
        assert previous_end <= outcome['endedElapsed'] <= 40
        previous=previous_end
        for o in outcome['observations']:
            assert previous <= o['elapsed'] <= outcome['endedElapsed']
            assert 0 <= o['childElapsed'] <= 10 and 0 <= o['gap'] <= 1
            assert o['rssBytes'] <= 256*1024**2 and o['directoryBytes'] <= 256*1024**2
            max_rss=max(max_rss,o['rssBytes']);max_gap=max(max_gap,o['gap']);previous=o['elapsed']
        previous_end=outcome['endedElapsed']
        probe=read(folder/'probe.json');meta=read(folder/'process.json');native=read(folder/'native-clock.json')
        assert meta['pid']==outcome['pid'] and meta['node']=='v24.18.0' and meta['platform']=='darwin' and meta['arch']=='arm64'
        command=read(folder/'command.json')
        assert command['explicitEnvironment']==plan['explicitEnvironment'] and command['argv'][0]==plan['node']
        if c['kind']=='CPU':
            a=v.verify(read(folder/'profile.json'),probe,plan['platform'],native,meta)
            widths.append(a['widthMs']);samples+=a['sampleCount']
            for counts in a['knownFunctionMapping'].values():
                certain+=counts['certain'];ambiguous+=counts['ambiguous'];wrong+=counts['wrong']
        else: a=v.verify_gc(probe,meta,plan['platform'],native)
        assert a==read(folder/'analysis.json') and a['qualified']
    print(json.dumps(dict(replay=True,frozenFiles=len(plan['files']),cpuProbes=3,gcProbes=1,consumerExecutions=0,
                         widthsMs=widths,cpuSamples=samples,certainKnownSamples=certain,ambiguousKnownSamples=ambiguous,
                         wrongKnownSamples=wrong,maxObservedRssMiB=max_rss/1024**2,maxObservationGapSeconds=max_gap,
                         lastChildEndedSeconds=previous_end),indent=2))
