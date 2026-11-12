/** New formal private consumer matrix. Never rewrites CSP11/publication/reference evidence. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { correlate, summarize } from "./spending-preset-performance-report.mjs";

const output = resolve(process.argv[2] ?? ""),
	prior = resolve(process.argv[3] ?? "");
assert.ok(
	process.argv[2] && process.argv[3] && !existsSync(output),
	"usage: node scripts/compare-spending-preset.mjs FRESH_OUTPUT PRIOR_FREEZE",
);
mkdirSync(output, { recursive: true });
const hash = (data) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
const put = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const receiptPath = "packages/ts/qualification/causal-occurrence/preset-reference-v1/receipt.json";
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
assert.equal(receipt.referenceSemanticGate.passed, true);
for (const [path, digest] of Object.entries(receipt.sourceBindings))
	assert.equal(hash(readFileSync(path)), digest, `prior semantic binding drift: ${path}`);
const archive = "packages/ts/qualification/causal-occurrence/preset-reference-v1/evidence.tar.gz";
assert.equal(hash(readFileSync(archive)), receipt.rawEvidence.digest);
const indexBytes = readFileSync(
	"packages/ts/qualification/causal-occurrence/preset-reference-v1/artifact-index.json",
);
assert.equal(hash(indexBytes), receipt.rawEvidence.indexDigest, "prior artifact index drift");
const index = JSON.parse(indexBytes.toString());
// Validate the prior fixture bytes against its committed artifact index, not a mutable local cache.
const artifacts = index.files;
const inputBindings = {};
for (const id of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
	const name = `${id}-inputs.json`,
		bytes = readFileSync(resolve(prior, name));
	const digest = artifacts[`freeze-qualified/${name}`];
	assert.ok(digest, `indexed fixture ${name}`);
	assert.equal(hash(bytes), digest);
	writeFileSync(resolve(output, name), bytes);
	inputBindings[name] = hash(bytes);
}
const bundle = await build({
	entryPoints: ["scripts/fixtures/spending-preset-performance-worker.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
});
writeFileSync(resolve(output, "worker.mjs"), bundle.outputFiles[0].contents);
put(resolve(output, "metafile.json"), bundle.metafile);
const sourceBindings = {};
for (const path of [
	...Object.keys(bundle.metafile.inputs),
	"scripts/compare-spending-preset.mjs",
	"scripts/spending-preset-performance-report.mjs",
	"scripts/causal-event-correlation.mjs",
	receiptPath,
	"pnpm-lock.yaml",
])
	sourceBindings[path] = hash(readFileSync(path));
const { RECIPE, matrixRows } = await import(pathToFileURL(resolve(output, "worker.mjs")).href);
const rows = matrixRows();
assert.equal(rows.length, 84);
const frozen = {
	recipe: RECIPE,
	rows,
	inputBindings,
	sourceBindings,
	bundleDigest: hash(bundle.outputFiles[0].contents),
	priorSemanticReceipt: hash(readFileSync(receiptPath)),
	baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	machine: {
		node: process.version,
		platform: os.platform(),
		arch: os.arch(),
		release: os.release(),
		cpus: os.cpus(),
		memory: os.totalmem(),
	},
	scope: "private offline consumer qualification; no effect execution",
	recoveryInterpretation:
		"20 actual detach/reconnect cycles on one retained-root instance per arm; informational only; 100/300 and AB/BA/AB apply to cold/steady",
	plainBoundary:
		"same passive lifetime obligations; synchronous push included; snapshot formatting excluded (absolute-only, not a Graph denominator)",
	scheduleBoundary:
		"newness measured before entire arrival wave; double DATA second copy is replay; P6 new action includes all late verification frames",
};
put(resolve(output, "freeze.json"), frozen);
const report = {
	qualified: false,
	status: "running",
	rows: rows.map((row) => ({ ...row, status: "not-run" })),
	freezeDigest: hash(readFileSync(resolve(output, "freeze.json"))),
};
put(resolve(output, "report.json"), report);
const attemptStart = Date.now();
for (let i = 0; i < rows.length; i++) {
	const row = rows[i],
		dir = resolve(output, row.id);
	mkdirSync(dir);
	const configPath = resolve(dir, "config.json");
	put(configPath, {
		row,
		scenarioPath: resolve(output, `${row.profile}-inputs.json`),
		output: dir,
	});
	const entry = resolve(dir, "entry.mjs");
	writeFileSync(
		entry,
		`import {runRow} from ${JSON.stringify(pathToFileURL(resolve(output, "worker.mjs")).href)}; await runRow(${JSON.stringify(configPath)});\n`,
	);
	const remaining = RECIPE.totalTimeoutMs - (Date.now() - attemptStart);
	if (remaining <= 0) {
		report.status = "total-timeout";
		break;
	}
	console.log("PRESET_PERFORMANCE_ROW_START", row.id);
	const log = createWriteStream(resolve(dir, "runtime.log"));
	const child = spawn(
		process.execPath,
		[
			"--trace-gc",
			"--trace-deopt",
			"--log-deopt",
			"--no-logfile-per-isolate",
			`--logfile=${resolve(dir, "v8.log")}`,
			entry,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let logError;
	log.on("error", (error) => {
		logError = String(error);
		child.kill("SIGKILL");
	});
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	let timeout = false;
	const timer = setTimeout(
		() => {
			timeout = true;
			child.kill("SIGKILL");
		},
		Math.min(remaining, RECIPE.childTimeoutMs),
	);
	const outcome = await new Promise((resolveDone) => {
		child.once("error", (error) => resolveDone({ error: String(error) }));
		child.once("close", (code, signal) => resolveDone({ code, signal }));
	});
	clearTimeout(timer);
	if (!log.destroyed)
		await new Promise((r) => {
			log.once("error", r);
			log.end(r);
		});
	let result = {
		...row,
		status: timeout ? "timeout" : "failed",
		process: outcome,
		...(logError ? { logError } : {}),
	};
	if (!timeout && !logError && outcome.code === 0) {
		try {
			assert.equal(
				JSON.parse(readFileSync(resolve(dir, "completion.json"), "utf8")).completed,
				true,
			);
			const samples = readFileSync(resolve(dir, "samples.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map((s) => JSON.parse(s));
			const summary = summarize(row, samples, RECIPE);
			put(resolve(dir, "summary.json"), summary);
			const meta = JSON.parse(readFileSync(resolve(dir, "worker.json"), "utf8"));
			const v8File = readdirSync(dir).find((n) => n.endsWith("v8.log"));
			assert.ok(v8File, "V8 timestamped deopt log required");
			put(
				resolve(dir, "correlation.json"),
				correlate(
					samples,
					readFileSync(resolve(dir, "runtime.log"), "utf8"),
					readFileSync(resolve(dir, v8File), "utf8"),
				),
			);
			result = {
				...result,
				status: summary.passed ? "passed" : "rejected",
				ratio: summary.ratio,
				limit: summary.limit,
			};
		} catch (error) {
			result.error = String(error);
		}
	}
	report.rows[i] = result;
	put(resolve(output, "report.json"), report);
	console.log("PRESET_PERFORMANCE_ROW_RESULT", JSON.stringify(result));
	if (result.status !== "passed" && RECIPE.stopAfterFailedRow) {
		report.status = "stopped-after-failed-row";
		break;
	}
}
if (report.rows.every((r) => r.status === "passed")) {
	report.qualified = true;
	report.status = "passed";
}
report.elapsedMs = Date.now() - attemptStart;
put(resolve(output, "report.json"), report);
console.log("PRESET_PERFORMANCE_DONE", report.status);
process.exitCode = report.qualified ? 0 : 1;
