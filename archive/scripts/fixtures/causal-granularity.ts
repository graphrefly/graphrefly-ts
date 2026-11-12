/** Existing-input diagnostic. All assertions and snapshots are outside action clocks. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import type { Evaluation } from "../../examples/spending-alerts/causal-inputs.js";
import { oracleCanonical, verifyBusiness } from "./spending-preset-oracle.js";
import {
	type Arm,
	measurementArm,
	type Row,
	type Scenario,
	schedule,
} from "./spending-preset-performance.js";

const root = new URL("./", import.meta.url);
const freeze = JSON.parse(readFileSync(new URL("freeze.json", root), "utf8"));
const job = freeze.jobs[Number(process.argv[2])];
assert.equal(job.id, Number(process.argv[2]));
const scenario: Scenario = JSON.parse(
	readFileSync(new URL(`${job.row.profile}-inputs.json`, root), "utf8"),
);
const row: Row = job.row;
const original = schedule(row, scenario);
const plan = structuredClone(original);
if (job.selection === "last")
	for (const step of plan.action)
		if (step.lane === "arrivals")
			for (const v of step.values)
				(v as { evaluationRefs: string[] }).evaluationRefs = [
					scenario.arrivals.evaluationRefs.at(-1)!,
				];
const sorted = (v: unknown[]) => v.map((x) => oracleCanonical(x)).sort();
function snapshot(run: ReturnType<typeof measurementArm>) {
	if ("plain" in run)
		return {
			effects: run.plain.snapshot(),
			evidence: sorted(run.plain.evidenceSnapshot()),
			obligations: sorted(run.plain.obligationSnapshot()),
		};
	const s = run.state();
	return {
		effects: [...(s?.effects.values() ?? [])].map((x) => ({
			proposal: x.proposal,
			admission: x.admission ?? null,
			outcome: x.outcome ?? null,
		})),
		evidence: sorted([...(s?.evidence.values() ?? [])]),
		obligations: sorted(
			[...(s?.quiescence.values() ?? [])].map(
				({ revisionDomain, evaluatedThroughRevision, lifecycle, retainedEvidence }) => ({
					revisionDomain,
					evaluatedThroughRevision,
					lifecycle,
					retainedEvidence,
				}),
			),
		),
	};
}
function trace(run: ReturnType<typeof measurementArm>) {
	assert.ok("graph" in run);
	const changes: string[] = [];
	let prior = "";
	const stop = run.graph.find("spending/causal/authority")!.subscribe((m) => {
		if (m[0] !== "DATA") return;
		const text = JSON.stringify({
			fact: (m[1] as { fact: unknown }).fact,
			effects: snapshot(run).effects,
		});
		if (text !== prior) {
			changes.push(text);
			prior = text;
		}
	});
	return { changes, stop };
}
function preflight() {
	const runs = (["candidate", "reference", "plain"] as Arm[]).map((a) => measurementArm(a, "off"));
	const full = measurementArm("candidate", "off");
	const traces = [trace(runs[0]), trace(runs[1]), trace(full)];
	try {
		for (const step of [...plan.before, ...plan.action]) {
			for (const r of runs) r.send(step);
			assert.deepEqual(snapshot(runs[1]), snapshot(runs[0]));
			assert.deepEqual(snapshot(runs[2]), snapshot(runs[0]));
			assert.deepEqual(
				traces[1].changes,
				traces[0].changes,
				"intermediate Graph effect transitions",
			);
			assert.ok("state" in runs[0] && "state" in runs[1]);
			assert.deepEqual(runs[1].state(), runs[0].state(), "complete authority state");
			assert.ok("latest" in runs[0] && "latest" in runs[1]);
			assert.deepEqual(
				runs[1].latest.publication,
				runs[0].latest.publication,
				"material/publication projection",
			);
		}
		for (const step of [...original.before, ...original.action]) full.send(step);
		assert.deepEqual(snapshot(full), snapshot(runs[0]), "full/subset retained consequences");
		assert.deepEqual(
			traces[2].changes,
			traces[0].changes,
			"full/subset intermediate effect transitions",
		);
		assert.ok("state" in full && "state" in runs[0]);
		assert.deepEqual(full.state(), runs[0].state(), "full/subset complete authority");
		assert.ok("latest" in full && "latest" in runs[0]);
		assert.deepEqual(
			full.latest.publication,
			runs[0].latest.publication,
			"full/subset material publication",
		);
		for (const run of runs)
			if ("latest" in run) {
				const rows = (
					run.latest.assessment as {
						rows: { evaluation: Evaluation; value: Parameters<typeof verifyBusiness>[1] }[];
					}
				).rows;
				assert.ok(
					rows.some((r) => r.evaluation.evaluationRef === scenario.arrivals.evaluationRefs.at(-1)),
				);
				for (const r of rows) assert.ok(verifyBusiness(r.evaluation, r.value));
				const before = snapshot(run);
				run.disconnect();
				assert.deepEqual(snapshot(run), before);
				run.connect();
				assert.deepEqual(snapshot(run), before);
			}
		return snapshot(runs[0]);
	} finally {
		for (const t of traces) t.stop();
		for (const r of [...runs, full]) r.cleanup();
	}
}
const expected = preflight();
if (process.argv[3] === "check") {
	console.log("GRANULARITY_CHECKED", job.id);
	process.exit(0);
}
const records = [];
for (const arm of job.order as Arm[]) {
	const observations = [];
	records.push({ arm, observations });
	for (let i = 0; i < 7; i++) {
		const built = performance.now();
		const run = measurementArm(arm, "off");
		const constructionMs = performance.now() - built;
		try {
			const prepare = performance.now();
			for (const s of plan.before) run.send(s);
			const preparationMs = performance.now() - prepare;
			const begin = performance.now();
			run.send(plan.action[0]);
			const arrived = performance.now();
			for (const step of plan.action.slice(1)) run.send(step);
			const end = performance.now();
			assert.deepEqual(snapshot(run), expected, "timed instance consequences");
			observations.push({
				index: i,
				phase: i < 2 ? "warmup" : "measured",
				arrivalMs: arrived - begin,
				verificationMs: end - arrived,
				totalMs: end - begin,
				constructionMs,
				preparationMs,
			});
			writeFileSync(
				new URL(`partial-${job.id}.json`, root),
				JSON.stringify({ job, records }) + "\n",
			);
		} finally {
			run.cleanup();
		}
	}
}
writeFileSync(
	new URL(`job-${job.id}.json`, root),
	JSON.stringify({
		job,
		pid: process.pid,
		timeOrigin: performance.timeOrigin,
		node: process.version,
		preflight: true,
		profiler: false,
		formalQualified: false,
		records,
	}) + "\n",
	{ flag: "wx" },
);
console.log("GRANULARITY_DONE", job.id);
