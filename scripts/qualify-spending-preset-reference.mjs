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
const testPath = "packages/ts/src/__tests__/spending-alerts-preset-reference.test.ts";
const reference = "scripts/fixtures/spending-preset-reference.ts";
const decoder = "scripts/fixtures/spending-preset-reference-input.ts";
const hash = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const one = (s, a, b) => {
	assert.equal(s.split(a).length, 2, a);
	return s.replace(a, b);
};
const plain = "scripts/fixtures/spending-preset-plain.ts";
const variants = [
	{
		id: "plain-unbounded-domains",
		file: plain,
		kind: "runtime-semantic",
		pattern: "lifetime domain capacity",
		change: (s) => one(s, "if (this.domains.size === 64)", "if (false)"),
	},
	{
		id: "plain-cached-outcome-replay",
		file: plain,
		kind: "runtime-semantic",
		pattern: "prior inbox DATA",
		change: (s) =>
			one(s, "for (const o of incomingOutcomes)", "for (const o of inbox?.outcomes ?? [])"),
	},
	{
		id: "plain-evidence-omitted",
		file: plain,
		kind: "runtime-semantic",
		pattern: "normal lifecycle closes",
		change: (s) => one(s, "this.evidenceRecords.set(key, v);", "void v;"),
	},

	{ id: "baseline", file: reference, kind: "baseline", pattern: ".", change: (s) => s },
	{
		id: "stale-join-rows",
		file: reference,
		kind: "runtime-semantic",
		pattern: "invalidation revokes",
		change: (s) =>
			s.replaceAll("state.maps[i].clear();", "void 0;").replaceAll("s.maps[i].clear();", "void 0;"),
	},
	{
		id: "pack-bound-one-mib",
		file: decoder,
		kind: "runtime-semantic",
		pattern: "pack decoding accepts",
		change: (s) =>
			one(s, 'canonical(raw, lane === "pack" ? 4 * 1048576 : 1048576)', "canonical(raw)"),
	},
	{
		id: "wrong-score",
		file: reference,
		kind: "runtime-semantic",
		pattern: "matches P2",
		change: (s) => one(s, "zScore: plainScore(stats)", "zScore: 0"),
	},
	{
		id: "dependency-guard-removed",
		file: reference,
		kind: "runtime-structural-guard",
		pattern: "reference removing",
		change: (s) =>
			one(
				s,
				"node.deps.length !== expected.length || node.deps.some((d, i) => d !== expected[i])",
				"false",
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
	kind: "private-preset-reference-runtime-mutations",
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
			{ cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
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
