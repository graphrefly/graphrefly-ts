import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { correlate, summarize } from "./spending-preset-performance-report.mjs";

const dir = mkdtempSync(resolve(tmpdir(), "preset-perf-tests-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const result = await build({
	entryPoints: ["scripts/fixtures/spending-preset-performance-worker.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const bytes = result.outputFiles[0].text,
	workerPath = resolve(dir, "worker.mjs");
writeFileSync(workerPath, bytes);
const worker = await import(pathToFileURL(workerPath).href);

// Use committed archive fixtures, independent of any untracked machine-local cache.
import { execFileSync } from "node:child_process";

const fixture = (id) =>
	JSON.parse(
		execFileSync(
			"tar",
			[
				"-xOf",
				"packages/ts/qualification/causal-occurrence/preset-reference-v1/evidence.tar.gz",
				`./freeze-qualified/${id}-inputs.json`,
			],
			{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
		),
	);
function samplesFor(values) {
	return Object.entries(values).flatMap(([arm, batches]) =>
		batches.flatMap((ms, batch) =>
			Array.from({ length: 400 }, (_, index) => ({
				arm,
				batch,
				index,
				phase: index < 100 ? "warmup" : "measured",
				ms,
				start: index,
				end: index + ms,
				constructionMs: 0,
				preparationMs: 0,
			})),
		),
	);
}
test("frozen matrix has unique 12/60/12 rows and exact dense profile axes", () => {
	const rows = worker.matrixRows();
	assert.equal(new Set(rows.map((r) => r.id)).size, 84);
	for (const [group, count] of Object.entries({ cold: 12, steady: 60, recovery: 12 }))
		assert.equal(rows.filter((r) => r.group === group).length, count);
	assert.deepEqual(
		[...new Set(rows.filter((r) => r.change === "one-new").map((r) => r.profile))],
		["P3", "P5", "P6"],
	);
});
test("estimator is ratio of median batch p95s, not median paired ratios", () => {
	const r = summarize(
		{ group: "cold" },
		samplesFor({ candidate: [1, 100, 101], reference: [1, 2, 100], plain: [1, 1, 1] }),
		worker.RECIPE,
	);
	assert.equal(r.ratio, 50);
	assert.equal(r.passed, false); // paired-ratio median would be 1.01 and incorrectly pass.
});
test("truncated measured samples, invalid times and zero denominators cannot pass", () => {
	const samples = samplesFor({ candidate: [1, 1, 1], reference: [1, 1, 1], plain: [1, 1, 1] });
	assert.throws(
		() => summarize({ group: "cold" }, samples.slice(1), worker.RECIPE),
		/warmup count/,
	);
	assert.throws(
		() => summarize({ group: "cold" }, samples.slice(0, -1), worker.RECIPE),
		/measured count/,
	);
	const bad = structuredClone(samples);
	bad[100].ms = NaN;
	assert.throws(() => summarize({ group: "cold" }, bad, worker.RECIPE), /finite/);
	assert.throws(
		() =>
			summarize(
				{ group: "cold" },
				samplesFor({ candidate: [1, 1, 1], reference: [0, 0, 0], plain: [1, 1, 1] }),
				worker.RECIPE,
			),
		/denominator/,
	);
});
test("uncalibrated native GC/deopt logs cannot claim overlap", () => {
	const r = correlate(
		[{ arm: "candidate", batch: 0, index: 100, phase: "measured", start: 20, end: 25 }],
		"[12:0x0] 123 ms: Scavenge 1 -> 2 MB, 2.00 / 0.00 ms",
		"code-deopt,124000,more\ncode-deopt,140000,later",
		100,
	);
	assert.equal(r.samples[0].gc, null);
	assert.equal(r.samples[0].deopt, null);
	assert.equal(r.samples[0].status, "unknown");
});
for (const [profile, mode, change, dataCount] of [
	["P1", "off", "all-new", 2],
	["P3", "summary", "one-new", 2],
	["P6", "summary", "one-new", 2],
])
	test(`actual ${profile} schedule: oracle, all three arms, lifetime counts, fresh reconnect DATA`, () => {
		const row = worker
			.matrixRows()
			.find(
				(r) =>
					r.profile === profile &&
					r.mode === mode &&
					r.change === change &&
					r.dataCount === dataCount,
			);
		const r = worker.preflight(row, fixture(profile));
		assert.equal(r.passed, true);
		assert.equal(r.afterOccurrences - r.beforeOccurrences, 1);
		assert.deepEqual(r.newByEntry, [1, 0]);
		assert.ok(r.recoveryPorts.candidate.reemitted.includes("publication"));
		if (profile === "P1") assert.equal(r.materialHints.action[0].newMaterials, 0);
		if (profile === "P6") assert.equal(r.extraVerificationData, 3);
	});
test("missing actual reconnect call is rejected, not masked by prior output", async () => {
	assert.ok(bytes.includes("run.connect();"));
	const mutant = resolve(dir, "missing-reconnect.mjs");
	writeFileSync(
		mutant,
		bytes.replace("run.connect();", "/* negative control: skipped reconnect */"),
	);
	const changed = await import(pathToFileURL(mutant).href);
	assert.throws(() => changed.preflight(worker.matrixRows()[0], fixture("P1")), /reconnect DATA/);
});
