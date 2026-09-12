// Build-time source audit only: generated bundles are never imported or executed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build, version} from 'esbuild';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const revision = process.argv[2];
assert.match(revision ?? '', /^[0-9a-f]{40}$/);
const hash = x => createHash('sha256').update(x).digest('hex');
const entries = {
  candidateBuilder: 'examples/spending-alerts/causal-preset.ts',
  referenceBuilder: 'scripts/fixtures/spending-preset-reference.ts',
  actualHarness: 'scripts/fixtures/spending-preset-performance-worker.ts',
};
const closures = {};
const files = {};
for (const [role, entry] of Object.entries(entries)) {
  const result = await build({absWorkingDir: root, entryPoints:[entry], bundle:true,
    write:false, metafile:true, platform:'node', target:'node24', format:'esm'});
  const inputs = Object.keys(result.metafile.inputs).sort();
  for (const file of inputs) {
    assert.ok(!file.startsWith('../') && !file.startsWith('/'));
    const current = readFileSync(new URL(file, new URL('../../../../', import.meta.url)));
    const frozen = execFileSync('git',['show',`${revision}:${file}`],{cwd:root,maxBuffer:16000000});
    assert.ok(current.equals(frozen), `working source differs: ${file}`);
    files[file] = {sha256:hash(current), gitBlob:execFileSync('git',['rev-parse',`${revision}:${file}`],{cwd:root,encoding:'utf8'}).trim()};
  }
  closures[role] = {entry, inputs, externalImports:result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].imports,
    bundleSha256:hash(result.outputFiles[0].contents)};
}
const c = new Set(closures.candidateBuilder.inputs), r = new Set(closures.referenceBuilder.inputs);
const shared = [...c].filter(x=>r.has(x)).sort();
assert.ok(shared.includes('packages/ts/src/solutions/causal-occurrence/identity.ts'));
console.log(JSON.stringify({revision,esbuild:version,consumerExecutions:0,
  limitation:'Module import closures, not executed-path or per-node cost attribution; harness includes both branches and oracle. Type-only imports omitted by bundling.',
  entries:closures,sharedBuilderInputs:shared,
  candidateOnly:[...c].filter(x=>!r.has(x)).sort(),referenceOnly:[...r].filter(x=>!c.has(x)).sort(),
  files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))},null,2));
