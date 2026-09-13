/** Unprofiled synchronous consumer latency; diagnostic only, no formal p95 claim. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
	type Arm,
	measurementArm,
	type Row,
	type Scenario,
	schedule,
} from "./spending-preset-performance.js";
import { preflight } from "./spending-preset-performance-worker.js";

const root = new URL("./", import.meta.url);
const frozen = JSON.parse(readFileSync(new URL("freeze.json", root), "utf8"));
const job = frozen.jobs[Number(process.argv[2])];
assert.equal(job.id, Number(process.argv[2]));
const scenario: Scenario = JSON.parse(
	readFileSync(new URL(`${job.row.profile}-inputs.json`, root), "utf8"),
);
const row: Row = job.row;
assert.equal(preflight(row, scenario).passed, true);
const plan = schedule(row, scenario);
const records = [];
for (let position = 0; position < 3; position++) {
	const label = job.order[position];
	const arm: Arm = label === "plain" ? "plain" : job.control ? "reference" : label;
	if (row.group === "recovery" && arm === "plain") continue;
	const observations = [];
	let shared: ReturnType<typeof measurementArm> | undefined;
	let expected: unknown;
	try {
		const measured = row.group === "cold" && !job.initial ? 100 : 5;
		const warmup = row.group === "cold" && !job.initial ? 20 : 2;
		for (let i = 0; i < warmup + measured; i++) {
			let run: ReturnType<typeof measurementArm> | undefined;
			try {
				const fresh =
					job.initial ||
					row.group === "cold" ||
					row.change === "all-new" ||
					row.change === "one-new";
				let constructionMs = 0,
					preparationMs = 0,
					actionMs = 0;
				if (job.initial) {
					const begin = performance.now();
					run = measurementArm(arm, "off");
					const built = performance.now();
					for (const s of scenario.steps) run.send(s);
					const end = performance.now();
					constructionMs = built - begin;
					preparationMs = end - built;
					actionMs = end - begin;
				} else {
					const begin = performance.now();
					run = shared ?? measurementArm(arm, "off");
					constructionMs = shared ? 0 : performance.now() - begin;
					const prepare = performance.now();
					if (!shared) for (const s of plan.before) run.send(s);
					preparationMs = shared ? 0 : performance.now() - prepare;
					const start = performance.now();
					if (row.group === "recovery") {
						run.disconnect();
						run.connect();
					} else for (const s of plan.action) run.send(s);
					actionMs = performance.now() - start;
					if (row.group === "cold") actionMs = constructionMs;
				}
				if (!fresh) shared = run;
				if ("state" in run) {
					const state = structuredClone(run.state());
					if (i === 0) expected = state;
					else assert.deepEqual(state, expected, "retained state stable across equivalent samples");
				}
				observations.push({
					index: i,
					phase: i < warmup ? "warmup" : "measured",
					ms: actionMs,
					constructionMs,
					preparationMs,
				});
			} finally {
				if (run !== shared) run?.cleanup();
			}
		}
	} finally {
		shared?.cleanup();
	}
	records.push({ label, arm, position, observations });
}
writeFileSync(
	new URL(`job-${job.id}.json`, root),
	JSON.stringify({
		job,
		records,
		pid: process.pid,
		timeOrigin: performance.timeOrigin,
		preflight: true,
		stateChecks: true,
		profiler: false,
		formalQualification: false,
	}) + "\n",
	{ flag: "wx" },
);
console.log("LATENCY_DONE", job.id);
