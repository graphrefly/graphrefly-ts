/** Read-only D171 artifact replay: never constructs a consumer or obtains a writer. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const path = (p) => resolve(root, p);
const load = (p) => JSON.parse(readFileSync(path(p), "utf8"));
const digest = (p) =>
	`sha256:${createHash("sha256")
		.update(readFileSync(path(p)))
		.digest("hex")}`;
const verifyHash = (p, expected) =>
	assert.equal(digest(p), expected.startsWith("sha256:") ? expected : `sha256:${expected}`, p);
const prep = load("docs/design/causal-host-proof-preparation/receipt.json");
const manifestPath = prep.executionManifest.path;
verifyHash(manifestPath, prep.executionManifest.digest);
const manifest = load(manifestPath);
const approvalPath = "docs/design/causal-host-proof-execution/approval.json";
const approval = load(approvalPath);
assert.equal(approval.manifestSha256, digest(manifestPath));
assert.equal(approval.approved, true);
assert.equal(approval.action, "execute-spending-host-proof-once");
const receiptPath = join(dirname(manifestPath), "real-execution/receipt.json");
const receipt = load(receiptPath);
assert.equal(receipt.manifestSha256, digest(manifestPath));
assert.equal(receipt.approvalSha256, digest(approvalPath));
assert.equal(receipt.passed, true);
assert.equal(receipt.runs.length, manifest.cases.length);
verifyHash(manifest.executor.path, manifest.executor.sha256);
verifyHash("pnpm-lock.yaml", manifest.context.lockSha256);
verifyHash(process.execPath, manifest.context.nodeExecutableSha256);
verifyHash(manifest.verifier.bundle, manifest.verifier.sha256);
verifyHash(manifest.scenarios.bundle, manifest.scenarios.sha256);
const { verifyProofTrace } = await import(pathToFileURL(path(manifest.verifier.bundle)).href);
const { proofScenarios } = await import(pathToFileURL(path(manifest.scenarios.bundle)).href);
const files = readdirSync(manifest.freshDirectory).sort();
assert.deepEqual(files, manifest.cases.map((c) => c.path.split("/").at(-1)).sort());
const sources = new Set(),
	results = [],
	topologies = [],
	pairs = new Map();
let hostRequests = 0,
	underlyingWrites = 0,
	readbackBytes = 0;
for (const [index, c] of manifest.cases.entries()) {
	const run = receipt.runs[index];
	assert.equal(run.id, c.id);
	assert.equal(run.status, 0);
	assert.equal(run.passed, true);
	assert.equal(run.report.mode, "prepared-local-file-proof");
	verifyHash(c.bundle, c.bundleSha256);
	const source = load(c.sourceBindingPath);
	assert.equal(source.sourceDigest, c.binding.sourceDigest);
	assert.equal(source.runtimeDigest, c.binding.runtimeDigest);
	for (const input of source.inputs) {
		verifyHash(input.path, input.rawSha256);
		sources.add(input.path);
	}
	const stat = lstatSync(c.path);
	assert.ok(stat.isFile() && !stat.isSymbolicLink());
	assert.equal(stat.mode & 0o777, 0o600);
	const bytes = readFileSync(c.path);
	assert.equal(bytes.length, run.observedReadback.bytes);
	verifyHash(c.path, run.observedReadback.sha256);
	const scenario = proofScenarios(c.binding).find((s) => s.id === c.caseId);
	assert.ok(scenario);
	assert.equal(
		createHash("sha256").update(JSON.stringify(scenario)).digest("hex"),
		c.scenarioSha256,
	);
	const verdict = verifyProofTrace(
		scenario.evaluations,
		c.binding,
		scenario.expected,
		run.report.trace,
		{ before: new Uint8Array(), after: bytes },
	);
	assert.equal(verdict.passed, true, `${c.id}: ${verdict.errors}`);
	const expectedTransport = scenario.steps
		.filter((s) => s.kind === "settle" && s.result !== "reject")
		.map((s) => ({
			call: s.call,
			bytes:
				s.result === "short" ? 1 : Buffer.byteLength(run.report.trace.attemptedPayloads[s.call]),
		}));
	assert.deepEqual(
		run.report.transportAttempts,
		expectedTransport,
		`${c.id}: actual handle events`,
	);
	if (c.arm === "graph") topologies.push(run.report.topology);
	const pair = pairs.get(c.caseId);
	if (pair) assert.ok(pair.equals(bytes), `${c.caseId}: Graph/plain readback mismatch`);
	else pairs.set(c.caseId, bytes);
	hostRequests += run.report.trace.attemptedPayloads.length;
	underlyingWrites += run.report.transportAttempts.length;
	readbackBytes += bytes.length;
	results.push({
		id: c.id,
		passed: true,
		candidateQualified: verdict.candidateQualified,
		hostRequests: run.report.trace.attemptedPayloads.length,
		underlyingWrites: expectedTransport.length,
		readbackBytes: bytes.length,
		readbackDigest: digest(c.path),
		normalEndReady: run.report.trace.normalEndReady,
	});
}
for (const topology of topologies) assert.deepEqual(topology, topologies[0]);
console.log(
	JSON.stringify(
		{
			kind: "read-only-real-file-proof-replay",
			passed: true,
			consumersExecuted: 0,
			writesPerformed: 0,
			manifestSha256: digest(manifestPath),
			executionReceiptSha256: digest(receiptPath),
			approvalSha256: digest(approvalPath),
			checkedSources: sources.size,
			cases: manifest.cases.length,
			hostRequests,
			underlyingWrites,
			readbackBytes,
			identicalGraphTopologies: topologies.length,
			graphPlainBytePairs: pairs.size,
			b121Complete: false,
			formalPerformanceQualified: false,
			results,
		},
		null,
		"\t",
	),
);
