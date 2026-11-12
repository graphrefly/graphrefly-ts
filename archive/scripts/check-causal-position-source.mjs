/** Independent source whitelist; never imports derivation or executes business. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const parse = (s) => {
	const t = ts.createSourceFile("x.mjs", s, 99, true, ts.ScriptKind.JS);
	assert.equal(t.parseDiagnostics.length, 0);
	return t;
};
const texts = (s) => {
	const t = parse(s);
	return t.statements.map((n) => n.getText(t));
};
const expectedHeader =
	'import assert from "node:assert/strict";\nimport {appendFileSync,readFileSync,writeFileSync} from "node:fs";\nimport {performance as performance2} from "node:perf_hooks";\nimport {setImmediate} from "node:timers/promises";\nconst graphSnapshot = () => { throw new Error("unsupported non-cold branch"); };';
const expectedGuard =
	'assert.deepEqual(config.row, {id:"cold-P2-summary",group:"cold",profile:"P2",mode:"summary"});\nassert.ok(["control","main","mutation","plain"].includes(config.kind));\nassert.equal(config.control, config.kind === "control");\nassert.ok(Array.isArray(modules) && modules.length === 2 && modules[0] !== modules[1]);\nconst orders = {U:[["candidate","reference"],["reference","candidate"],["candidate","reference"]],V:[["reference","candidate"],["candidate","reference"],["reference","candidate"]],P:[["plain"],["plain"],["plain"]]};\nassert.ok(Object.hasOwn(orders,config.orientation));\nassert.equal(config.orientation === "P", config.kind === "plain");\nconst originalRecipe = {"revision":"spending-preset-performance-v1","coldRows":12,"steadyRows":60,"recoveryRows":12,"warmup":100,"measured":300,"orders":[["candidate","reference"],["reference","candidate"],["candidate","reference"]],"coldLimit":1.2,"steadyLimit":1.1,"recoveryCycles":20,"stopAfterFailedRow":true,"childTimeoutMs":900000,"totalTimeoutMs":7200000,"freshBasis":"distinct evaluation identities absent before the whole wave","doubleData":"two exact copies of the same arrival frame in one source.down; second copy is intra-wave replay","memory":"raw process heap/RSS before and after action; GC may make deltas negative, not retained-size proof"};\nassert.deepEqual(modules[0].RECIPE,originalRecipe);\nassert.deepEqual(modules[1].RECIPE,originalRecipe);\nconst RECIPE = {...originalRecipe,orders:orders[config.orientation]};';
const expectedFactory =
	'export function makeFactory(modules,kind) {\n  assert.ok(["control","main","mutation","plain"].includes(kind));\n  assert.ok(Array.isArray(modules) && modules.length === 2 && modules[0] !== modules[1]);\n  return (arm,mode) => {\n    assert.ok(["candidate","reference","plain"].includes(arm));\n    const slot = arm === "candidate" ? 1 : 0;\n    const selected = arm === "plain" ? "plain" : arm === "candidate" && kind === "main" ? "candidate" : "reference";\n    if (kind === "mutation" && arm === "candidate") {\n      const extra = modules[slot].measurementArm(selected,mode);\n      cleanupAll([extra]);\n    }\n    return modules[slot].measurementArm(selected,mode);\n  };\n}';
const expectedSetup =
	'const makeArm = makeFactory(modules,config.kind);\nconst checked3 = modules[0].preflight(row,scenario);\nput("preflight-first.json",{module:0,pid:process.pid});\nif (config.kind !== "plain") assert.deepEqual(modules[1].preflight(row,scenario),checked3,"two-module semantic preflight");\nput("preflight-order.json",{modules:config.kind === "plain" ? [0] : [0,1],pid:process.pid});';
export function check(original, derived) {
	assert.equal(hash(original), "d9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2");
	const a = parse(original),
		b = parse(derived);
	const fn = (t, name) => {
		const found = t.statements.filter((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
		assert.equal(found.length, 1);
		return found[0];
	};
	assert.equal(b.statements.length, 9, "no extra top-level code");
	assert.deepEqual(
		b.statements.slice(0, 5).map((n) => n.getText(b)),
		texts(expectedHeader),
	);
	for (const name of ["schedule", "cleanupAll"])
		assert.equal(fn(a, name).getText(a), fn(b, name).getText(b));
	assert.deepEqual(texts(fn(b, "makeFactory").getText(b)), texts(expectedFactory));
	const f = fn(b, "runRow"),
		originalBody = fn(a, "runRow").body.statements.map((n) => n.getText(a));
	assert.equal(originalBody.length, 16);
	assert.deepEqual(
		f.parameters.map((n) => n.getText(b)),
		["configPath", "modules"],
	);
	assert.deepEqual(
		f.modifiers.map((n) => n.kind),
		[ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.AsyncKeyword],
	);
	assert.equal(f.asteriskToken, undefined);
	const statements = f.body.statements.map((n) => n.getText(b));
	const prefix = [
		originalBody[0],
		...texts(expectedGuard),
		originalBody[1],
		originalBody[2],
		...texts(expectedSetup),
		...originalBody.slice(7, 13),
	];
	assert.deepEqual(statements.slice(0, prefix.length), prefix);
	assert.equal(statements.length, prefix.length + 3);
	const oldLoop = fn(a, "runRow").body.statements[13],
		newLoop = f.body.statements[prefix.length];
	assert.ok(ts.isForStatement(oldLoop) && ts.isForStatement(newLoop));
	// Permit exactly the arms declaration to differ; invert it then compare the complete loop bytes.
	const decl = newLoop.statement.statements[0];
	assert.equal(decl.getText(b), "const arms = RECIPE.orders[batch2];");
	const restored = newLoop
		.getText(b)
		.replace(decl.getText(b), oldLoop.statement.statements[0].getText(a));
	assert.equal(restored, oldLoop.getText(a), "unchanged timing/record/cleanup loop");
	assert.deepEqual(statements.slice(-2), originalBody.slice(14));
	return {
		kind: "independent-cold-position-source-v3",
		valid: true,
		originalDigest: hash(original),
		derivedDigest: hash(derived),
		originalLoopDigest: hash(originalBody[13]),
		parserVersion: ts.version,
		parserDigest: hash(readFileSync(createRequire(import.meta.url).resolve("typescript"))),
	};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assert.equal(process.argv.length, 4);
	console.log(
		JSON.stringify(
			check(readFileSync(process.argv[2], "utf8"), readFileSync(process.argv[3], "utf8")),
			null,
			2,
		),
	);
}
