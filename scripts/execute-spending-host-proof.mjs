/** D171 separately granted local proof execution. Importing this CLI is not an execution grant. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (path) => hash(readFileSync(path));
const load = (path) => JSON.parse(readFileSync(path, "utf8"));
const check = (path, expected) =>
	assert.equal(digest(path), expected.replace(/^sha256:/, ""), path);
assert.equal(
	process.argv.length,
	4,
	"Usage: node scripts/execute-spending-host-proof.mjs <manifest> <explicit-approval.json>",
);
const manifestPath = resolve(process.argv[2]),
	approvalPath = resolve(process.argv[3]);
const manifest = load(manifestPath),
	approval = load(approvalPath);
assert.equal(approval.action, "execute-spending-host-proof-once");
assert.equal(approval.approved, true);
assert.equal(approval.manifestSha256, `sha256:${digest(manifestPath)}`);
assert.ok(
	typeof approval.userGrant === "string" && approval.userGrant.trim(),
	"retain exact explicit human grant",
);
assert.equal(manifest.authorized, false, "preparation never confers authority");
assert.equal(manifest.executionPerformed, false);
assert.equal(manifest.context.node, process.version);
assert.equal(manifest.context.platform, process.platform);
assert.equal(manifest.context.arch, process.arch);
check(process.execPath, manifest.context.nodeExecutableSha256);
check(join(root, "pnpm-lock.yaml"), manifest.context.lockSha256);
check(fileURLToPath(import.meta.url), manifest.executor.sha256);
const preparation = load(resolve(root, manifest.preparationSummaryPath));
assert.equal(preparation.passed, true);
assert.ok(manifest.cases.length > 0 && manifest.cases.length <= 128);
const paths = new Set(),
	ids = new Set();
assert.ok(isAbsolute(manifest.freshDirectory));
assert.equal(existsSync(manifest.freshDirectory), false, "one-shot fresh directory already exists");
assert.ok(existsSync(dirname(manifest.freshDirectory)), "reviewed parent must already exist");
const executionDirectory = join(dirname(manifestPath), "real-execution");
assert.equal(
	existsSync(executionDirectory),
	false,
	"execution receipt already exists; no automatic retry",
);
let calls = 0,
	bytes = 0,
	wall = 0;
for (const c of manifest.cases) {
	assert.equal(dirname(c.path), manifest.freshDirectory);
	assert.ok(!paths.has(c.path) && !ids.has(c.id));
	paths.add(c.path);
	ids.add(c.id);
	assert.equal(c.binding.destinationRef.kind, "local-inbox");
	assert.equal(c.binding.destinationRef.id, c.path);
	assert.ok(c.arm === "graph" || c.arm === "plain");
	assert.ok(Number.isSafeInteger(c.maximumCalls) && c.maximumCalls > 0 && c.maximumCalls <= 64);
	assert.equal(c.maximumBytes, c.maximumCalls * 4096);
	assert.ok(c.maximumWallTimeMs > 0 && c.maximumWallTimeMs <= 30000);
	calls += c.maximumCalls;
	bytes += c.maximumBytes;
	wall += c.maximumWallTimeMs;
	check(resolve(root, c.bundle), c.bundleSha256);
	const source = load(resolve(root, c.sourceBindingPath));
	assert.equal(source.sourceDigest, c.binding.sourceDigest);
	assert.equal(source.runtimeDigest, c.binding.runtimeDigest);
	for (const input of source.inputs) check(resolve(root, input.path), input.rawSha256);
}
assert.equal(calls, manifest.maximumCalls);
assert.equal(bytes, manifest.maximumBytes);
assert.equal(wall, manifest.maximumWallTimeMs);
check(resolve(root, manifest.verifier.bundle), manifest.verifier.sha256);
check(resolve(root, manifest.scenarios.bundle), manifest.scenarios.sha256);
const { verifyProofTrace } = await import(
	pathToFileURL(resolve(root, manifest.verifier.bundle)).href
);
const { proofScenarios } = await import(
	pathToFileURL(resolve(root, manifest.scenarios.bundle)).href
);
// Validate every frozen schedule before preparing any destination.
const schedules = manifest.cases.map((c) => {
	const scenario = proofScenarios(c.binding).find((s) => s.id === c.caseId);
	assert.ok(scenario);
	assert.equal(hash(JSON.stringify(scenario)), c.scenarioSha256);
	return scenario;
});
mkdirSync(executionDirectory, { mode: 0o700 });
mkdirSync(manifest.freshDirectory, { mode: 0o700 });
const receipt = {
	manifestSha256: `sha256:${digest(manifestPath)}`,
	approvalSha256: `sha256:${digest(approvalPath)}`,
	startedAt: new Date().toISOString(),
	mode: manifest.mode,
	passed: false,
	runs: [],
	scope:
		"Fault-injected local handle proof. Readback proves observed bytes, not fsync/crash durability; no performance qualification or B121 completion.",
};
const save = () =>
	writeFileSync(join(executionDirectory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
save();
for (const [i, c] of manifest.cases.entries()) {
	const config = { arm: c.arm, caseId: c.caseId, binding: c.binding, path: c.path, mode: "local" };
	const child = spawnSync(process.execPath, [resolve(root, c.bundle), JSON.stringify(config)], {
		cwd: root,
		encoding: "utf8",
		timeout: c.maximumWallTimeMs,
		maxBuffer: 16 * 1024 * 1024,
	});
	writeFileSync(join(executionDirectory, `${c.id}.stdout.log`), child.stdout ?? "");
	writeFileSync(join(executionDirectory, `${c.id}.stderr.log`), child.stderr ?? "");
	let report, verdict, observedReadback;
	let readback;
	try {
		readback = readFileSync(c.path);
		observedReadback = { bytes: readback.length, sha256: `sha256:${hash(readback)}`, path: c.path };
	} catch (error) {
		observedReadback = { path: c.path, error: String(error) };
	}
	try {
		report = JSON.parse(child.stdout);
		assert.equal(report.mode, "prepared-local-file-proof");
		assert.ok(readback, "independent readback unavailable");
		assert.ok(readback.length <= c.maximumBytes);
		assert.ok(report.trace.attemptedPayloads.length <= c.maximumCalls);
		assert.ok(report.transportAttempts.length <= c.maximumCalls);
		verdict = verifyProofTrace(
			schedules[i].evaluations,
			c.binding,
			schedules[i].expected,
			report.trace,
			{ before: new Uint8Array(), after: readback },
		);
	} catch (error) {
		verdict = { passed: false, errors: [String(error)] };
	}
	receipt.runs.push({
		id: c.id,
		status: child.status,
		signal: child.signal,
		error: child.error?.message,
		verdict,
		report,
		observedReadback,
		passed: child.status === 0 && verdict.passed,
	});
	save();
	if (!receipt.runs.at(-1).passed) break; // retain every observed byte; never retry or clean away failure
}
receipt.passed =
	receipt.runs.length === manifest.cases.length && receipt.runs.every((r) => r.passed);
receipt.finishedAt = new Date().toISOString();
save();
console.log(
	JSON.stringify({
		receipt: join(executionDirectory, "receipt.json"),
		passed: receipt.passed,
		runs: receipt.runs.length,
	}),
);
if (!receipt.passed) process.exitCode = 1;
