/** One explicitly approved diagnostic collector. No retry/resume or consumer imports. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { correlateTrace, hash } from "./causal-event-correlation.mjs";

const [outputArg, approvalPath] = process.argv.slice(2);
assert.ok(outputArg && approvalPath && process.argv.length === 4, "FRESH_OUTPUT APPROVAL required");
assert.equal(process.version, "v24.18.0");
assert.equal(process.versions.v8, "13.6.233.17-node.50");
const output = resolve(outputArg),
	approval = JSON.parse(readFileSync(approvalPath));
assert.deepEqual(approval.limits, {
	fixtureProcesses: 1,
	timeoutMs: 30000,
	retries: 0,
	consumerMeasurements: 0,
});
assert.equal(approval.work, "graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS");
assert.equal(approval.action, "private-event-clock-repair-v1");
assert.equal(hash(readFileSync(approval.design)), approval.designDigest);
assert.ok(!existsSync(output), "fresh output required; never resume");
mkdirSync(output, { recursive: true });
const put = (name, value) =>
	writeFileSync(resolve(output, name), JSON.stringify(value, null, 2) + "\n");
copyFileSync(approvalPath, resolve(output, "approval.json"));
copyFileSync(
	fileURLToPath(new URL("./fixtures/causal-event-clock.mjs", import.meta.url)),
	resolve(output, "fixture.mjs"),
);
const run = randomUUID();
const args = [
	"--trace-events-enabled",
	"--trace-event-categories=v8,node.console",
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Node expands this literal token.
	`--trace-event-file-pattern=${resolve(output, "trace-${rotation}.json")}`,
	"--expose-gc",
	"--allow-natives-syntax",
	resolve(output, "fixture.mjs"),
	resolve(output, "evidence.json"),
	run,
];
const manifest = {
	identity: {
		run,
		pid: null,
		node: process.version,
		v8: process.versions.v8,
		sourceDigest: hash(readFileSync(resolve(output, "fixture.mjs"))),
	},
	args,
	execPath: process.execPath,
	approvalDigest: hash(readFileSync(approvalPath)),
	exitCode: null,
	timedOut: false,
	traceFiles: [],
};
put("manifest.json", manifest);
const stdout = openSync(resolve(output, "stdout.log"), "wx"),
	stderr = openSync(resolve(output, "stderr.log"), "wx");
let child, timer;
const stop = () => child?.kill("SIGKILL");
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
let completion;
try {
	child = spawn(process.execPath, args, {
		cwd: output,
		stdio: ["ignore", stdout, stderr],
		env: { NODE_OPTIONS: "" },
	});
	completion = new Promise((done) => {
		child.once("error", (error) => {
			manifest.error = String(error);
		});
		child.once("close", (code, signal) => done({ code, signal }));
	});
	timer = setTimeout(() => {
		manifest.timedOut = true;
		stop();
	}, 30000);
	try {
		manifest.identity.pid = child.pid ?? null;
		put("manifest.json", manifest);
	} catch (error) {
		manifest.error = String(error);
		stop();
	}
	const outcome = await completion;
	manifest.exitCode = outcome.code;
	manifest.signal = outcome.signal;
} finally {
	if (child && child.exitCode === null && child.signalCode === null) {
		stop();
		await completion;
	}
	clearTimeout(timer);
	process.removeListener("SIGINT", stop);
	process.removeListener("SIGTERM", stop);
	closeSync(stdout);
	closeSync(stderr);
	manifest.traceFiles = readdirSync(output)
		.filter((n) => /^trace-.*\.json$/.test(n))
		.sort();
	if (manifest.traceFiles.length === 1)
		manifest.traceDigest = hash(readFileSync(resolve(output, manifest.traceFiles[0])));
	if (existsSync(resolve(output, "evidence.json")))
		manifest.evidenceDigest = hash(readFileSync(resolve(output, "evidence.json")));
	put("manifest.json", manifest);
}
const correlation =
	manifest.traceFiles.length === 1 && manifest.evidenceDigest
		? correlateTrace(
				readFileSync(resolve(output, manifest.traceFiles[0]), "utf8"),
				readFileSync(resolve(output, "evidence.json"), "utf8"),
				manifest,
			)
		: { status: "unknown", reason: "missing capture", samples: null };
put("correlation.json", correlation);
console.log("CLOCK_CAPTURE_DONE", correlation.status);
if (correlation.status !== "calibrated") process.exitCode = 1;
