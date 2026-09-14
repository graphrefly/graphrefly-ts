"""Check walkthrough artifacts, not consumer qualification or human acceptance."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

base = Path(__file__).resolve().parent
root = base.parents[2]
freeze = json.loads((base / 'freeze.json').read_text())
assert subprocess.run(['git', 'cat-file', '-e', freeze['baseline'] + '^{commit}'], cwd=root).returncode == 0
for row in freeze['files']:
    assert hashlib.sha256((root / row['path']).read_bytes()).hexdigest() == row['sha256'], row['path']
mapping = json.loads((base / 'b121-mapping.json').read_text())
authority_bytes = (root.parent / 'graphrefly/plan/backlog.jsonl').read_bytes()
assert hashlib.sha256(authority_bytes).hexdigest() == mapping['rootBacklogSha256'], 'root backlog changed; re-review mapping'
root_record = next(row for row in map(json.loads, authority_bytes.decode().splitlines()) if row.get('id') == 'B121')
assert root_record['status'] == mapping['rootStatusObserved'] == 'proposed'
assert root_record['acceptance'] == [row['acceptance'] for row in mapping['acceptance']]
assert [r['index'] for r in mapping['acceptance']] == list(range(1, 9))
for name in ['ordinary-response.md', 'framework-response.md', 'maintainer-response.md']:
    assert (base / name).stat().st_size > 500
for file in base.glob('*.md'):
    for link in re.findall(r'\]\(([^)]+)\)', file.read_text()):
        if '://' in link or link.startswith('#'):
            continue
        path = re.sub(r':\d+$', '', link.split('#')[0])
        assert (file.parent / path).exists(), (file.name, link)
print(json.dumps({'kind': 'walkthrough-artifact-check', 'frozenFiles': len(freeze['files']),
                  'agentResponses': 3, 'humanTrials': 0, 'formalBlindTrials': 0,
                  'rootB121Closure': False, 'passed': True}))
