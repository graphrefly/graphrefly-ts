/** Untimed state-shape inspection, separate from CPU and latency captures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2]);
const read = (n) => JSON.parse(readFileSync(resolve(root, n)));
const f = read("freeze.json");
const sha = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(sha(readFileSync(resolve(root, "worker.mjs"))), f.files["worker.mjs"]);
const w = await import(pathToFileURL(resolve(root, "worker.mjs")).href),
	input = read("P6-inputs.json");
const results = [];
for (const recipe of ["duplicate2", "verification"]) {
	const run = w.measurementArm("candidate", "off");
	try {
		for (const s of input.steps)
			if (recipe === "duplicate2" || s.lane !== "verification") run.send(s);
		const before = run.state();
		const action =
			recipe === "duplicate2"
				? [{ lane: "arrivals", values: [input.arrivals, input.arrivals] }]
				: input.steps.filter((s) => s.lane === "verification");
		for (const s of action) run.send(s);
		const after = run.state();
		results.push({
			recipe,
			domains: [...after.quiescence].map(([domain, q]) => {
				const p = before.quiescence.get(domain);
				return {
					domain,
					pendingRefs: q.pendingOccurrenceRefs.length,
					pendingEffects: q.pendingEffectIds.length,
					jsonBytes: Buffer.byteLength(JSON.stringify(q)),
					referenceBytes: Buffer.byteLength(JSON.stringify(q.pendingOccurrenceRefs)),
					referenceKeys: q.pendingOccurrenceRefs[0] ? Object.keys(q.pendingOccurrenceRefs[0]) : [],
					sameReferenceSequence:
						!!p &&
						p.pendingOccurrenceRefs.length === q.pendingOccurrenceRefs.length &&
						p.pendingOccurrenceRefs.every((v, i) => v === q.pendingOccurrenceRefs[i]),
					allFrozen: q.pendingOccurrenceRefs.every(Object.isFrozen),
				};
			}),
		});
	} finally {
		run.cleanup();
	}
}
console.log(
	JSON.stringify({ workerSha256: f.files["worker.mjs"], untimed: true, results }, null, 2),
);
