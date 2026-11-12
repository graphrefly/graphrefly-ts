import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
	adaptWorker,
	checkQualification,
	decide,
	jobs,
	METHOD,
	sha,
	summarizeRepeat,
} from "./spending-preset-repetition.mjs";
import { verifyEvidence } from "./verify-spending-preset-repetition.mjs";

const dir = mkdtempSync(resolve(tmpdir(), "repetition-v2-tests-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const sourcePath = "scripts/fixtures/spending-preset-performance-worker.ts";
const original = readFileSync(sourcePath, "utf8"),
	adapted = adaptWorker(original);
const built = await build({
	stdin: { contents: adapted, resolveDir: resolve("scripts/fixtures"), loader: "ts" },
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
});
const workerPath = resolve(dir, "worker.mjs"),
	copyPath = resolve(dir, "worker-copy.mjs");
writeFileSync(workerPath, built.outputFiles[0].contents);
writeFileSync(copyPath, built.outputFiles[0].contents);
const worker = await import(pathToFileURL(workerPath).href);
const recipe = worker.RECIPE;
const qualificationIds = [
	"baseline",
	"dependency-guard-removed",
	"pack-bound-one-mib",
	"plain-cached-outcome-replay",
	"plain-evidence-omitted",
	"plain-unbounded-domains",
	"stale-join-rows",
	"wrong-score",
];
function samples(
	control = false,
	times = { candidate: [1, 1, 1], reference: [1, 1, 1], plain: [1, 1, 1] },
) {
	return recipe.orders.flatMap((pair, batch) =>
		[...pair, ...(control ? [] : ["plain"])].flatMap((arm) =>
			Array.from({ length: 400 }, (_, index) => {
				const start = index * 200,
					end = start + times[arm][batch];
				return {
					arm,
					batch,
					index,
					phase: index < 100 ? "warmup" : "measured",
					start,
					end,
					ms: end - start,
					constructionMs: 0,
					preparationMs: 0,
				};
			}),
		),
	);
}
test("fixed schedule has 16 repetitions and two controls before/after, no optional sample size", () => {
	assert.equal(jobs().length, 20);
	assert.equal(jobs().filter((j) => j.control).length, 4);
	assert.deepEqual(
		jobs()
			.slice(0, 2)
			.map((j) => j.id),
		["control-0", "control-1"],
	);
	assert.deepEqual(
		jobs()
			.slice(-2)
			.map((j) => j.id),
		["control-2", "control-3"],
	);
	assert.throws(() => decide(Array(15).fill(1), Array(4).fill(1)), /repetition count/);
});
test("approved boundary examples, outliers, means and control instability", () => {
	const vectors = JSON.parse(
		readFileSync("docs/design/causal-performance-repetition-v2.design-check.json", "utf8"),
	);
	for (const v of vectors.examples) {
		const r = decide(v.ratios, Array(4).fill(v.controlValid ? 1 : 1.1));
		assert.equal(r.verdict, v.verdict, v.name);
		assert.deepEqual(r.interval, v.interval);
		// The design vectors were calculated by Python; displayed means can differ by
		// one rounding step. Verdicts and order-statistic boundaries above remain exact.
		assert.ok(Math.abs(r.mean - v.mean) <= 2 * Number.EPSILON * Math.max(1, Math.abs(v.mean)));
	}
	assert.equal(decide(Array(16).fill(1.1), [1 / 1.05, 1.05, 1, 1]).verdict, "passed");
});
test("ratio of median p95s retained; controls contain exactly two measured arms", () => {
	for (const control of [false, true]) {
		const r = summarizeRepeat(
			METHOD.row,
			samples(control, { candidate: [1, 100, 101], reference: [1, 2, 100], plain: [1, 1, 1] }),
			recipe,
			control,
		);
		assert.equal(r.ratio, 50);
		assert.equal(r.sampleCount, control ? 2400 : 3600);
		assert.equal("plain" in r.arms, !control);
	}
});
test("missing, duplicate, swapped, nonfinite, extra and zero-denominator samples reject", () => {
	const data = samples();
	for (const change of [
		(d) => d.slice(1),
		(d) => [...d, d[0]],
		(d) => {
			d[100] = d[101];
			return d;
		},
		(d) => {
			d[0].arm = "reference";
			return d;
		},
		(d) => {
			d[0].ms = NaN;
			return d;
		},
		(d) => {
			d[0].end = -1;
			return d;
		},
	])
		assert.throws(() => summarizeRepeat(METHOD.row, change(structuredClone(data)), recipe, false));
	assert.throws(
		() =>
			summarizeRepeat(
				METHOD.row,
				samples(false, { candidate: [1, 1, 1], reference: [0, 0, 0], plain: [1, 1, 1] }),
				recipe,
				false,
			),
		/denominator/,
	);
});
test("worker generation fails closed on changed anchors and preserves original file", () => {
	assert.throws(
		() => adaptWorker(original.replace("measurementArm(arm, row.mode)", "different()")),
		/clock call sites/,
	);
	assert.equal(readFileSync(sourcePath, "utf8"), original);
	assert.equal(sha(readFileSync(workerPath)), sha(readFileSync(copyPath)));
});
test("semantic prerequisite rejects missing, duplicate, unknown and non-loadable mutants", () => {
	const q = {
		complete: true,
		results: qualificationIds.map((id) => ({
			id,
			loaded: true,
			outcome: id === "baseline" ? "passed" : "detected",
		})),
	};
	checkQualification(q);
	for (const mutate of [
		(r) => r.pop(),
		(r) => {
			r[7] = r[1];
		},
		(r) => {
			r[7].id = "other";
		},
		(r) => {
			r[7].loaded = false;
		},
	]) {
		const bad = structuredClone(q);
		mutate(bad.results);
		assert.throws(() => checkQualification(bad));
	}
});

const synthetic = resolve(dir, "synthetic");
mkdirSync(synthetic);
const put = (name, value) => {
	const target = resolve(synthetic, name);
	mkdirSync(resolve(target, ".."), { recursive: true });
	writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
};
function fakeEvidence() {
	const files = {};
	for (const [name, value] of Object.entries({
		"worker.mjs": "synthetic worker",
		"worker-copy.mjs": "synthetic worker",
		"source/design.md": "synthetic design",
		"P2-inputs.json": "{}",
		"adapted-worker.ts": "synthetic worker source",
		"source/scripts/qualify-spending-preset-reference.mjs": "synthetic qualifier",
		"source/packages/ts/src/__tests__/spending-alerts-preset-reference.test.ts":
			"synthetic semantic test",
		"approval.json": {
			design: "design.md",
			designDigest: sha("synthetic design"),
			measurementLimits: {
				row: "cold-P2-summary",
				processes: 20,
				samples: 67200,
				elapsedMs: 900000,
				retries: 0,
			},
		},
		"reference-qualification.json": {
			complete: true,
			recipeDigest: sha("synthetic qualifier"),
			testDigest: sha("synthetic semantic test"),
			copiedInputs: {},
			results: qualificationIds.map((id) => ({
				id,
				loaded: true,
				outcome: id === "baseline" ? "passed" : "detected",
			})),
		},
	})) {
		put(name, value);
		files[name] = sha(readFileSync(resolve(synthetic, name)));
	}
	const executionRoot = "/synthetic/execution";
	const freeze = {
		kind: "P2-summary-method-validation-only",
		executionRoot,
		method: METHOD,
		jobs: jobs(),
		files,
		runtimeSources: {},
		workerDigest: files["worker.mjs"],
	};
	put("freeze.json", freeze);
	const report = {
		freezeDigest: sha(readFileSync(resolve(synthetic, "freeze.json"))),
		complete: true,
		qualified: false,
		elapsedMs: 1000,
		jobs: [],
		decision: decide(Array(16).fill(1), Array(4).fill(1)),
	};
	for (const [i, job] of jobs().entries()) {
		const data = samples(job.control);
		const artifacts = {
			"config.json": {
				row: METHOD.row,
				control: job.control,
				output: resolve(executionRoot, job.id),
				scenarioPath: resolve(executionRoot, "P2-inputs.json"),
				copyModule: pathToFileURL(resolve(executionRoot, "worker-copy.mjs")).href,
			},
			"entry.mjs": `import {runRow} from ${JSON.stringify(pathToFileURL(resolve(executionRoot, "worker.mjs")).href)}; await runRow(${JSON.stringify(resolve(executionRoot, job.id, "config.json"))});\n`,
			"runtime.log": "synthetic log",
			"v8.log": "synthetic log",
			"samples.jsonl": data.map((s) => JSON.stringify(s)).join("\n") + "\n",
			"worker.json": { row: METHOD.row, recipe, control: job.control, pid: i + 100 },
			"preflight.json": { passed: true },
			"completion.json": { completed: true, samples: data.length },
		};
		const bound = {};
		for (const [name, value] of Object.entries(artifacts)) {
			put(`${job.id}/${name}`, value);
			bound[name] = sha(readFileSync(resolve(synthetic, job.id, name)));
		}
		report.jobs.push({
			...job,
			status: "completed",
			exitCode: 0,
			files: bound,
			summary: summarizeRepeat(METHOD.row, data, recipe, job.control),
		});
	}
	put("report.json", report);
	return report;
}
test("independent verifier checks all 67200 synthetic coordinates and rejects report forgery", () => {
	const originalReport = fakeEvidence();
	assert.deepEqual(verifyEvidence(synthetic), {
		validEvidence: true,
		rowVerdict: "passed",
		samples: 67200,
		processes: 20,
		qualified: false,
	});
	for (const mutate of [
		(r) => {
			r.decision.interval[1] = 0.9;
		},
		(r) => {
			r.decision.verdict = "rejected";
		},
		(r) => {
			r.jobs[2].summary.ratio = 0.9;
		},
		(r) => {
			r.jobs[2].summary.arms.candidate.batches[0].p95Ms = 0.9;
		},
		(r) => {
			r.jobs[2].summary.arms.plain.medianBatchP95Ms = 0.9;
		},
		(r) => {
			r.jobs.pop();
		},
		(r) => {
			r.elapsedMs = 900001;
		},
		(r) => {
			r.qualified = true;
		},
		(r) => {
			r.jobs[0].status = "not-run";
		},
	]) {
		const r = structuredClone(originalReport);
		mutate(r);
		put("report.json", r);
		assert.throws(() => verifyEvidence(synthetic));
	}
	put("report.json", originalReport);
	const configBytes = readFileSync(resolve(synthetic, "control-0/config.json"), "utf8");
	for (const key of ["scenarioPath", "copyModule", "output"]) {
		const config = JSON.parse(configBytes),
			r = structuredClone(originalReport);
		config[key] = "/wrong-target";
		put("control-0/config.json", config);
		r.jobs[0].files["config.json"] = sha(readFileSync(resolve(synthetic, "control-0/config.json")));
		put("report.json", r);
		assert.throws(() => verifyEvidence(synthetic), /binding/);
	}
	put("control-0/config.json", configBytes);
	const r = structuredClone(originalReport);
	put("control-0/entry.mjs", "import '/wrong-worker.mjs';");
	r.jobs[0].files["entry.mjs"] = sha(readFileSync(resolve(synthetic, "control-0/entry.mjs")));
	put("report.json", r);
	assert.throws(() => verifyEvidence(synthetic), /entry binding/);
	put("report.json", originalReport);
	put("worker-copy.mjs", "different bytes");
	assert.throws(() => verifyEvidence(synthetic), /identical worker bytes/);
});
test("real P1 cold worker and identical-reference control complete with original clocks and counts", () => {
	const input = execFileSync(
		"tar",
		[
			"-xOf",
			"packages/ts/qualification/causal-occurrence/preset-reference-v1/evidence.tar.gz",
			"./freeze-qualified/P1-inputs.json",
		],
		{ maxBuffer: 16 * 1024 * 1024 },
	);
	const inputPath = resolve(dir, "P1.json");
	writeFileSync(inputPath, input);
	for (const control of [false, true]) {
		const out = resolve(dir, control ? "real-control" : "real-primary");
		mkdirSync(out);
		const row = { id: "cold-P1-off", group: "cold", profile: "P1", mode: "off" };
		const config = resolve(out, "config.json");
		writeFileSync(
			config,
			JSON.stringify({
				row,
				scenarioPath: inputPath,
				output: out,
				control,
				copyModule: pathToFileURL(copyPath).href,
			}),
		);
		const entry = resolve(out, "entry.mjs");
		writeFileSync(
			entry,
			`import {runRow} from ${JSON.stringify(pathToFileURL(workerPath).href)}; await runRow(${JSON.stringify(config)});`,
		);
		execFileSync(process.execPath, [entry], { timeout: 60000 });
		const data = readFileSync(resolve(out, "samples.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((s) => JSON.parse(s));
		assert.equal(summarizeRepeat(row, data, recipe, control).sampleCount, control ? 2400 : 3600);
		assert.equal(JSON.parse(readFileSync(resolve(out, "preflight.json"))).passed, true);
	}
});

test("actual control candidate slot invokes the copy module's reference factory", async () => {
	const out = resolve(dir, "control-routing-negative");
	mkdirSync(out);
	const input = resolve(out, "input.json");
	writeFileSync(
		input,
		execFileSync("tar", [
			"-xOf",
			"packages/ts/qualification/causal-occurrence/preset-reference-v1/evidence.tar.gz",
			"./freeze-qualified/P1-inputs.json",
		]),
	);
	const spy = resolve(out, "spy.mjs");
	writeFileSync(
		spy,
		`export {preflight} from ${JSON.stringify(pathToFileURL(workerPath).href)}; export function measurementArm(arm) { if (arm !== "reference") throw Error("WRONG_CONTROL_ARM"); throw Error("CONTROL_COPY_REFERENCE_SELECTED"); }`,
	);
	const config = resolve(out, "config.json");
	writeFileSync(
		config,
		JSON.stringify({
			row: { id: "cold-P1-off", group: "cold", profile: "P1", mode: "off" },
			output: out,
			scenarioPath: input,
			control: true,
			copyModule: pathToFileURL(spy).href,
		}),
	);
	// This deliberately non-identical spy is a unit test of dispatch wiring, never a
	// valid control artifact. The evidence verifier separately rejects unequal bytes.
	await assert.rejects(() => worker.runRow(config), /CONTROL_COPY_REFERENCE_SELECTED/);
});

test("actual child-management path kills a hung child and retains partial status on timeout", () => {
	const runner = readFileSync("scripts/compare-spending-preset-repetition.mjs", "utf8");
	const begin = '\t\tconst log = createWriteStream(resolve(dir, "runtime.log"));';
	const end = "\t\tassert.ok(!timedOut && !logError && outcome.code === 0,";
	assert.equal(runner.split(begin).length, 2);
	assert.equal(runner.split(end).length, 2);
	// Execute the exact production child-management block with a hung test entry.
	// Only this fixture's deadline is shortened; no measurement worker is loaded.
	const block = runner.slice(runner.indexOf(begin), runner.indexOf(end));
	const out = resolve(dir, "timeout-negative");
	mkdirSync(out);
	writeFileSync(
		resolve(out, "entry.mjs"),
		"await new Promise(() => { setInterval(() => {}, 1000); });",
	);
	const fixture = resolve(out, "supervisor.mjs");
	writeFileSync(
		fixture,
		`
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createWriteStream, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
const dir = ${JSON.stringify(out)};
const METHOD = {timeoutMs: 100}, started = performance.now(), ordinal = 0;
const report = {jobs: [{id: 'hung', status: 'starting'}, {id: 'later', status: 'not-run'}]};
const put = (name, value) => writeFileSync(resolve(dir, name), JSON.stringify(value));
${block}
assert.equal(timedOut, true);
assert.equal(outcome.signal, 'SIGKILL');
assert.equal(report.jobs[0].status, 'invalid');
assert.equal(report.jobs[1].status, 'not-run');
assert.ok(Number.isInteger(report.jobs[0].childPid));
assert.throws(() => process.kill(report.jobs[0].childPid, 0), {code: 'ESRCH'});
assert.equal(process.listenerCount('SIGINT'), 0);
assert.equal(process.listenerCount('SIGTERM'), 0);
`,
	);
	execFileSync(process.execPath, [fixture], { timeout: 5000 });
	const partial = JSON.parse(readFileSync(resolve(out, "report.json")));
	assert.equal(partial.jobs[0].timedOut, true);
	assert.equal(partial.jobs[1].status, "not-run");
});
