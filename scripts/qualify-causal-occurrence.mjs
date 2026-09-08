/** D791 package-private qualification. Mutates temporary modules, never the checkout. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "packages/ts/src");
const sourcePath = join(srcRoot, "solutions/causal-occurrence/construction.ts");
const testPath = join(srcRoot, "__tests__/solutions-causal-occurrence.d791.test.ts");
const sourceNames = [
	"solutions/causal-occurrence.ts",
	...[
		"construction",
		"contracts",
		"identity",
		"lifecycle",
		"evidence",
		"transition",
		"capabilities",
	].map((name) => `solutions/causal-occurrence/${name}.ts`),
	"graph/construction-scope.ts",
];
const sourceFiles = Object.fromEntries(
	sourceNames.map((name) => [name, readFileSync(join(srcRoot, name), "utf8")]),
);
const marker = (name) => `\n// QUALIFICATION_FILE ${name}\n`;
const source = sourceNames.map((name) => marker(name) + sourceFiles[name]).join("");
const tests = readFileSync(testPath, "utf8");
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const filterArg = process.argv.indexOf("--filter");
const selectedFilter = filterArg < 0 ? undefined : new RegExp(process.argv[filterArg + 1]);
const reportArg = process.argv.indexOf("--output");
const reportPath = reportArg < 0 ? undefined : resolve(process.argv[reportArg + 1]);

const sourceFile = ts.createSourceFile(
	sourcePath,
	sourceFiles["solutions/causal-occurrence/construction.ts"],
	ts.ScriptTarget.Latest,
	true,
);
const calls = [];
function visit(node) {
	if (ts.isCallExpression(node)) calls.push(node);
	ts.forEachChild(node, visit);
}
visit(sourceFile);
const replaceOnce = (text, from, to) => {
	const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(from.trim().split(/\s+/u).map(escapePattern).join("\\s+"), "gu");
	assert.equal([...text.matchAll(pattern)].length, 1, `Mutation anchor must match once: ${from}`);
	return text.replace(pattern, () => to);
};
const optionsName = (call) => call.arguments.at(-1)?.getText(sourceFile) ?? "";
function dependencyPatch(suffix, index) {
	const found = calls.filter((call) => {
		const name = call.expression.getText(sourceFile);
		return (
			(name === "graph.node" || name === "graph.initNode") &&
			optionsName(call).includes(`name: \u0060\u0024{opts.name}/${suffix}\u0060`)
		);
	});
	assert.equal(found.length, 1, `Locate ${suffix}`);
	const call = found[0];
	const dep = call.arguments[call.expression.getText(sourceFile) === "graph.node" ? 0 : 1];
	assert.ok(ts.isArrayLiteralExpression(dep));
	assert.ok(index < dep.elements.length);
	const replacement = `[${dep.elements
		.filter((_, i) => i !== index)
		.map((node) => node.getText(sourceFile))
		.join(", ")}]`;
	return (text) => replaceOnce(text, dep.getText(sourceFile), replacement);
}
const mutants = [];
function add(id, change, kind = "behavior") {
	mutants.push({ id, change, kind });
}
const lanes = [
	"occurrences",
	"admissions",
	"branch-terminals",
	"effect-proposals",
	"effect-admissions",
	"effect-outcomes",
	"evidence",
	"watermarks",
];
for (const [index, lane] of lanes.entries()) {
	const inputCut = (text) =>
		replaceOnce(
			text,
			"\n\t\t[input],",
			`\n\t\tlaneName === ${JSON.stringify(lane)} ? [] : [input],`,
		);
	add(`source-edge/${lane}`, inputCut, "structure");
	add(`input-behavior/${lane}`, inputCut);
	const cut = dependencyPatch("arrivals", index);
	add(`join-edge/${lane}`, cut, "structure");
	add(`join-behavior/${lane}`, cut);
}
for (const [suffix, index] of [
	["authority", 0],
	["release-port", 0],
	["released", 0],
	["release-events", 0],
	["release-events", 1],
	["release-controller", 0],
]) {
	const cut = dependencyPatch(suffix, index);
	add(`internal-edge/${suffix}/${index}`, cut, "structure");
	add(`internal-behavior/${suffix}/${index}`, cut);
}
for (const kind of [
	"release",
	"currentness",
	"terminal",
	"conservation",
	"coverage",
	"quiescence",
	"issue",
]) {
	const cut = (text) =>
		replaceOnce(
			text,
			"\n\t\t[authority],",
			`\n\t\tkind === ${JSON.stringify(kind)} ? [] : [authority],`,
		);
	add(`projection-edge/${kind}`, cut, "structure");
	add(`projection-behavior/${kind}`, cut);
}
const replacements = [
	[
		"release-admission",
		"state.admissions.set(key, canonical.snapshot);",
		'state.admissions.set(key, { ...canonical.snapshot, state: "admitted" });',
	],
	["release-currentness", 'currentness?.state !== "current" ||', "currentness === undefined ||"],
	[
		"release-replay",
		'currentness?.state !== "current" || state.released.has(key) ||',
		'currentness?.state !== "current" || false ||',
	],
	["digest-binding", "causalOccurrenceDigest(digestMaterial) !== digest", "false"],
	[
		"exact-outcome-admission",
		"dataKey(record.admission.admissionRef) !== dataKey(canonical.snapshot.admissionRef) ||",
		"false ||",
	],
	["result-state-binding", "!resultMatchesState", "false"],
	["result-envelope", "!validResult(outcome.result)", "false"],
	["conservation-count", "proposed: records.length,", "proposed: records.length + 1,"],
	[
		"coverage-gap",
		'value.coverage !== "retention-gap" && value.coverage !== "skipped-revision"',
		"true",
	],
	["domain-bound", "state.domains.size >= opts.maxOccurrences", "false"],
];
for (const [id, from, to] of replacements) add(id, (text) => replaceOnce(text, from, to));
add("terminal-fan-in", (text) => {
	const from = "opts.requiredBranches.every((branch) => branches.has(branch))";
	assert.equal(text.split(from).length - 1, 2);
	return text.replaceAll(from, "opts.requiredBranches.some((branch) => branches.has(branch))");
});
add("domain-failure-protocol-error", (text) =>
	replaceOnce(
		text,
		'for (const output of outputs) ctx.down([["DATA", Object.freeze(output)]]);',
		'for (const output of outputs) { if (output.kind === "conservation" && output.value.failed > 0) ctx.down([["ERROR", output.value]]); else ctx.down([["DATA", Object.freeze(output)]]); }',
	),
);
add("effect-pending-loss", (text) =>
	replaceOnce(
		text,
		"if (retainEffectProposal(context, key, proposal)) state.pendingEffectProposals.delete(key);",
		"retainEffectProposal(context, key, proposal); state.pendingEffectProposals.delete(key);",
	),
);
add("pending-progress-stall", (text) =>
	replaceOnce(text, "if (!promoted && state.released.size === releasedBefore) break;", "break;"),
);
add("new-domain-pending-stall", (text) =>
	replaceOnce(
		text,
		"for (const revisionDomain of state.domains) {",
		"for (const revisionDomain of state.highWaterByDomain.keys()) {",
	),
);
const structureGuard = "\tassertCausalOccurrenceTopology(graph.readIncoming(), opts.name);";
const behaviorSource = replaceOnce(
	replaceOnce(
		source,
		structureGuard,
		"\t// Structure guard isolated only in this temporary behavior qualification module.",
	),
	'this.phase !== "cold" || this.available.size !== 0',
	'this.phase !== "cold" /* manifest completeness isolated in temporary behavior arm */',
);
for (const mutant of mutants) mutant.change(mutant.kind === "structure" ? source : behaviorSource);
const temporary = mkdtempSync(join(tmpdir(), "graphrefly-causal-mutations-"));
const pattern =
	"^(?!.*(?:fails a topology mutation|contains no caller lifecycle patch escape hatches|causal topology exact-string index)).*$";
