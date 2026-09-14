/** Replay actual before/after bundles; compare policy output sequence and authority after each step. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2]);
const f = JSON.parse(readFileSync(resolve(root, "freeze.json")));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const workers = [];
for (const arm of ["before", "after"]) {
	assert.equal(sha(readFileSync(resolve(root, arm + ".mjs"))), f.bundles[arm]);
	workers.push(await import(pathToFileURL(resolve(root, arm + ".mjs")).href));
}
const results = [];
for (const profile of ["P1", "P3", "P6"])
	for (const recipe of ["initial", "delayed-verification", "wrong-then-replaced-grants"]) {
		const bytes = readFileSync(resolve(root, profile + "-inputs.json"));
		assert.equal(sha(bytes), f.inputs[profile]);
		const input = JSON.parse(bytes);
		const runs = workers.map((w) => w.measurementArm("candidate", "off")),
			traces = [[], []],
			stops = [];
		try {
			for (const [i, run] of runs.entries()) {
				const nodes = run.graph
					.describe()
					.nodes.filter((n) => n.name?.endsWith("/publicationPolicy"));
				assert.equal(nodes.length, 1);
				stops.push(
					run.graph.find(nodes[0].id).subscribe((m) => {
						if (m[0] === "DATA") traces[i].push(structuredClone(m[1]));
					}),
				);
			}
			let steps = input.steps;
			if (recipe === "delayed-verification")
				steps = [
					...input.steps.filter((s) => s.lane !== "verification"),
					...input.steps.filter((s) => s.lane === "verification"),
				];
			if (recipe === "wrong-then-replaced-grants")
				steps = [
					...input.steps.map((s) =>
						s.lane !== "local"
							? s
							: {
									...s,
									values: s.values.map((v) => ({
										...v,
										grants: v.grants.map((g) => ({
											...g,
											occurrence: { ...g.occurrence, sourceRefs: [{ kind: "wrong", id: "grant" }] },
										})),
									})),
								},
					),
					...input.steps.filter((s) => s.lane === "local"),
				];
			steps = [...steps, { lane: "arrivals", values: [input.arrivals, input.arrivals] }];
			for (const step of steps) {
				for (const run of runs) run.send(step);
				assert.deepEqual(runs[0].state(), runs[1].state());
				assert.deepEqual(traces[0], traces[1]);
			}
			const before = structuredClone(runs[0].state());
			for (const run of runs) {
				run.disconnect();
				run.connect();
			}
			assert.deepEqual(runs[0].state(), before);
			assert.deepEqual(runs[0].state(), runs[1].state());
			assert.deepEqual(traces[0], traces[1]);
			assert.ok(traces[0].some((frame) => frame.rows.length));
			results.push({
				profile,
				recipe,
				steps: steps.length,
				policyFrames: traces[0].length,
				orderedPolicyAndAuthorityParity: true,
			});
		} finally {
			for (const stop of stops) stop();
			for (const run of runs) run.cleanup();
		}
	}
console.log(
	JSON.stringify(
		{
			verified: true,
			scope:
				"Nine paired workflows, complete policy frame order and authority state after each step; no general alias proof",
			results,
		},
		null,
		2,
	),
);
