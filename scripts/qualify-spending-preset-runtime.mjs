/** Isolated loadable private consumer mutations. Results distinguish assertion failures from load errors. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	arg = process.argv.indexOf("--output");
assert.ok(arg >= 0 && process.argv[arg + 1]);
const out = resolve(process.argv[arg + 1]);
assert.equal(existsSync(out), false);
mkdirSync(out, { recursive: true });
const testPath = "packages/ts/src/__tests__/spending-alerts-causal-preset.test.ts";
const numeric = "examples/spending-alerts/causal-numeric.ts";
const business = "examples/spending-alerts/causal-business.ts",
	admission = "examples/spending-alerts/causal-admission.ts",
	material = "examples/spending-alerts/causal-material-owner.ts";
const hash = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const one = (s, a, b) => {
	assert.equal(s.split(a).length, 2, a);
	return s.replace(a, b);
};
const variants = [
	{
		id: "occurrence-id-only",
		file: admission,
		kind: "evidence-identity",
		pattern: "receipt association preserves complete occurrence identity",
		change: (s) =>
			one(
				s,
				"occurrence === exactOccurrence",
				"v.occurrence.occurrenceId === e.occurrence.occurrenceId",
			),
	},
	{ id: "baseline", file: business, kind: "baseline", pattern: ".", change: (s) => s },
	{
		id: "population-variance",
		file: numeric,
		kind: "business-output",
		pattern: "executes real business",
		change: (s) => one(s, "delta * delta * (n - 1n)", "delta * delta * n"),
	},
	{
		id: "rounded-zero-variance",
		file: numeric,
		kind: "business-output",
		pattern: "numeric contract subnormal-64",
		change: (s) => one(s, "if (dispersion === 0n) return 0;", "if (stats.std === 0) return 0;"),
	},
	{
		id: "rounding-removed",
		file: numeric,
		kind: "business-output",
		pattern: "numeric contract",
		change: (s) => one(s, "comparison > 0n ||", "false ||"),
	},
	{
		id: "threshold-equality",
		file: business,
		kind: "business-output",
		pattern: "numeric contract rounded-threshold-equal",
		change: (s) => {
			assert.equal(s.split("score.zScore > policy.zThreshold").length, 3);
			return s.replaceAll("score.zScore > policy.zThreshold", "score.zScore >= policy.zThreshold");
		},
	},
	{
		id: "display-as-policy",
		file: business,
		kind: "business-output",
		pattern: "numeric contract rounded-threshold-down",
		change: (s) => {
			assert.equal(s.split("score.zScore > policy.zThreshold").length, 3);
			return s.replaceAll(
				"score.zScore > policy.zThreshold",
				"Number(score.zScore.toFixed(2)) > policy.zThreshold",
			);
		},
	},
	{
		id: "stale-verifier-current",
		file: "examples/spending-alerts/causal-inputs.ts",
		kind: "authorization",
		pattern: "old verifier revision",
		change: (s) => one(s, '"spending-oracle-v2"', '"spending-oracle-v1"'),
	},

	{
		id: "request-authorization-bypass",
		file: admission,
		kind: "authorization",
		pattern: "wrong requestDigest",
		change: (s) => one(s, "v.requestDigest === requestDigest", "true"),
	},
	{
		id: "source-authorization-bypass",
		file: admission,
		kind: "authorization",
		pattern: "wrong sourceDigest",
		change: (s) => one(s, "v.sourceDigest === binding.sourceDigest", "true"),
	},
	{
		id: "grant-expiry-bypass",
		file: admission,
		kind: "authorization",
		pattern: "expired boundary",
		change: (s) => one(s, "local.tick > grant.validThrough", "false"),
	},
	{
		id: "grant-revocation-bypass",
		file: admission,
		kind: "authorization",
		pattern: "revoked boundary",
		change: (s) => one(s, "grant.revoked ||", "false ||"),
	},
	{
		id: "request-evidence-bypass",
		file: admission,
		kind: "evidence",
		pattern: "wrong requestDigest",
		change: (s) =>
			one(s, "expectedRequest !== undefined && v.requestDigest !== expectedRequest", "false"),
	},
	{
		id: "receipt-kind-erasure",
		file: admission,
		kind: "evidence",
		pattern: "full receipt reference",
		change: (s) => one(s, "evidenceId: hash(v.receiptRef)", "evidenceId: v.receiptRef.id"),
	},
	{
		id: "pending-evidence-drop",
		file: admission,
		kind: "evidence",
		pattern: "retains both early receipts",
		change: (s) =>
			one(
				s,
				"const verification = [...s.receipts.values()].map",
				"const verification = verificationFrames.flatMap(f=>f?.valid?f.value.receipts:[]).map",
			),
	},
	{
		id: "material-not-retained",
		file: material,
		kind: "material-before-publication",
		pattern: "exact admitted publication|active obligation",
		change: (s) => one(s, "s.snapshot = next;", "void next;"),
	},
	{
		id: "missing-runtime-dependency-guard",
		file: business,
		kind: "runtime-structural-guard",
		pattern: "removing evidence dependency",
		change: (s) =>
			one(
				s,
				"node.deps.length !== expected.length || node.deps.some((d, i) => d !== expected[i])",
				"false",
			),
	},
	{
		id: "quiet-lane-wedge",
		file: "packages/ts/src/solutions/causal-occurrence/construction.ts",
		kind: "runtime-progress",
		pattern: "exact admitted publication",
		change: (s) =>
			one(
				s,
				'{ name, factory: "causalOccurrenceInputLane", partial: true }',
				'{ name, factory: "causalOccurrenceInputLane" }',
			),
	},
];
const temp = mkdtempSync(join(tmpdir(), "preset-mutations-"));
const originals = new Map(
	variants.map((v) => [v.file, readFileSync(resolve(root, v.file), "utf8")]),
);
const inputDirectories = [
	"packages/ts/src",
	"examples/spending-alerts",
	"scripts/fixtures",
	"docs/design",
];
const filesBelow = (path) =>
	readdirSync(resolve(root, path), { withFileTypes: true }).flatMap((entry) => {
		const child = `${path}/${entry.name}`;
		return entry.isDirectory() ? filesBelow(child) : entry.isFile() ? [child] : [];
	});
const copiedInputs = Object.fromEntries(
	inputDirectories
		.flatMap(filesBelow)
		.sort()
		.map((p) => [p, hash(readFileSync(resolve(root, p)))]),
);
const report = {
	kind: "private-preset-runtime-mutations",
	copiedInputs,
	runtime: {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		vitest: hash(readFileSync(resolve(root, "node_modules/vitest/package.json"))),
	},
	recipeDigest: hash(readFileSync(fileURLToPath(import.meta.url))),
	testDigest: hash(readFileSync(resolve(root, testPath))),
	sources: Object.fromEntries([...originals].map(([p, s]) => [p, hash(s)])),
	complete: false,
	results: [],
};
try {
	for (const path of inputDirectories) {
		mkdirSync(dirname(join(temp, path)), { recursive: true });
		cpSync(resolve(root, path), join(temp, path), { recursive: true });
	}
	symlinkSync(resolve(root, "node_modules"), join(temp, "node_modules"), "dir");
	writeFileSync(join(temp, "package.json"), '{"type":"module"}');
	writeFileSync(
		join(temp, "vitest.config.mts"),
		`export default {define:{__GRAPHREFLY_TS_PACKAGE_REVISION__:'"graphrefly-ts:0.9.0"'},test:{include:['${testPath}']}}`,
	);
	const tests = readFileSync(resolve(root, testPath), "utf8");
	for (const variant of variants) {
		for (const [path, source] of originals) writeFileSync(join(temp, path), source);
		const source =
			variant.change(originals.get(variant.file)) +
			`\n(globalThis as unknown as {__presetLoadedMutation:string}).__presetLoadedMutation=${JSON.stringify(variant.id)};\n`;
		writeFileSync(join(temp, variant.file), source);
		writeFileSync(join(out, `${variant.id}.source.ts`), source);
		writeFileSync(
			join(temp, testPath),
			tests +
				`\nit('preset mutant bytes loaded',()=>expect((globalThis as unknown as {__presetLoadedMutation:string}).__presetLoadedMutation).toBe(${JSON.stringify(variant.id)}));\n`,
		);
		const resultPath = join(out, `${variant.id}.result.json`);
		const child = spawnSync(
			process.execPath,
			[
				resolve(root, "node_modules/vitest/vitest.mjs"),
				"run",
				"--root",
				temp,
				"--config",
				join(temp, "vitest.config.mts"),
				"--testNamePattern",
				`${variant.pattern}|preset mutant bytes loaded`,
				"--reporter=json",
				`--outputFile=${resultPath}`,
			],
			{ cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
		);
		writeFileSync(join(out, `${variant.id}.log`), `${child.stdout}${child.stderr}`);
		assert.ifError(child.error);
		const result = JSON.parse(readFileSync(resultPath, "utf8")),
			checks = result.testResults.flatMap((r) => r.assertionResults),
			loaded = checks.some(
				(c) => c.fullName === "preset mutant bytes loaded" && c.status === "passed",
			),
			failed = checks.filter((c) => c.status === "failed");
		const outcome = !loaded
			? "load-failed"
			: variant.kind === "baseline"
				? child.status === 0
					? "passed"
					: "failed"
				: failed.length
					? "detected"
					: "survived";
		report.results.push({
			id: variant.id,
			kind: variant.kind,
			sourcePath: variant.file,
			loaded,
			sourceDigest: hash(source),
			outcome,
			exitCode: child.status,
			failed: failed.map((c) => ({ name: c.fullName, messages: c.failureMessages })),
			resultDigest: hash(readFileSync(resultPath)),
		});
		writeFileSync(join(out, "results.json"), JSON.stringify(report, null, 2));
		console.log("PRESET_MUTANT_DONE", variant.id, outcome);
		assert.ok(loaded);
		assert.equal(result.numRuntimeErrorTestSuites ?? 0, 0);
		if (variant.kind === "baseline") assert.equal(child.status, 0);
	}
	report.complete = report.results.every((r) => r.outcome === "passed" || r.outcome === "detected");
} finally {
	rmSync(temp, { recursive: true, force: true });
	for (const [path, digest] of Object.entries(copiedInputs))
		assert.equal(hash(readFileSync(resolve(root, path))), digest);
	for (const [path, source] of originals)
		assert.equal(readFileSync(resolve(root, path), "utf8"), source);
	writeFileSync(join(out, "results.json"), JSON.stringify(report, null, 2));
	console.log("PRESET_RUNTIME_MUTATIONS_DONE", report.complete);
}
if (!report.complete) process.exitCode = 1;