const version = JSON.parse(readFileSync(join(root, "packages/ts/package.json"), "utf8")).version;
const configPath = join(temporary, "vitest.config.mts");
writeFileSync(
	configPath,
	`export default ${JSON.stringify({ define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: JSON.stringify(`graphrefly-ts:${version}`) }, test: { include: ["contract.test.ts"] } })};`,
);
const candidatePath = join(temporary, sourceNames[0]);
const rewrittenTests = tests
	.replaceAll('from "../', `from "${srcRoot}/`)
	.replace(
		`from "${srcRoot}/solutions/causal-occurrence.js"`,
		`from ${JSON.stringify(candidatePath)}`,
	)
	.replace(
		'from "vitest"',
		`from ${JSON.stringify(join(root, "node_modules/vitest/dist/index.js"))}`,
	);
writeFileSync(join(temporary, "contract.test.ts"), rewrittenTests);
const report = {
	schema: "graphrefly-ts/causal-occurrence-mutation-qualification/v1",
	contract: "graphrefly/causal-occurrence-contract/v1@contract-v2",
	behaviorIsolation: ["required-edge assertion", "cold manifest completeness"],
	sourceDigest: digest(source),
	sourceFiles: Object.fromEntries(sourceNames.map((name) => [name, digest(sourceFiles[name])])),
	testDigest: digest(tests),
	runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
	runtime: { node: process.version, platform: process.platform, arch: process.arch },
	toolchainDigests: Object.fromEntries(
		["package.json", "pnpm-lock.yaml", "packages/ts/package.json"].map((path) => [
			path,
			digest(readFileSync(join(root, path))),
		]),
	),
	baseline: [],
	mutations: [],
	complete: false,
};
function run(id, text, kind) {
	for (const [index, name] of sourceNames.entries()) {
		const begin = text.indexOf(marker(name)) + marker(name).length;
		const end =
			index + 1 < sourceNames.length ? text.indexOf(marker(sourceNames[index + 1])) : text.length;
		assert.ok(begin >= marker(name).length && end >= begin, "Missing module boundary");
		const target = join(temporary, name);
		mkdirSync(dirname(target), { recursive: true });
		const moduleText = text.slice(begin, end).replace(/from "(\.[^"]+)"/gu, (match, specifier) => {
			const resolved = resolve(srcRoot, dirname(name), specifier).replace(/\.js$/u, ".ts");
			return sourceNames.some((entry) => join(srcRoot, entry) === resolved)
				? match
				: `from ${JSON.stringify(resolved)}`;
		});
		writeFileSync(target, moduleText);
	}
	const resultPath = join(temporary, "result.json");
	rmSync(resultPath, { force: true });
	const child = spawnSync(
		process.execPath,
		[
			join(root, "node_modules/vitest/vitest.mjs"),
			"run",
			"--root",
			temporary,
			"--config",
			configPath,
			"--testNamePattern",
			pattern,
			"--reporter=json",
			`--outputFile=${resultPath}`,
		],
		{ cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
	);
	assert.ifError(child.error);
	assert.equal(child.signal, null, `${id}: unexpected signal`);
	const result = JSON.parse(readFileSync(resultPath, "utf8"));
	assert.equal(result.numRuntimeErrorTestSuites ?? 0, 0, `${id}: runtime error`);
	assert.ok(result.numTotalTests > 2, `${id}: no selected tests`);
	const assertions = result.testResults.flatMap((test) => test.assertionResults);
	const failures = assertions.filter((test) => test.status === "failed");
	const executed = assertions.filter(
		(test) => test.status === "passed" || test.status === "failed",
	);
	assert.ok(executed.length > 0);
	assert.ok((result.unhandledErrors ?? []).length === 0, `${id}: unhandled errors`);
	let outcome = "passed";
	if (kind !== "baseline") {
		outcome = failures.length ? "killed" : "survived";
		for (const failure of failures) {
			const message = failure.failureMessages.join("\n");
			const expected =
				kind === "structure"
					? /causal occurrence topology missing (?:source|required) edge/u
					: /AssertionError:|AssertionError\b/u;
			assert.match(
				message,
				expected,
				`${id}: failure did not come from its ${kind} oracle: ${message}`,
			);
		}
	} else assert.equal(child.status, 0, `${id}: baseline failed ${child.stdout}\n${child.stderr}`);
	assert.equal(child.status, failures.length ? 1 : 0, `${id}: invalid process result`);
	return {
		id,
		kind,
		outcome,
		moduleDigest: digest(text),
		executed: executed.length,
		failed: failures.map((failure) => ({
			test: failure.fullName,
			reason: failure.failureMessages.join("\n").split("\n")[0],
		})),
	};
}
try {
	for (const [id, text] of [
		["unchanged", source],
		["behavior-control", behaviorSource],
	]) {
		const result = run(id, text, "baseline");
		report.baseline.push(result);
		process.stdout.write(`${id}: passed\n`);
	}
	for (const mutant of mutants.filter(
		(entry) => !selectedFilter || selectedFilter.test(entry.id),
	)) {
		const text = mutant.change(mutant.kind === "structure" ? source : behaviorSource);
		const result = run(mutant.id, text, mutant.kind);
		report.mutations.push(result);
		process.stdout.write(`${mutant.id}: ${result.outcome}\n`);
	}
	report.complete =
		report.mutations.length === mutants.length &&
		report.mutations.every((result) => result.outcome === "killed");
	assert.equal(
		report.mutations.every((entry) => entry.outcome === "killed"),
		true,
		"Surviving mutants require an oracle or an explicit design disposition",
	);
} finally {
	rmSync(temporary, { recursive: true, force: true });
	assert.equal(existsSync(temporary), false);
	report.cleanup = { temporaryRemoved: true, childProcessesExited: true };
	assert.equal(
		sourceNames.map((name) => marker(name) + readFileSync(join(srcRoot, name), "utf8")).join(""),
		source,
		"Original source changed during qualification",
	);
	assert.equal(
		readFileSync(testPath, "utf8"),
		tests,
		"Original tests changed during qualification",
	);
	if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, "\t")}\n`);
	process.stdout.write(
		`QUALIFICATION_DONE complete=${report.complete} mutations=${report.mutations.length}\n`,
	);
}
