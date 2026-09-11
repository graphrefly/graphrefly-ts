/** Independent D168 arithmetic/structure verifier. Does not import the reporter or its verdict. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export function verifyEvidence(directory) {
	const read = (name) => readFileSync(resolve(directory, name));
	const json = (name) => JSON.parse(read(name));
	const freeze = json("freeze.json"),
		report = json("report.json");
	assert.equal(report.freezeDigest, digest(read("freeze.json")), "freeze binding");
	assert.equal(freeze.kind, "P2-summary-method-validation-only");
	assert.equal(freeze.method.revision, "spending-preset-repetition-v2");
	assert.deepEqual(freeze.method, {
		revision: "spending-preset-repetition-v2",
		row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
		repetitions: 16,
		controls: 4,
		warmup: 100,
		measured: 300,
		limit: 1.2,
		controlLimit: 1.05,
		intervalRanks: [2, 15],
		maxProcesses: 20,
		maxSamples: 67200,
		timeoutMs: 900000,
	});
	assert.equal(freeze.workerDigest, digest(read("worker.mjs")), "worker binding");
	assert.equal(freeze.workerDigest, digest(read("worker-copy.mjs")), "identical worker bytes");
	assert.ok(
		typeof freeze.executionRoot === "string" && freeze.executionRoot.startsWith("/"),
		"recorded execution root",
	);
	for (const required of [
		"worker.mjs",
		"worker-copy.mjs",
		"approval.json",
		"reference-qualification.json",
		"P2-inputs.json",
		"adapted-worker.ts",
	])
		assert.ok(freeze.files[required], `required frozen material ${required}`);
	for (const [file, hash] of Object.entries(freeze.files)) {
		assert.ok(!file.startsWith("/") && !file.split("/").includes(".."), "local evidence path");
		assert.equal(digest(read(file)), hash, `input/source binding: ${file}`);
	}
	const approval = json("approval.json");
	assert.deepEqual(approval.measurementLimits, {
		row: "cold-P2-summary",
		processes: 20,
		samples: 67200,
		elapsedMs: 900000,
		retries: 0,
	});
	assert.equal(digest(read(`source/${approval.design}`)), approval.designDigest);
	const qualification = json("reference-qualification.json");
	assert.equal(qualification.complete, true, "current semantic prerequisite");
	assert.deepEqual(
		qualification.results.map((r) => r.id).sort(),
		[
			"baseline",
			"dependency-guard-removed",
			"pack-bound-one-mib",
			"plain-cached-outcome-replay",
			"plain-evidence-omitted",
			"plain-unbounded-domains",
			"stale-join-rows",
			"wrong-score",
		],
		"unique complete semantic cases",
	);
	assert.ok(
		qualification.results.every(
			(r) => r.loaded && r.outcome === (r.id === "baseline" ? "passed" : "detected"),
		),
		"loaded semantic qualification",
	);
	assert.equal(
		qualification.recipeDigest,
		digest(read("source/scripts/qualify-spending-preset-reference.mjs")),
		"qualification runner",
	);
	assert.equal(
		qualification.testDigest,
		digest(read("source/packages/ts/src/__tests__/spending-alerts-preset-reference.test.ts")),
		"qualification tests",
	);
	for (const [file, hash] of Object.entries(freeze.runtimeSources)) {
		assert.equal(digest(read(`source/${file}`)), hash, "runtime snapshot binding");
		assert.equal(qualification.copiedInputs[file], hash, `semantic closure: ${file}`);
	}
	const ids = [
		"control-0",
		"control-1",
		...Array.from({ length: 16 }, (_, i) => `repeat-${i}`),
		"control-2",
		"control-3",
	];
	assert.deepEqual(
		freeze.jobs.map((j) => j.id),
		ids,
		"fixed schedule",
	);
	assert.deepEqual(
		report.jobs.map((j) => j.id),
		ids,
		"all jobs, no replacement",
	);
	assert.equal(report.complete, true);
	assert.equal(report.qualified, false, "method trial cannot qualify matrix");
	assert.ok(report.elapsedMs >= 0 && report.elapsedMs <= 900000, "finite attempt budget");
	const primary = [],
		controls = [],
		seenPids = new Set();
	let total = 0;
	for (const [ordinal, id] of ids.entries()) {
		const control = id.startsWith("control-"),
			job = report.jobs[ordinal];
		assert.equal(freeze.jobs[ordinal].control, control);
		assert.equal(job.control, control);
		assert.equal(job.status, "completed");
		assert.equal(job.exitCode, 0);
		for (const [name, hash] of Object.entries(job.files)) {
			assert.ok(!name.includes("/") && name !== "..", "job leaf path");
			assert.equal(digest(read(`${id}/${name}`)), hash, `job artifact: ${id}/${name}`);
		}
		for (const required of [
			"config.json",
			"entry.mjs",
			"samples.jsonl",
			"worker.json",
			"preflight.json",
			"completion.json",
			"runtime.log",
			"v8.log",
		])
			assert.ok(job.files[required], `missing bound artifact ${required}`);
		const config = json(`${id}/config.json`),
			metadata = json(`${id}/worker.json`);
		assert.deepEqual(config.row, freeze.method.row);
		assert.equal(config.control, control);
		assert.equal(config.output, resolve(freeze.executionRoot, id), "output binding");
		assert.equal(
			config.scenarioPath,
			resolve(freeze.executionRoot, "P2-inputs.json"),
			"input binding",
		);
		assert.equal(
			config.copyModule,
			pathToFileURL(resolve(freeze.executionRoot, "worker-copy.mjs")).href,
			"copy binding",
		);
		const entry = `import {runRow} from ${JSON.stringify(pathToFileURL(resolve(freeze.executionRoot, "worker.mjs")).href)}; await runRow(${JSON.stringify(resolve(freeze.executionRoot, id, "config.json"))});\n`;
		assert.equal(read(`${id}/entry.mjs`).toString(), entry, "entry binding");
		assert.equal(metadata.control, control);
		assert.deepEqual(metadata.row, freeze.method.row);
		assert.equal(metadata.recipe.warmup, 100);
		assert.equal(metadata.recipe.measured, 300);
		assert.deepEqual(metadata.recipe.orders, [
			["candidate", "reference"],
			["reference", "candidate"],
			["candidate", "reference"],
		]);
		assert.ok(
			Number.isInteger(metadata.pid) && !seenPids.has(metadata.pid),
			"fresh process identity",
		);
		seenPids.add(metadata.pid);
		assert.equal(json(`${id}/preflight.json`).passed, true);
		const data = read(`${id}/samples.jsonl`)
			.toString()
			.trim()
			.split("\n")
			.map((s) => JSON.parse(s));
		const batches = { candidate: [], reference: [], plain: [] };
		let cursor = 0;
		for (let batch = 0; batch < 3; batch++) {
			const arms = batch === 1 ? ["reference", "candidate"] : ["candidate", "reference"];
			if (!control) arms.push("plain");
			for (const arm of arms) {
				const measured = [];
				for (let index = 0; index < 400; index++) {
					const s = data[cursor++];
					assert.ok(s, "truncated data");
					assert.deepEqual(
						[s.arm, s.batch, s.index, s.phase],
						[arm, batch, index, index < 100 ? "warmup" : "measured"],
						"exact sample coordinates",
					);
					for (const k of ["start", "end", "ms", "constructionMs", "preparationMs"])
						assert.ok(Number.isFinite(s[k]) && s[k] >= 0, `finite clock: ${k}`);
					assert.equal(s.ms, s.end - s.start);
					if (index >= 100) measured.push(s.ms);
				}
				measured.sort((a, b) => a - b);
				batches[arm].push(measured[284]);
				assert.equal(
					job.summary.arms[arm].batches[batch].p95Ms,
					measured[284],
					"raw p95 vs report",
				);
			}
		}
		assert.equal(cursor, data.length, "extra records");
		assert.equal(job.summary.sampleCount, cursor);
		assert.deepEqual(json(`${id}/completion.json`), { completed: true, samples: cursor });
		total += cursor;
		const center = (arm) => [...batches[arm]].sort((a, b) => a - b)[1];
		for (const arm of control ? ["candidate", "reference"] : ["candidate", "reference", "plain"])
			assert.equal(
				job.summary.arms[arm].medianBatchP95Ms,
				center(arm),
				"independent absolute time",
			);
		assert.ok(center("reference") > 0, "positive denominator");
		const ratio = center("candidate") / center("reference");
		assert.ok(Number.isFinite(ratio) && ratio > 0);
		assert.equal(job.summary.ratio, ratio, "independent repeat ratio");
		(control ? controls : primary).push(ratio);
	}
	assert.equal(total, 67200);
	const sorted = [...primary].sort((a, b) => a - b);
	const stable = controls.every((c) => c >= 1 / 1.05 && c <= 1.05);
	const verdict = !stable
		? "inconclusive"
		: sorted[14] <= 1.2
			? "passed"
			: sorted[1] > 1.2
				? "rejected"
				: "inconclusive";
	const expected = {
		verdict,
		reason: !stable
			? "control-instability"
			: verdict === "inconclusive"
				? "budget-straddled"
				: "interval-budget",
		interval: [sorted[1], sorted[14]],
		median: (sorted[7] + sorted[8]) / 2,
		mean: primary.reduce((a, b) => a + b, 0) / 16,
		min: sorted[0],
		max: sorted[15],
		controls,
	};
	assert.deepEqual(report.decision, expected, "independent verdict");
	return {
		validEvidence: true,
		rowVerdict: verdict,
		samples: total,
		processes: 20,
		qualified: false,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	assert.ok(
		process.argv[2],
		"usage: node verify-spending-preset-repetition.mjs EVIDENCE_DIRECTORY",
	);
	console.log(JSON.stringify(verifyEvidence(resolve(process.argv[2])), null, 2));
}
