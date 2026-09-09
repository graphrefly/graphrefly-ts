/** Frozen finite performance protocol; sample clocks surround only the declared arm action. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { checkpointStateOfNode } from "../../packages/ts/src/node/runtime-accessors.js";
import {
	type Arm,
	type HarnessFact,
	publicationFacts,
	publicationProfile,
	publicationRun,
} from "./spending-publication-harness.js";
import {
	oracleCanonical,
	oracleHash,
	oracleMaterial,
	oracleSnapshot,
	PlainPublication,
} from "./spending-publication-oracle.js";

const output = process.argv[2];
assert.ok(output);
const checkOnly = process.argv.includes("--check-only");
const config = {
	effects: [1, 16, 64],
	payloadBytes: [0, 1024, 8192],
	changePercent: [0, 1, 100],
	messageCounts: [1, 2],
	observation: [false, true],
	warmupPairs: 100,
	measuredPairs: 300,
	batches: ["AB", "BA", "AB"],
	reconnections: 20,
	constructionMax: 1.2,
	steadyMax: 1.1,
};
const ns = (fn: () => void) => {
	const t = performance.now();
	fn();
	return (performance.now() - t) * 1e6;
};
const p = (values: number[], q: number) => {
	const a = [...values].sort((x, y) => x - y);
	return a[Math.max(0, Math.ceil(q * a.length) - 1)];
};
const stats = (a: number[]) => ({ p50Ns: p(a, 0.5), p95Ns: p(a, 0.95), samples: a });
function setup(
	f: ReturnType<typeof publicationRun>,
	facts: HarnessFact[],
	frame: unknown,
	first: boolean,
) {
	f.connect();
	if (first) f.frame(frame);
	f.release(facts[0]);
	f.send("effectProposals", ...facts.map((x) => x.proposal));
	f.send("effectAdmissions", ...facts.map((x) => x.admission));
	if (!first) f.frame(frame);
}
function indexSize(f: ReturnType<typeof publicationRun>) {
	const state = checkpointStateOfNode(f.built.requestMaterialJoin).ctxState?.value as
		| { index?: { rows: ReadonlyMap<string, unknown> } }
		| undefined;
	return state?.index?.rows.size;
}
function assertWork(f: ReturnType<typeof publicationRun>, count: number, material: string) {
	assert.equal(f.view?.effects.length, count);
	assert.equal(f.latest?.rows.length, count);
	assert.ok(
		f.latest?.rows.every((r) => r.material === material && r.recorded === "admitted-no-outcome"),
	);
	assert.equal(indexSize(f), count);
	assert.equal(f.latest?.unmatchedMaterials, material === "matched" ? 0 : count);
}

const checks: unknown[] = [],
	construction: unknown[] = [],
	steady: unknown[] = [],
	recovery: unknown[] = [];
let complete = false;
const failures: string[] = [];
const report = () => ({
	schema: "graphrefly-ts/spending-publication-comparison/v1",
	config,
	checkOnly,
	checks,
	construction,
	steady,
	recovery,
	failures,
	complete,
	limits: [
		"Finite passive consumer association only; no host execution or audience comprehension qualification.",
		"Zero-byte profile means empty message plus the required JSON fields; other byte profiles are exact canonical payload byte counts.",
		"Construction measures full cold assembly/start without business DATA. Payload affects separate recovery and steady phases.",
		"Steady timing measures material DATA through two nodes with E real committed records; material changes alternate valid matched and valid unmatched bodies, leaving authority facts intact.",
		"Plain arm receives the same passive material and committed-view inputs; it does not benchmark upstream authority admission work.",
		"Exact hash counts, index identity reuse/replacement and RAM cache release are separately asserted by the finite actual work matrix in spending-alerts-causal-publication.test.ts, without timing instrumentation.",
		"Same-wave two-message input reduces to its last DATA; plain consumes that same final passive frame.",
		"Summary observer serializes path/type only. Heap deltas are descriptive and include harness samples; deterministic bounds and RAM release are separate assertions.",
	],
});
try {
	for (const count of config.effects)
		for (const bytes of config.payloadBytes)
			for (const observe of config.observation) {
				const facts = Array.from({ length: count }, (_, i) => publicationFacts(`f${i}`, bytes));
				const original = oracleSnapshot(
					publicationProfile,
					facts.map((f) => f.material),
				);
				const changed = oracleSnapshot(
					publicationProfile,
					facts.map((f) => {
						const b = f.material.body,
							payload = JSON.parse(b.payloadText);
						payload.message = payload.message.length
							? "y".repeat(payload.message.length)
							: "changed";
						const payloadText = oracleCanonical(payload);
						return oracleMaterial({ ...b, payloadText, payloadDigest: oracleHash(payloadText) });
					}),
				);
				// Both frames are valid; only the original matches the fixed admitted proposal.
				const frames = [original, changed];
				for (const first of [false, true]) {
					const a = publicationRun("production", { capacity: count, observe }),
						b = publicationRun("reference", { capacity: count, observe }),
						plain = new PlainPublication(publicationProfile);
					setup(a, facts, original, first);
					setup(b, facts, original, first);
					const coldSamples = { production: [] as number[], reference: [] as number[] };
					if (!checkOnly)
						for (const order of config.batches) {
							for (let i = 0; i < config.warmupPairs + config.measuredPairs; i++) {
								for (const arm of (order === "AB"
									? ["production", "reference"]
									: ["reference", "production"]) as Arm[]) {
									const cold = publicationRun(arm, { capacity: count, observe });
									const elapsed = ns(() => setup(cold, facts, original, first));
									assert.equal(cold.latest?.rows.length, count);
									if (i >= config.warmupPairs) coldSamples[arm].push(elapsed);
									cold.close();
								}
							}
						}
					plain.connect();
					plain.acceptView(a.view!);
					plain.acceptMaterial(original);
					assert.deepEqual(a.latest, b.latest);
					assert.deepEqual(a.latest, plain.project());
					assert.equal(a.owner.nodes.length, 26);
					assert.equal(b.owner.nodes.length, 26);
					assert.equal(a.owner.roots.length, 2);
					assert.equal(b.owner.roots.length, 2);
					assertWork(a, count, "matched");
					assertWork(b, count, "matched");
					const reconnectA: number[] = [],
						reconnectB: number[] = [],
						plainReconnect: number[] = [];
					for (let i = 0; i < config.reconnections; i++) {
						a.disconnect();
						b.disconnect();
						plain.disconnect();
						assert.equal(
							checkpointStateOfNode(a.built.requestMaterialJoin).ctxState?.value,
							undefined,
						);
						assert.equal(
							checkpointStateOfNode(b.built.requestMaterialJoin).ctxState?.value,
							undefined,
						);
						reconnectA.push(ns(() => a.connect()));
						reconnectB.push(ns(() => b.connect()));
						plainReconnect.push(
							ns(() => {
								plain.connect();
							}),
						);
						assert.deepEqual(a.latest, b.latest);
						assert.deepEqual(a.latest, plain.project());
					}
					a.frames([changed, original]);
					b.frames([changed, original]);
					plain.acceptMaterial(original);
					assert.deepEqual(a.latest, b.latest);
					assert.deepEqual(a.latest, plain.project());
					recovery.push({
						count,
						bytes,
						observe,
						first,
						cold: checkOnly
							? null
							: {
									production: stats(coldSamples.production),
									reference: stats(coldSamples.reference),
								},
						reconnections: {
							production: stats(reconnectA),
							reference: stats(reconnectB),
							plain: stats(plainReconnect),
						},
						resources: {
							nodes: 26,
							roots: 2,
							indexSize: { production: indexSize(a), reference: indexSize(b) },
							indexLimit: 64,
							frameBytes: Buffer.byteLength(oracleCanonical(original)),
							extraRetainedRoots: 0,
						},
						observed: { production: a.stats(), reference: b.stats() },
					});
					if (first === false)
						checks.push({
							count,
							bytes,
							observe,
							inputs: frames,
							committed: a.view,
							actual: a.latest,
							expected: plain.project(),
							graph: a.graph.describe(),
						});
					a.close();
					b.close();
					plain.disconnect();
				}
				if (checkOnly) continue;
				const coldBatches: { production: number[]; reference: number[] }[] = [];
				for (const order of config.batches) {
					const sample = { production: [] as number[], reference: [] as number[] };
					for (let i = 0; i < config.warmupPairs + config.measuredPairs; i++)
						for (const arm of (order === "AB"
							? ["production", "reference"]
							: ["reference", "production"]) as Arm[]) {
							let run: ReturnType<typeof publicationRun> | undefined;
							const elapsed = ns(() => {
								run = publicationRun(arm, { capacity: count, observe });
							});
							run!.close();
							if (i >= config.warmupPairs) sample[arm].push(elapsed);
						}
					coldBatches.push(sample);
				}
				const coldA = coldBatches.flatMap((x) => x.production),
					coldB = coldBatches.flatMap((x) => x.reference),
					ratio = p(coldA, 0.95) / p(coldB, 0.95);
				construction.push({
					count,
					bytes,
					observe,
					ratio,
					passed: ratio <= config.constructionMax,
					batches: coldBatches,
					production: stats(coldA),
					reference: stats(coldB),
				});
				if (ratio > config.constructionMax)
					failures.push(`construction:${count}/${bytes}/${observe}:${ratio}`);
				for (const rate of config.changePercent)
					for (const messageCount of config.messageCounts) {
						const batches: unknown[] = [];
						const productionP95: number[] = [],
							referenceP95: number[] = [];
						for (const [batch, order] of config.batches.entries()) {
							const a = publicationRun("production", { capacity: count, observe }),
								b = publicationRun("reference", { capacity: count, observe }),
								plain = new PlainPublication(publicationProfile);
							setup(a, facts, original, batch % 2 === 0);
							setup(b, facts, original, batch % 2 === 0);
							plain.connect();
							plain.acceptView(a.view!);
							plain.acceptMaterial(original);
							const samples = {
								production: [] as number[],
								reference: [] as number[],
								plain: [] as number[],
							};
							const heapBefore = process.memoryUsage().heapUsed;
							let revision = 0,
								changes = 0;
							for (let i = 0; i < config.warmupPairs + config.measuredPairs; i++) {
								const change = rate === 100 || (rate === 1 && i % 100 === 99);
								if (change) revision++;
								const frame = frames[revision % 2];
								const times: Record<string, number> = {};
								for (const arm of order === "AB"
									? ["production", "reference"]
									: ["reference", "production"])
									times[arm] = ns(() => {
										const run = arm === "production" ? a : b;
										if (messageCount === 1) run.frame(frame);
										else run.frames([frame, frame]);
									});
								times.plain = ns(() => {
									plain.acceptMaterial(frame);
								});
								assert.deepEqual(a.latest, b.latest);
								assert.deepEqual(a.latest, plain.project());
								assertWork(a, count, revision % 2 === 0 ? "matched" : "missing");
								assertWork(b, count, revision % 2 === 0 ? "matched" : "missing");
								if (i >= config.warmupPairs) {
									for (const key of ["production", "reference", "plain"] as const)
										samples[key].push(times[key]);
									changes += change ? 1 : 0;
								}
							}
							const batchRatio = p(samples.production, 0.95) / p(samples.reference, 0.95);
							productionP95.push(p(samples.production, 0.95));
							referenceP95.push(p(samples.reference, 0.95));
							batches.push({
								order,
								actualChanges: changes,
								actualChangePercent: (100 * changes) / config.measuredPairs,
								ratio: batchRatio,
								production: stats(samples.production),
								reference: stats(samples.reference),
								plain: stats(samples.plain),
								heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
								observation: { production: a.stats(), reference: b.stats() },
							});
							a.close();
							b.close();
							plain.disconnect();
						}
						const ratio = p(productionP95, 0.5) / p(referenceP95, 0.5);
						steady.push({
							count,
							bytes,
							observe,
							rate,
							messageCount,
							ratio,
							passed: ratio <= config.steadyMax,
							batches,
						});
						if (ratio > config.steadyMax)
							failures.push(`steady:${count}/${bytes}/${observe}/${rate}/${messageCount}:${ratio}`);
					}
				writeFileSync(output, JSON.stringify(report()) + "\n");
				console.log("PUBLICATION_ROW_DONE", count, bytes, observe, "failures", failures.length);
			}
	complete = true;
} finally {
	writeFileSync(output, JSON.stringify(report()) + "\n");
	console.log("PUBLICATION_COMPARISON_DONE", complete, failures.length);
}
if (failures.length) process.exitCode = 1;
