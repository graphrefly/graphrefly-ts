/** Untimed real adapters, independent plain values and lifecycle checks; no timing loop. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [dir, scenarioPath] = process.argv.slice(2);
const a = await import(pathToFileURL(path.resolve(dir, "worker.mjs"))),
	b = await import(pathToFileURL(path.resolve(dir, "worker-copy.mjs")));
const driver = await import(pathToFileURL(path.resolve(dir, "BASE.mjs")));
const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const row = { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" };
const pa = a.preflight(row, scenario),
	pb = b.preflight(row, scenario);
assert.deepEqual(pa, pb);
let constructed = 0,
	cleaned = 0;
const modules = [a, b].map((m) => ({
	RECIPE: m.RECIPE,
	measurementArm(...args) {
		constructed++;
		const run = m.measurementArm(...args);
		return {
			...run,
			cleanup() {
				try {
					return run.cleanup();
				} finally {
					cleaned++;
				}
			},
		};
	},
}));
const make = driver.makeFactory(modules, "control");
const runs = [];
let primary;
const errors = [];
const canonical = (x) =>
	JSON.stringify(x, (_, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, v[k]]),
				)
			: v,
	);
const sorted = (xs) => xs.map(canonical).sort();
try {
	runs.push(make("candidate", "summary"));
	runs.push(make("reference", "summary"));
	runs.push(a.measurementArm("plain", "summary"));
	for (const step of scenario.steps) {
		for (const run of runs) run.send(step);
		const snapshot = a.graphSnapshot(runs[0]);
		assert.deepEqual(snapshot, b.graphSnapshot(runs[1]));
		assert.deepEqual(snapshot.effects, runs[2].plain.snapshot());
		assert.deepEqual(snapshot.evidence, sorted(runs[2].plain.evidenceSnapshot()));
		assert.deepEqual(snapshot.obligations, sorted(runs[2].plain.obligationSnapshot()));
	}
	for (const run of runs.slice(0, 2)) {
		const saved = a.graphSnapshot(run);
		run.disconnect();
		assert.deepEqual(a.graphSnapshot(run), saved);
		run.connect();
		assert.deepEqual(a.graphSnapshot(run), saved);
	}
} catch (error) {
	primary = error;
} finally {
	if (primary) errors.push(primary);
	for (const run of runs)
		try {
			run.cleanup();
		} catch (error) {
			errors.push(error);
		}
}
if (errors.length) throw new AggregateError(errors, "qualification cleanup");
assert.equal(constructed, 2);
assert.equal(cleaned, 2);
for (const run of runs.slice(0, 2)) assert.equal(run.graph.describe().nodes.length, 0);
console.log(
	JSON.stringify({
		passed: true,
		preflightCalls: 2,
		preflightInstances: 6,
		adapterInstances: 2,
		additionalPlainInstances: 1,
		totalInstances: 9,
		performanceSamples: 0,
		adapterCleanupCount: cleaned,
		preflight: pa,
	}),
);
