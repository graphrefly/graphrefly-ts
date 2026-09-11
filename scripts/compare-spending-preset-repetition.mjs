/** D168: ONE bounded P2/summary method trial. No full-matrix dispatch entry point. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { correlate } from "./spending-preset-performance-report.mjs";
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

const [outputArg, qualificationArg, approvalArg] = process.argv.slice(2);
assert.ok(
	outputArg && qualificationArg && approvalArg && process.argv.length === 5,
	"usage: node compare-spending-preset-repetition.mjs FRESH_OUTPUT CURRENT_REFERENCE_RESULTS APPROVAL",
);
const output = resolve(outputArg);
assert.ok(!existsSync(output), "fresh output required; no resume/retry");
mkdirSync(output, { recursive: true });
const started = performance.now(),
	wallStarted = Date.now();
const put = (name, value) =>
	writeFileSync(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`);
const json = (name) => JSON.parse(readFileSync(resolve(output, name), "utf8"));
const report = {
	kind: "P2-summary-method-validation-only",
	complete: false,
	qualified: false,
	status: "preparing",
	jobs: jobs().map((job) => ({ ...job, status: "not-run" })),
	elapsedMs: 0,
};
put("report.json", report);
let signalReceived;
const onInterrupt = () => {
	signalReceived = "SIGINT";
};
const onTerminate = () => {
	signalReceived = "SIGTERM";
};
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
try {
	const approvalBytes = readFileSync(approvalArg),
		approval = JSON.parse(approvalBytes);
	assert.deepEqual(approval.measurementLimits, {
		row: "cold-P2-summary",
		processes: 20,
		samples: 67200,
		elapsedMs: 900000,
		retries: 0,
	});
	assert.equal(sha(readFileSync(approval.design)), approval.designDigest, "approved method digest");
	const qualificationBytes = readFileSync(qualificationArg),
		qualification = JSON.parse(qualificationBytes);
	checkQualification(qualification);
	const qualificationRunner = "scripts/qualify-spending-preset-reference.mjs";
	const qualificationTest = "packages/ts/src/__tests__/spending-alerts-preset-reference.test.ts";
	assert.equal(
		qualification.recipeDigest,
		sha(readFileSync(qualificationRunner)),
		"qualification runner binding",
	);
	assert.equal(
		qualification.testDigest,
		sha(readFileSync(qualificationTest)),
		"qualification test binding",
	);
	const oldReceiptPath =
		"packages/ts/qualification/causal-occurrence/preset-reference-v1/receipt.json";
	const old = JSON.parse(readFileSync(oldReceiptPath, "utf8"));
	const archive = "packages/ts/qualification/causal-occurrence/preset-reference-v1/evidence.tar.gz";
	const indexPath =
		"packages/ts/qualification/causal-occurrence/preset-reference-v1/artifact-index.json";
	assert.equal(sha(readFileSync(archive)), old.rawEvidence.digest);
	assert.equal(sha(readFileSync(indexPath)), old.rawEvidence.indexDigest);
	const fixture = execFileSync("tar", ["-xOf", archive, "./freeze-qualified/P2-inputs.json"], {
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(
		sha(fixture),
		JSON.parse(readFileSync(indexPath, "utf8")).files["freeze-qualified/P2-inputs.json"],
	);
	writeFileSync(resolve(output, "P2-inputs.json"), fixture);
	writeFileSync(resolve(output, "approval.json"), approvalBytes);
	writeFileSync(resolve(output, "reference-qualification.json"), qualificationBytes);
	const workerSource = "scripts/fixtures/spending-preset-performance-worker.ts";
	const adapted = adaptWorker(readFileSync(workerSource, "utf8"));
	writeFileSync(resolve(output, "adapted-worker.ts"), adapted);
	const built = await build({
		entryPoints: [workerSource],
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		metafile: true,
		plugins: [
			{
				name: "d168-control-adapter",
				setup(b) {
					b.onLoad({ filter: /spending-preset-performance-worker\.ts$/ }, () => ({
						contents: adapted,
						loader: "ts",
						resolveDir: resolve("scripts/fixtures"),
					}));
				},
			},
		],
	});
	writeFileSync(resolve(output, "worker.mjs"), built.outputFiles[0].contents);
	writeFileSync(resolve(output, "worker-copy.mjs"), built.outputFiles[0].contents);
	const files = {},
		runtimeSources = {},
		currentSources = {};
	for (const file of Object.keys(built.metafile.inputs)) {
		const digest = sha(readFileSync(file));
		assert.equal(qualification.copiedInputs[file], digest, `fresh semantic closure: ${file}`);
		runtimeSources[file] = digest;
	}
	for (const file of new Set([
		...Object.keys(runtimeSources),
		approval.design,
		qualificationRunner,
		qualificationTest,
		"scripts/compare-spending-preset-repetition.mjs",
		"scripts/spending-preset-repetition.mjs",
		"scripts/verify-spending-preset-repetition.mjs",
		"scripts/spending-preset-performance-report.mjs",
		"pnpm-lock.yaml",
	])) {
		const bytes = readFileSync(file),
			target = `source/${file}`;
		mkdirSync(dirname(resolve(output, target)), { recursive: true });
		writeFileSync(resolve(output, target), bytes);
		currentSources[file] = sha(bytes);
		files[target] = sha(bytes);
	}
	for (const name of [
		"P2-inputs.json",
		"approval.json",
		"reference-qualification.json",
		"adapted-worker.ts",
		"worker.mjs",
		"worker-copy.mjs",
	])
		files[name] = sha(readFileSync(resolve(output, name)));
	const freeze = {
		kind: report.kind,
		executionRoot: output,
		method: METHOD,
		jobs: jobs(),
		files,
		runtimeSources,
		workerDigest: files["worker.mjs"],
		baseline: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
		machine: {
			node: process.version,
			platform: os.platform(),
			arch: os.arch(),
			cpus: os.cpus(),
			memory: os.totalmem(),
			power: execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }),
		},
		startedAt: new Date(wallStarted).toISOString(),
		controlMeaning:
			"candidate slot -> reference from byte-identical copy module; reference slot -> original reference; no plain control",
	};
	put("freeze.json", freeze);
	report.freezeDigest = sha(readFileSync(resolve(output, "freeze.json")));
	report.status = "running";
	put("report.json", report);
	const checkCurrent = () => {
		assert.ok(!signalReceived, `interrupted: ${signalReceived}`);
		for (const [file, digest] of Object.entries(currentSources))
			assert.equal(sha(readFileSync(file)), digest, `source drift during attempt: ${file}`);
		assert.equal(process.version, freeze.machine.node);
		assert.equal(
			execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }).split("\n")[0],
			freeze.machine.power.split("\n")[0],
			"power-source changed",
		);
		assert.ok(
			Math.abs(Date.now() - wallStarted - (performance.now() - started)) < 1000,
			"clock/suspend discontinuity",
		);
	};
	for (const [ordinal, job] of jobs().entries()) {
		checkCurrent();
		const remaining = METHOD.timeoutMs - (performance.now() - started);
		assert.ok(remaining > 0, "row-group timeout");
		const dir = resolve(output, job.id);
		mkdirSync(dir);
		const config = {
			row: METHOD.row,
			output: dir,
			scenarioPath: resolve(output, "P2-inputs.json"),
			control: job.control,
			copyModule: pathToFileURL(resolve(output, "worker-copy.mjs")).href,
		};
		put(`${job.id}/config.json`, config);
		writeFileSync(
			resolve(dir, "entry.mjs"),
			`import {runRow} from ${JSON.stringify(pathToFileURL(resolve(output, "worker.mjs")).href)}; await runRow(${JSON.stringify(resolve(dir, "config.json"))});\n`,
		);
		report.jobs[ordinal] = { ...job, status: "starting", startedAt: new Date().toISOString() };
		put("report.json", report);
		console.log("REPETITION_JOB_START", job.id);
		const log = createWriteStream(resolve(dir, "runtime.log"));
		const child = spawn(
			process.execPath,
			[
				"--trace-gc",
				"--trace-deopt",
				"--log-deopt",
				"--no-logfile-per-isolate",
				`--logfile=${resolve(dir, "v8.log")}`,
				resolve(dir, "entry.mjs"),
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let timedOut = false,
			logError;
		const kill = () => child.kill("SIGKILL");
		process.on("SIGINT", kill);
		process.on("SIGTERM", kill);
		log.on("error", (error) => {
			logError = String(error);
			kill();
		});
		child.stdout.pipe(log, { end: false });
		child.stderr.pipe(log, { end: false });
		const timer = setTimeout(
			() => {
				timedOut = true;
				kill();
			},
			Math.max(1, METHOD.timeoutMs - (performance.now() - started)),
		);
		const outcome = await new Promise((done) => {
			child.once("error", (error) => done({ error: String(error) }));
			child.once("close", (code, signal) => done({ code, signal }));
			try {
				report.jobs[ordinal] = { ...report.jobs[ordinal], status: "running", childPid: child.pid };
				put("report.json", report);
			} catch (error) {
				logError = String(error);
				kill();
			}
		});
		clearTimeout(timer);
		process.off("SIGINT", kill);
		process.off("SIGTERM", kill);
		if (!log.destroyed)
			await new Promise((done) => {
				log.once("error", done);
				log.end(done);
			});
		report.jobs[ordinal] = {
			...report.jobs[ordinal],
			status: "invalid",
			exitCode: outcome.code,
			outcome,
			timedOut,
			...(logError ? { logError } : {}),
		};
		put("report.json", report);
		assert.ok(!timedOut && !logError && outcome.code === 0, `child failed: ${job.id}`);
		checkCurrent();
		const samples = readFileSync(resolve(dir, "samples.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((s) => JSON.parse(s));
		const meta = json(`${job.id}/worker.json`);
		assert.deepEqual(json(`${job.id}/completion.json`), {
			completed: true,
			samples: job.control ? 2400 : 3600,
		});
		const summary = summarizeRepeat(METHOD.row, samples, meta.recipe, job.control);
		put(
			`${job.id}/correlation.json`,
			correlate(
				samples,
				readFileSync(resolve(dir, "runtime.log"), "utf8"),
				readFileSync(resolve(dir, "v8.log"), "utf8"),
				meta.uptimeOffsetMs,
			),
		);
		const bound = Object.fromEntries(
			readdirSync(dir).map((name) => [name, sha(readFileSync(resolve(dir, name)))]),
		);
		report.jobs[ordinal] = {
			...report.jobs[ordinal],
			status: "completed",
			exitCode: 0,
			files: bound,
			summary,
		};
		put("report.json", report);
		console.log("REPETITION_JOB_DONE", job.id);
	}
	checkCurrent();
	report.elapsedMs = performance.now() - started;
	assert.ok(report.elapsedMs <= METHOD.timeoutMs, "row-group timeout");
	report.decision = decide(
		report.jobs.filter((j) => !j.control).map((j) => j.summary.ratio),
		report.jobs.filter((j) => j.control).map((j) => j.summary.ratio),
	);
	report.complete = true;
	report.status = "completed";
	put("report.json", report);
	put("verification.json", verifyEvidence(output));
	console.log("REPETITION_DONE", report.decision.verdict, "method-validation-only");
} catch (error) {
	report.complete = false;
	report.status = "invalid";
	report.elapsedMs = performance.now() - started;
	report.error = String(error);
	put("report.json", report);
	console.log("REPETITION_DONE invalid", report.error);
	process.exitCode = 1;
} finally {
	process.off("SIGINT", onInterrupt);
	process.off("SIGTERM", onTerminate);
}
