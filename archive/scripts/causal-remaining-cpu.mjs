/** Action-only CPU sampling, setup/preflight excluded; diagnostic, not latency acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dir, idArg] = process.argv.slice(2),
	root = resolve(dir);
const read = (n) => JSON.parse(readFileSync(resolve(root, n), "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const freeze = read("freeze.json"),
	job = freeze.jobs[Number(idArg)];
assert.equal(job.id, Number(idArg));
for (const [name, digest] of Object.entries(freeze.files))
	assert.equal(sha(readFileSync(resolve(root, name))), digest);
const worker = await import(pathToFileURL(resolve(root, "worker.mjs")).href),
	scenario = read("P6-inputs.json");
assert.equal(
	worker.preflight({ id: "cold-P6-off", group: "cold", profile: "P6", mode: "off" }, scenario)
		.passed,
	true,
);
const session = new Session();
session.connect();
const post = (method, params = {}) =>
	new Promise((ok, no) =>
		session.post(method, params, (err, result) => (err ? no(err) : ok(result))),
	);
const profiles = [];
let expected;
try {
	await post("Profiler.enable");
	await post("Profiler.setSamplingInterval", { interval: 500 });
	for (let i = -1; i < 5; i++) {
		const run = worker.measurementArm("candidate", "off");
		try {
			let action;
			if (job.recipe === "duplicate2") {
				for (const s of scenario.steps) run.send(s);
				action = [{ lane: "arrivals", values: [scenario.arrivals, scenario.arrivals] }];
			} else {
				for (const s of scenario.steps) if (s.lane !== "verification") run.send(s);
				action = scenario.steps.filter((s) => s.lane === "verification");
			}
			if (i >= 0) await post("Profiler.start");
			const start = performance.now();
			for (const step of action) run.send(step);
			const elapsed = performance.now() - start;
			const sampled = i >= 0 ? await post("Profiler.stop") : undefined;
			const state = structuredClone(run.state());
			if (i === -1) expected = state;
			else assert.deepEqual(state, expected);
			if (sampled) profiles.push({ index: i, elapsedMs: elapsed, profile: sampled.profile });
		} finally {
			run.cleanup();
		}
	}
	writeFileSync(
		resolve(root, `job-${job.id}.json`),
		JSON.stringify({
			job,
			pid: process.pid,
			node: process.version,
			preflight: true,
			stateChecks: true,
			formalQualified: false,
			profiles,
		}) + "\n",
		{ flag: "wx" },
	);
	console.log("REMAINING_CPU_DONE", job.id);
} finally {
	session.disconnect();
}
