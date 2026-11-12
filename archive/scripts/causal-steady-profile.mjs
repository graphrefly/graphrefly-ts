/** Prepare focused node-profile attribution; run generated entry separately from acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const [out, input] = process.argv.slice(2);
assert.ok(out && input);
const root = resolve(out);
mkdirSync(root, { recursive: false });
const sha = (x) => createHash("sha256").update(x).digest("hex");
const put = (n, x) =>
	writeFileSync(resolve(root, n), JSON.stringify(x, null, 2) + "\n", { flag: "wx" });
const fixture = readFileSync(input);
writeFileSync(resolve(root, "P1-inputs.json"), fixture, { flag: "wx" });
const entry = `import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {graphArm,schedule} from './scripts/fixtures/spending-preset-performance.ts';
import {preflight} from './scripts/fixtures/spending-preset-performance-worker.ts';
const scenario=JSON.parse(readFileSync(new URL('./P1-inputs.json',import.meta.url),'utf8'));
const results=[];
for(const dataCount of [1,2]) for(const arm of ['candidate','reference']) {
 const row={id:'steady-P1-off-duplicate-'+dataCount,group:'steady',profile:'P1',mode:'off',change:'duplicate',dataCount};
 const semantic=preflight(row,scenario);assert.equal(semantic.passed,true);
 const run=graphArm(arm,'off');const plan=schedule(row,scenario);
 try {
  for(const step of plan.before)run.send(step);
  const baseline=structuredClone(run.state());const observations=[];
  for(let i=0;i<10;i++){
   const before=run.graph.profile();const t=performance.now();
   for(const step of plan.action)run.send(step);
   const elapsed=performance.now()-t;const after=run.graph.profile();
   assert.deepEqual(run.state(),baseline,'duplicate preserves authority');
   const nodes=Object.fromEntries(Object.keys(after.nodes).map(id=>[id,{invokes:after.nodes[id].invokes-before.nodes[id].invokes,totalDurationNs:after.nodes[id].totalDurationNs-before.nodes[id].totalDurationNs}]));
   observations.push({index:i,elapsed,totalInvokes:after.totalInvokes-before.totalInvokes,nodes});
  }
  results.push({row,arm,semantic,topology:run.graph.describe(),observations});
 }finally{run.cleanup();}
}
writeFileSync(new URL('./result.json',import.meta.url),JSON.stringify({kind:'opt-in-node-profile-diagnostic',qualification:false,limitations:'Dispatcher durations may nest; do not sum as exclusive CPU. Opt-in profile overhead is included, not formal timing.',results},null,2)+'\\n');
console.log('STEADY_PROFILE_DONE',results.length);`;
writeFileSync(resolve(root, "entry.ts"), entry, { flag: "wx" });
const source = "scripts/fixtures/spending-preset-performance.ts";
const original = readFileSync(source, "utf8");
const target = 'new Graph({ name: "spending-performance" })';
assert.equal(original.split(target).length, 2);
const altered = original.replace(
	target,
	'new Graph({ name: "spending-performance", profile: true })',
);
const b = await build({
	stdin: {
		contents: entry,
		resolveDir: process.cwd(),
		sourcefile: "profile-entry.ts",
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
	plugins: [
		{
			name: "opt-in-profile",
			setup(api) {
				api.onLoad({ filter: /spending-preset-performance\.ts$/ }, () => ({
					contents: altered,
					loader: "ts",
					resolveDir: resolve("scripts/fixtures"),
				}));
			},
		},
	],
});
writeFileSync(resolve(root, "entry.mjs"), b.outputFiles[0].contents, { flag: "wx" });
const sources = {};
for (const p of [
	...Object.keys(b.metafile.inputs).filter((p) => p !== "profile-entry.ts"),
	"scripts/causal-steady-profile.mjs",
	"pnpm-lock.yaml",
]) {
	const bytes = readFileSync(p);
	sources[p] = sha(bytes);
	const dest = resolve(root, "source", p);
	mkdirSync(resolve(dest, ".."), { recursive: true });
	writeFileSync(dest, bytes, { flag: "wx" });
}
put("freeze.json", {
	cases: 4,
	actionsPerCase: 10,
	input: sha(fixture),
	bundle: sha(b.outputFiles[0].contents),
	sources,
	profileIntervention: { original: sha(original), loaded: sha(altered) },
	scope:
		"Fixed P1 single/double duplicate Graph node invoke attribution; actual original semantic preflight. Not performance qualification.",
});
console.log("STEADY_PROFILE_PREPARED");
