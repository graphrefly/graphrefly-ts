/** First Graph/plain action in a new process; imported module/process startup excluded. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import type { Evaluation } from "../../examples/spending-alerts/causal-inputs.js";
import { verifyBusiness } from "./spending-preset-oracle.js";
import { type Arm, measurementArm, type Scenario } from "./spending-preset-performance.js";
import { preflight } from "./spending-preset-performance-worker.js";

const f = JSON.parse(readFileSync(new URL("first-freeze.json", import.meta.url), "utf8"));
const job = f.jobs[Number(process.argv[2])];
assert.equal(job.id, Number(process.argv[2]));
const scenario: Scenario = JSON.parse(
	readFileSync(new URL(`${job.profile}-inputs.json`, import.meta.url), "utf8"),
);
const start = performance.now();
const run = measurementArm(job.arm as Arm, "off");
const built = performance.now();
try {
	for (const step of scenario.steps) run.send(step);
	const end = performance.now();
	if ("latest" in run) {
		const rows = (run.latest.assessment as { rows: { evaluation: Evaluation; value: any }[] }).rows;
		assert.equal(rows.length, scenario.evaluations.length);
		for (const r of rows) assert.ok(verifyBusiness(r.evaluation, r.value));
	}
	const checked = preflight(
		{ id: `cold-${job.profile}-off`, group: "cold", profile: job.profile, mode: "off" },
		scenario,
	);
	assert.equal(checked.passed, true);
	writeFileSync(
		new URL(`first-${job.id}.json`, import.meta.url),
		JSON.stringify({
			job,
			pid: process.pid,
			timeOrigin: performance.timeOrigin,
			constructionMs: built - start,
			processingMs: end - built,
			totalMs: end - start,
			preflightAfterTiming: true,
			businessCheckedAfterTiming: "latest" in run,
			profiler: false,
			formalQualification: false,
		}) + "\n",
		{ flag: "wx" },
	);
} finally {
	run.cleanup();
}
