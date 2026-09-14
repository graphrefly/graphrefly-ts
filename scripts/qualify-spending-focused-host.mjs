/** D170 actual-source runtime mutations, isolated bundles, no source-tree mutation or inbox I/O. */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const hostPath = "examples/spending-alerts/causal-focused-host.ts";
const entry = `
import assert from 'node:assert/strict';
import { runHost, drain } from './scripts/fixtures/spending-focused-host-harness.ts';
import { evaluationFixture, evaluationPack, policyFacts, presetBinding } from './scripts/fixtures/spending-preset-harness.ts';
const mode = process.argv[2];
const run = runHost();
try {
 await drain();
 const e=evaluationFixture(), f=policyFacts(e);
 if(mode==='guard') {
  const lock=Symbol(); run.host.guard.up([['PAUSE',lock]]); run.drive([e]);
  run.send('local',{...f.local,stop:true}); run.host.guard.up([['RESUME',lock]]);
  await drain(); assert.equal(run.calls.length,0); assert.equal([...run.state().effects.values()][0].outcome?.state,'cancelled');
 } else if(mode==='slot') {
  run.drive([e,evaluationFixture(0,'tea')]); await drain(); assert.equal(run.calls.length,1); assert.equal(run.host.inspect().inFlight,1);
 } else if(mode==='replay') {
  run.drive([e]); run.send('current',f.current); assert.equal(run.calls.length,1); assert.equal(run.host.inspect().records[0].outcome,undefined);
 } else if(mode==='retain') {
  run.drive([e]); run.pending.resolve({bytesWritten:Buffer.byteLength(run.calls[0])}); await drain();
  run.disconnect(); assert.equal(run.calls.length,1); assert.equal(run.host.inspect().records.length,1); assert.equal(run.host.inspect().records[0].outcome?.state,'succeeded');
 } else if(mode==='exact') {
  run.drive([e]); run.pending.resolve({bytesWritten:Buffer.byteLength(run.calls[0])}); await drain();
  assert.equal([...run.state().effects.values()][0].outcome?.state,'succeeded');
 } else if(mode==='overflow') {
  const issues=[]; const stop=run.host.consume.view.issues.subscribe(m=>{if(m[0]==='DATA')issues.push(m[1]);});
  run.send('pack',evaluationPack(Array.from({length:65},(_,i)=>evaluationFixture(i))));
  assert.equal(run.graph.find('spending/hostPackFacts').cache?.valid,false);
  assert.equal(run.calls.length,0); assert.equal(run.host.inspect().records.length,0);stop();
 } else if(mode==='counterfeit') {
  run.drive([e]);
  const r=[...run.state().effects.values()][0];
  const fake={...r.proposal,admissionRef:{kind:'wrong-admission',id:'counterfeit'},state:'succeeded',result:{kind:'ok',value:{io:false}}};
  run.host.source.down([['DATA',{...f.inbox,outcomes:[fake]}]]);
  assert.equal([...run.state().effects.values()][0].outcome,undefined);
 } else if(mode==='capacity') {
  run.drive([e,evaluationFixture(0,'tea')]); await drain(); assert.equal(run.host.inspect().records.length,2);
 } else throw new Error('unknown mode');
 console.log('PASS:'+mode);
} finally { if(mode!=="overflow") run.teardown(); /* Invalid-input process probe makes no normal-shutdown claim. */ }
`;
const mutants = [
	{
		name: "accept-over-capacity-pack",
		scenario: "overflow",
		file: "examples/spending-alerts/causal-inputs.ts",
		from: "array(v.evaluations);",
		to: "array(v.evaluations, 65);",
	},
	{ name: "bypass-final-guard", scenario: "guard", from: "if (denied)", to: "if (false)" },
	{
		name: "skip-single-write-slot",
		scenario: "slot",
		from: "inFlight !== 0 || writes >= Math.min(64, grant.maxWrites)",
		to: "writes >= Math.min(64, grant.maxWrites)",
	},
	{ name: "replay-request", scenario: "replay", from: "if (prior) {", to: "if (false && prior) {" },
	{
		name: "drop-retained-completion",
		scenario: "retain",
		from: "revision++;\n\t\t\tschedule();",
		to: "records.clear(); revision++;\n\t\t\tschedule();",
	},
	{
		name: "misassociate-outcome",
		scenario: "exact",
		from: "admissionRef: r.admission.admissionRef,",
		to: 'admissionRef: {kind:"wrong",id:"wrong"},',
	},
	{
		name: "accept-counterfeit-admission",
		scenario: "counterfeit",
		file: "packages/ts/src/solutions/causal-occurrence/lifecycle.ts",
		from: "dataKey(record.admission.admissionRef) !== dataKey(canonical.snapshot.admissionRef) ||",
		to: "false ||",
	},
	{
		name: "clear-host-on-ui-detach",
		scenario: "retain",
		from: "const packFacts =",
		to: `const originalSubscribe = built.consume.view.publication.subscribe.bind(built.consume.view.publication);
 built.consume.view.publication.subscribe = (...args) => { const stop = originalSubscribe(...args); return () => {stop(); records.clear();}; };
 const packFacts =`,
	},

	{
		name: "underreserve-results",
		scenario: "capacity",
		from: "records.size >= 64",
		to: "records.size >= 1",
	},
];
const dir = mkdtempSync(join(tmpdir(), "spending-host-mutations-"));
const results = [];
try {
	for (const m of mutants) {
		for (const mutant of [false, true]) {
			let changed = 0;
			const outfile = join(dir, `${m.name}-${mutant}.mjs`);
			await build({
				stdin: {
					contents: entry,
					resolveDir: root,
					sourcefile: "focused-host-qualification.ts",
					loader: "ts",
				},
				bundle: true,
				platform: "node",
				format: "esm",
				outfile,
				plugins: [
					{
						name: "actual-source-mutation",
						setup(b) {
							b.onLoad({ filter: /\.ts$/ }, (args) => {
								if (args.path !== resolve(root, m.file ?? hostPath)) return;
								let contents = readFileSync(args.path, "utf8");
								if (mutant) {
									const count = contents.split(m.from).length - 1;
									if (count !== 1) throw new Error("mutation anchor count " + m.name + ":" + count);
									contents = contents.replace(m.from, m.to);
									changed++;
								}
								return { contents, loader: "ts" };
							});
						},
					},
				],
			});
			const r = spawnSync(process.execPath, [outfile, m.scenario], {
				encoding: "utf8",
				timeout: 30000,
			});
			const passed = r.status === 0 && r.stdout.includes("PASS:" + m.scenario);
			if (!mutant && !passed) throw new Error("control failed " + m.name + " " + r.stderr);
			if (
				mutant &&
				(changed !== 1 || passed || r.error || r.signal || !r.stderr.includes("AssertionError"))
			)
				throw new Error("mutant not behavior-killed " + m.name + " " + r.stderr);
			results.push({
				name: m.name,
				mutant,
				status: r.status,
				verdict: mutant ? "behavior-killed" : "control-pass",
				bundleSha256: createHash("sha256").update(readFileSync(outfile)).digest("hex"),
				stdout: r.stdout,
				stderr: r.stderr,
			});
		}
	}
	const output = resolve(
		process.argv[2] ?? "docs/design/causal-integrated-implementation/mutations.json",
	);
	writeFileSync(
		output,
		JSON.stringify(
			{
				source: hostPath,
				sourceSha256: createHash("sha256")
					.update(readFileSync(resolve(root, hostPath)))
					.digest("hex"),
				realInboxIO: 0,
				results,
			},
			null,
			2,
		) + "\n",
	);
	console.log(JSON.stringify({ controls: mutants.length, killed: mutants.length, output }));
} finally {
	rmSync(dir, { recursive: true, force: true });
}
