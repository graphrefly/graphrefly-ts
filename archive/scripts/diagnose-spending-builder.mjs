/** Generated-copy-only decomposition of both consumer builders; no qualification estimator. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const hash = (x) => `sha256:${createHash("sha256").update(x).digest("hex")}`;
const put = (p, x) => writeFileSync(p, `${JSON.stringify(x, null, 2)}\n`);
function instrument(source, name) {
	const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
		fn = file.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
	assert.ok(fn?.body);
	const edits = [],
		labels = [];
	for (const [i, statement] of [...fn.body.statements].entries()) {
		const vars = ts.isVariableStatement(statement)
			? statement.declarationList.declarations.map((d) => d.name.getText(file))
			: [];
		let label;
		if (i === 0) label = "binding-and-input-validation";
		else if (vars.includes(name === "buildSpendingPresetNodes" ? "edges" : "nodes"))
			label = "business-material-admission-nodes";
		else if (vars.includes(name === "buildSpendingPresetNodes" ? "causalBinding" : "publication"))
			label = "publication-and-causal-nodes";
		else if (vars.includes(name === "buildSpendingPresetNodes" ? "consumerIssues" : "issues"))
			label = "view-capability-summary";
		else if (ts.isForOfStatement(statement) && statement.expression.getText(file) === "edges")
			label = "topology-checks";
		else if (ts.isReturnStatement(statement)) label = "return-bundle";
		if (label) {
			labels.push(label);
			edits.push({
				at: statement.getStart(file),
				text: `globalThis.__spendingBuilderMark(${JSON.stringify(label)});\n`,
			});
		}
	}
	assert.deepEqual(labels, [
		"binding-and-input-validation",
		"business-material-admission-nodes",
		"publication-and-causal-nodes",
		"view-capability-summary",
		"topology-checks",
		"return-bundle",
	]);
	edits.push(
		{ at: fn.body.getStart(file) + 1, text: "try {" },
		{ at: fn.body.end - 1, text: '} finally { globalThis.__spendingBuilderMark("end"); }' },
	);
	for (const edit of edits.sort((a, b) => b.at - a.at))
		source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
	return source;
}
const output = process.argv[2] && resolve(process.argv[2]),
	first = process.argv[3] && resolve(process.argv[3]);
assert.ok(output && first && !existsSync(output));
mkdirSync(output, { recursive: true });
const prior = JSON.parse(
	readFileSync(
		"packages/ts/qualification/causal-occurrence/preset-performance-v1/receipt.json",
		"utf8",
	),
);
for (const [p, d] of Object.entries(prior.sourceBindings)) assert.equal(hash(readFileSync(p)), d);
const indexBytes = readFileSync(prior.rawEvidence.indexPath);
assert.equal(hash(indexBytes), prior.rawEvidence.indexDigest);
const fixtureBytes = readFileSync(`${first}/P2-inputs.json`);
assert.equal(hash(fixtureBytes), JSON.parse(indexBytes).files["attempt-01/P2-inputs.json"]);
writeFileSync(`${output}/P2-inputs.json`, fixtureBytes);
const bindings = {},
	transforms = {
		"examples/spending-alerts/causal-preset.ts": "buildSpendingPresetNodes",
		"scripts/fixtures/spending-preset-reference.ts": "buildReferencePreset",
	};
const result = await build({
	stdin: {
		contents:
			'export {graphArm} from "./scripts/fixtures/spending-preset-performance.ts"; export {preflight} from "./scripts/fixtures/spending-preset-performance-worker.ts";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	metafile: true,
	write: false,
	plugins: [
		{
			name: "diagnostic-builder-stages",
			setup(build) {
				build.onLoad({ filter: /\.(ts|js|mjs|json)$/ }, (args) => {
					const p = relative(process.cwd(), args.path);
					let contents = readFileSync(args.path, "utf8");
					assert.equal(hash(contents), prior.sourceBindings[p], `load drift ${p}`);
					bindings[p] = hash(contents);
					if (transforms[p]) {
						contents = instrument(contents, transforms[p]);
						writeFileSync(`${output}/${transforms[p]}.diagnostic.ts`, contents);
					}
					return {
						contents,
						loader: p.endsWith(".ts") ? "ts" : p.endsWith(".json") ? "json" : "js",
					};
				});
			},
		},
	],
});
for (const [p, d] of Object.entries(bindings)) assert.equal(hash(readFileSync(p)), d);
writeFileSync(`${output}/worker.mjs`, result.outputFiles[0].contents);
put(`${output}/metafile.json`, result.metafile);
const recipe = {
	qualification: false,
	kind: "inclusive-builder-decomposition",
	modes: ["off", "summary"],
	orders: [
		["candidate", "reference"],
		["reference", "candidate"],
		["candidate", "reference"],
	],
	warmup: 100,
	measured: 300,
	timeoutMs: 120000,
	sourceBindings: bindings,
	scriptDigest: hash(readFileSync("scripts/diagnose-spending-builder.mjs")),
	bundleDigest: hash(result.outputFiles[0].contents),
	limitations: [
		"Includes marker overhead",
		"Phase boundaries are explicitly mapped across independently structured builders",
		"Inclusive stage p95s are not additive",
		"No historical failure attribution or new qualification result",
	],
};
put(`${output}/freeze.json`, recipe);
const mod = await import(pathToFileURL(`${output}/worker.mjs`).href),
	scenario = JSON.parse(fixtureBytes);
let marks = [];
globalThis.__spendingBuilderMark = (label) => marks.push({ label, at: performance.now() });
const checks = [];
for (const mode of recipe.modes)
	checks.push(
		mod.preflight({ id: `builder-P2-${mode}`, group: "cold", profile: "P2", mode }, scenario),
	);
put(`${output}/preflight.json`, checks);
const samples = [],
	begin = Date.now();
for (const mode of recipe.modes)
	for (let batch = 0; batch < 3; batch++)
		for (const arm of recipe.orders[batch])
			for (let index = 0; index < 400; index++) {
				assert.ok(Date.now() - begin < recipe.timeoutMs, "diagnostic timeout");
				marks = [];
				let run;
				try {
					run = mod.graphArm(arm, mode);
					assert.equal(marks.length, 7);
					const stages = marks
						.slice(0, -1)
						.map((m, i) => ({ label: m.label, ms: marks[i + 1].at - m.at }));
					const sample = {
						mode,
						batch,
						arm,
						index,
						phase: index < 100 ? "warmup" : "measured",
						stages,
					};
					samples.push(sample);
					appendFileSync(`${output}/samples.jsonl`, `${JSON.stringify(sample)}\n`);
				} finally {
					run?.cleanup();
				}
			}
delete globalThis.__spendingBuilderMark;
const summary = [];
for (const mode of recipe.modes)
	for (const arm of ["candidate", "reference"])
		for (const batch of [0, 1, 2]) {
			const rows = samples.filter(
				(s) => s.mode === mode && s.arm === arm && s.batch === batch && s.phase === "measured",
			);
			summary.push({
				mode,
				arm,
				batch,
				stages: Object.fromEntries(
					rows[0].stages.map(({ label }, i) => {
						const values = rows.map((s) => s.stages[i].ms).sort((a, b) => a - b);
						return [
							label,
							{
								meanMs: values.reduce((a, b) => a + b, 0) / values.length,
								p50Ms: values[149],
								p95Ms: values[284],
							},
						];
					}),
				),
			});
		}
put(`${output}/summary.json`, summary);
put(`${output}/completion.json`, {
	completed: true,
	qualification: false,
	samples: samples.length,
});
console.log("BUILDER_DIAGNOSTIC_DONE", samples.length);
