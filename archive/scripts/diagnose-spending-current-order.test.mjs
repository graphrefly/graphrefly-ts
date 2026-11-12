import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import {
	instrumentCore,
	instrumentSteps,
	swapCurrent,
} from "./diagnose-spending-current-order.mjs";

test("real transforms preserve all builder declaration bodies, exchanging only current and verification", () => {
	for (const [arm, path, fnName] of [
		["candidate", "examples/spending-alerts/causal-admission.ts", "buildAdmission"],
		["reference", "scripts/fixtures/spending-preset-reference.ts", "buildReferencePreset"],
	]) {
		const original = readFileSync(path, "utf8"),
			changed = swapCurrent(original, arm);
		const parts = (s) => {
			const f = ts.createSourceFile("x.ts", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
			const fn = f.statements.find((x) => ts.isFunctionDeclaration(x) && x.name?.text === fnName);
			return {
				decls: fn.body.statements
					.flatMap((x) =>
						ts.isVariableStatement(x)
							? x.declarationList.declarations.map((d) => d.getText(f))
							: [],
					)
					.sort(),
				other: fn.body.statements
					.filter((x) => !ts.isVariableStatement(x))
					.map((x) => x.getText(f)),
				outside: f.statements.filter((x) => x !== fn).map((x) => x.getText(f)),
			};
		};
		assert.deepEqual(parts(changed), parts(original));
		assert.equal(changed.length, original.length);
	}
});
test("executable counterfactual changes acquisition order but preserves returned values", () => {
	for (const arm of ["candidate", "reference"]) {
		const name = arm === "candidate" ? "buildAdmission" : "buildReferencePreset";
		const decl =
			arm === "candidate"
				? 'const currentFacts = record("current"); const verificationFacts = record("verification"); return {currentFacts,verificationFacts};'
				: 'const current = record("current"), verification = record("verification"), local = record("local"); return {current,verification,local};';
		const source = `function ${name}(record) { ${decl} }`,
			trace = [];
		const run = (s) =>
			new Function(`${ts.transpile(s)};return ${name};`)()((x) => {
				trace.push(x);
				return x;
			});
		const a = run(source);
		trace.length = 0;
		const b = run(swapCurrent(source, arm));
		assert.deepEqual(a, b);
		assert.deepEqual(trace.slice(0, 2), ["verification", "current"]);
	}
});
test("missing or nonadjacent construction declarations fail closed", () => {
	assert.throws(() => swapCurrent("function other(){}", "candidate"));
	assert.throws(() =>
		swapCurrent(
			"function buildAdmission(){ const currentFacts = 1; const local = 2; const verificationFacts=3; }",
			"candidate",
		),
	);
	assert.throws(() =>
		swapCurrent(
			"function buildReferencePreset(){ const current=1, local=2, verification=3; }",
			"reference",
		),
	);
});

test("core wrapper preserves return and records a nested interval", () => {
	const s = "class NodeCore { createSlot(slot,state) { return {id:21,slot}; } }";
	const c = instrumentCore(s),
		records = [];
	globalThis.__spendingCoreRecord = (...r) => records.push(r);
	try {
		const C = new Function(`${ts.transpile(c)};return NodeCore;`)();
		const slot = { factory: "test" };
		assert.deepEqual(new C().createSlot(slot, {}), { id: 21, slot });
		assert.equal(records.length, 1);
		assert.equal(records[0][0], "test");
		assert.ok(records[0][2] >= records[0][1]);
	} finally {
		delete globalThis.__spendingCoreRecord;
	}
	assert.throws(() => instrumentCore("class Other{}"));
});

test("historical step probes preserve their frozen bytes and reject the D167 Graph shape", () => {
	const dir = "packages/ts/qualification/causal-occurrence/preset-current-order-v1";
	const receipt = JSON.parse(readFileSync(`${dir}/receipt.json`, "utf8"));
	const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
	assert.equal(sha(readFileSync(receipt.rawEvidence.path)), receipt.rawEvidence.digest);
	const extract = (name) =>
		execFileSync("tar", ["-xOzf", receipt.rawEvidence.path, name], { encoding: "utf8" });
	assert.equal(sha(readFileSync(receipt.rawEvidence.indexPath)), receipt.rawEvidence.indexDigest);
	const index = JSON.parse(readFileSync(receipt.rawEvidence.indexPath, "utf8"));
	const strip = (source) =>
		source
			.replace(/\nconst __stepProbeStart=globalThis\.performance\.now\(\); try \{\n/g, "")
			.replace(
				/\n\} finally \{globalThis\.__spendingStepRecord\("[^"]+",__stepProbeStart,globalThis\.performance\.now\(\)\);\}\n/g,
				"",
			);
	for (const [file, cls, count] of [
		["packages/ts/src/graph/graph.ts", "Graph", 3],
		["packages/ts/src/node/node.ts", "Node", 1],
	]) {
		const frozenInstrumented = extract(`steps-01/original-${cls.toLowerCase()}.ts`);
		const original = strip(frozenInstrumented);
		assert.equal(sha(frozenInstrumented), index.files[`steps-01/original-${cls.toLowerCase()}.ts`]);
		const result = instrumentSteps(original, cls);
		assert.equal((result.match(/const __stepProbeStart=/g) || []).length, count);
		assert.equal(strip(result), original);
		assert.equal(result, frozenInstrumented);
	}
	assert.throws(() =>
		instrumentSteps(readFileSync("packages/ts/src/graph/graph.ts", "utf8"), "Graph"),
	);
});
