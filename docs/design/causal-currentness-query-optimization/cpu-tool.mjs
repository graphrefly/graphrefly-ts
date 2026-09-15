/** Fixed action CPU attribution; preflight/setup excluded, no performance acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [worker, input, output, countArg, repeatsArg] = process.argv.slice(2);
const dataCount = Number(countArg),
	repeats = Number(repeatsArg);
assert.ok([1, 2].includes(dataCount) && [20, 100].includes(repeats));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const { measurementArm, preflight } = await import(pathToFileURL(resolve(worker)).href);
const scenario = JSON.parse(readFileSync(input));
const row = {
	id: `steady-${scenario.id}-off-duplicate-${dataCount}`,
	group: "steady",
	profile: scenario.id,
	mode: "off",
	change: "duplicate",
	dataCount,
};
assert.equal(preflight(row, scenario).passed, true);
const run = measurementArm("candidate", "off");
const session = new Session();
session.connect();
const post = (method, params = {}) =>
	new Promise((ok, no) =>
		session.post(method, params, (err, result) => (err ? no(err) : ok(result))),
	);
try {
	for (const step of scenario.steps) run.send(step);
	const before = structuredClone(run.state());
	const step = {
		lane: "arrivals",
		values: Array.from({ length: dataCount }, () => ({
			...scenario.arrivals,
			evaluationRefs: scenario.arrivals.evaluationRefs,
		})),
	};
	await post("Profiler.enable");
	await post("Profiler.setSamplingInterval", { interval: 500 });
	await post("Profiler.start");
	const start = performance.now();
	for (let i = 0; i < repeats; i++) run.send(step);
	const elapsed = performance.now() - start;
	const { profile } = await post("Profiler.stop");
	assert.deepEqual(run.state(), before, "duplicate authority unchanged");
	writeFileSync(
		output,
		JSON.stringify({
			kind: "fixed-action-cpu-attribution",
			row,
			repeats,
			elapsed,
			workerDigest: sha(readFileSync(worker)),
			inputDigest: sha(readFileSync(input)),
			toolDigest: sha(readFileSync(new URL(import.meta.url))),
			profile,
			formalQualification: false,
		}) + "\n",
		{ flag: "wx" },
	);
	console.log("ACTION_CPU_DONE", row.id, repeats, profile.samples.length);
} finally {
	session.disconnect();
	run.cleanup();
}
