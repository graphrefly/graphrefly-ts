"""Compare the bound source manifest with retained C sources, without execution."""
import hashlib
import json
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[4]
manifest = json.loads((Path(__file__).parent / 'source-manifest.json').read_text())
archive = 'archive/evals/causal-currentness-comparison-v1/evidence.tar.gz'
receipt = json.loads((root / 'docs/design/causal-cost-investigation/performance-comparison/receipt.json').read_text())
assert 'sha256:' + hashlib.sha256((root / archive).read_bytes()).hexdigest() == receipt['archives'][archive]
with tarfile.open(root / archive) as stream:
    retained = json.load(stream.extractfile('run/build.json'))['arms']['C']['closure']
results = {key: ('same' if retained[key]['sha256'] == value['sha256'] else 'different')
           if key in retained else 'not-in-retained-closure' for key, value in manifest['files'].items()}
print(json.dumps({'archive': archive, 'archiveDigest': receipt['archives'][archive],
    'retainedArm': 'C, same candidate after currentness optimization; not D169 reference timing',
    'currentRevision': manifest['revision'],
    'counts': {value: list(results.values()).count(value) for value in sorted(set(results.values()))},
    'files': results, 'consumerExecutions': 0}, indent=2, sort_keys=True))
