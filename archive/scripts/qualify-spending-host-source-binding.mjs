/** Offline equivalent implementation edit; no production source mutation or inbox I/O. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const target = "examples/spending-alerts/causal-business.ts";
const from = "exactVendorStats(e.prefix.map((t) => t.amount))";
const to = "exactVendorStats(e.prefix.map(({ amount }) => amount))";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const entry = `
import assert from 'node:assert/strict';
import { composeOfflineSpending, OfflineAlertResource } from './examples/spending-alerts/causal-focused-host.ts';
import { inputsFor, drain } from './scripts/fixtures/spending-focused-host-harness.ts';
import { evaluationFixture, evaluationPack, policyFacts, presetBinding } from './scripts/fixtures/spending-preset-harness.ts';
import { oracleRequest } from './scripts/fixtures/spending-preset-oracle.ts';
import { Graph } from './packages/ts/src/graph/graph.ts';
import { batch } from './packages/ts/src/batch/batch.ts';
import { checkpointStateOfNode } from './packages/ts/src/node/runtime-accessors.ts';
const config=JSON.parse(process.argv[2]);
const binding={...presetBinding,...config.binding};
const graph=new Graph(); const {inputs,sources}=inputsFor(graph); const calls=[];
const host=composeOfflineSpending(graph,inputs,binding,new OfflineAlertResource(binding,async payload=>{
 calls.push(payload); return {bytesWritten:Buffer.byteLength(payload)};
}),{name:'spending'});
try {
 await drain();
 const e=evaluationFixture(), f=policyFacts(e,binding);
 const verification=config.stale ? {...f.verification,receipts:f.verification.receipts.map(r=>({...r,...config.stale}))} : f.verification;
 sources.pack.down([['DATA',evaluationPack([e],binding)]]);
 batch(()=>{
  sources.current.down([['DATA',f.current]]);
  sources.verification.down([['DATA',verification]]);
  sources.local.down([['DATA',f.local]]);
  sources.arrivals.down([['DATA',{packRef:binding.packRef,evaluationRefs:[e.evaluationRef]}]]);
 });
 await drain();
 const state=checkpointStateOfNode(graph.find('spending/causal/authority')).ctxState.value;
 const effects=[...state.effects.values()];
 const expected=oracleRequest(e,binding).body.payloadText+'\\n';
 if(config.stale) {
  assert.equal(calls.length,0); assert.equal(host.inspect().records.length,0);
  assert.equal(effects.some(e=>e.outcome?.state==='succeeded'),false);
 } else {
  assert.deepEqual(calls,[expected]); assert.equal(effects.length,1);
  assert.equal(effects[0].outcome?.state,'succeeded');
  assert.deepEqual(effects[0].outcome.admissionRef,effects[0].admission.admissionRef);
 }
 assert.equal(host.inspect().fault,undefined);
 const description=graph.describe();
 console.log(JSON.stringify({binding,stale:config.stale??null,calls,oraclePayload:expected,
  outcomes:effects.map(e=>e.outcome??null),records:host.inspect().records.length,
  topology:{nodes:description.nodes.map(n=>({id:n.id,factory:n.factory})),edges:description.edges},realInboxIO:0}));
} finally {
 for(const root of host.owner.roots) root.unsubscribe?.();
 const group=graph.topologyGroup(); for(const n of graph.describe().nodes) group.add(graph.find(n.id)); group.release();
}
`;

const dir = mkdtempSync(join(tmpdir(), "spending-source-binding-"));
try {
	const bundles = [];
	for (const candidate of [false, true]) {
		const transformed = new Map();
		let replacements = 0;
		const outfile = join(dir, candidate ? "candidate.mjs" : "baseline.mjs");
		const result = await build({
			stdin: {
				contents: entry,
				resolveDir: root,
				sourcefile: "source-binding-worker.ts",
				loader: "ts",
			},
			bundle: true,
			platform: "node",
			format: "esm",
			outfile,
			metafile: true,
			plugins: [
				{
					name: "isolated-equivalent-edit",
					setup(b) {
						b.onLoad({ filter: /\.ts$/ }, (args) => {
							let contents = readFileSync(args.path, "utf8");
							if (relative(root, args.path) === target && candidate) {
								assert.equal(contents.split(from).length - 1, 1);
								contents = contents.replace(from, to);
								replacements++;
							}
							transformed.set(relative(root, args.path), contents);
							return { contents, loader: "ts" };
						});
					},
				},
			],
		});
		assert.equal(replacements, candidate ? 1 : 0);
		const inputs = Object.keys(result.metafile.inputs)
			.sort()
			.map((path) => {
				const text =
					path === "source-binding-worker.ts"
						? entry
						: (transformed.get(path) ?? readFileSync(resolve(root, path)));
				return { path, sha256: sha(text) };
			});
		const bundleSha256 = sha(readFileSync(outfile));
		bundles.push({
			outfile,
			candidate,
			inputs,
			bundleSha256,
			binding: {
				sourceDigest: `sha256:${sha(JSON.stringify(inputs))}`,
				runtimeDigest: `sha256:${bundleSha256}`,
			},
		});
	}
	const [baseline, candidate] = bundles;
	assert.notEqual(baseline.binding.sourceDigest, candidate.binding.sourceDigest);
	assert.notEqual(baseline.bundleSha256, candidate.bundleSha256);
	assert.deepEqual(
		baseline.inputs.map((i) => i.path),
		candidate.inputs.map((i) => i.path),
	);
	assert.deepEqual(
		candidate.inputs.filter((v, i) => v.sha256 !== baseline.inputs[i].sha256).map((v) => v.path),
		[target],
	);
	const execute = (bundle, stale) => {
		const result = spawnSync(
			process.execPath,
			[bundle.outfile, JSON.stringify({ binding: bundle.binding, stale })],
			{ encoding: "utf8", timeout: 30000 },
		);
		assert.equal(result.error, undefined);
		assert.equal(result.signal, null);
		assert.equal(result.status, 0, result.stderr);
		return JSON.parse(result.stdout.trim());
	};
	const control = execute(baseline);
	const staleBoth = execute(candidate, baseline.binding);
	const staleSource = execute(candidate, { sourceDigest: baseline.binding.sourceDigest });
	const staleRuntime = execute(candidate, { runtimeDigest: baseline.binding.runtimeDigest });
	const fresh = execute(candidate);
	for (const run of [staleBoth, staleSource, staleRuntime, fresh])
		assert.deepEqual(run.topology, control.topology);
	assert.deepEqual(fresh.calls, control.calls);
	assert.equal(fresh.oraclePayload, control.oraclePayload);
	assert.equal(fresh.outcomes[0].state, control.outcomes[0].state);
	assert.deepEqual(fresh.outcomes[0].result, control.outcomes[0].result);
	const output = resolve(
		root,
		process.argv[2] ?? "docs/design/causal-integrated-implementation/source-binding.json",
	);
	writeFileSync(
		output,
		JSON.stringify(
			{
				verified: true,
				realInboxIO: 0,
				scope:
					"One equivalent vendorStats implementation edit; no claim that arbitrary algorithm changes preserve consequences. Offline resource only.",
				provenance: {
					actor: "Codex qualification tool",
					operation: "in-memory esbuild onLoad source edit",
					productionSourceEdited: false,
					target,
					from,
					to,
				},
				digestMethod: {
					source:
						"SHA256 of JSON sorted metafile input path/SHA256 pairs over actual transformed source bytes, including worker and oracle fixtures",
					runtime: "SHA256 of executed bundle bytes; Node/environment is recorded separately",
				},
				node: process.version,
				toolSha256: sha(readFileSync(import.meta.filename)),
				bundles: bundles.map(({ outfile, ...receipt }) => receipt),
				results: { control, staleBoth, staleSource, staleRuntime, fresh },
			},
			null,
			2,
		) + "\n",
	);
	console.log(
		JSON.stringify({
			verified: true,
			staleCases: 3,
			topologyEqual: true,
			oraclePayloadEqual: true,
			output,
		}),
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
