/** Independent static source check. Does not import the generator or business modules. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const parse = (s) => {
	const t = ts.createSourceFile("static.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	assert.equal(t.parseDiagnostics.length, 0, "valid syntax");
	return t;
};
const texts = (s) => {
	const t = parse(s);
	return t.statements.map((n) => n.getText(t));
};
// Deliberately independent expected prefixes: structural comparison against raw source,
// not an assertion about the generator's manifest or a regenerated candidate.
const expectedPrefix = `assert.deepEqual(config.row, {id:"cold-P2-summary",group:"cold",profile:"P2",mode:"summary"});
assert.equal(config.control, true);
assert.ok(Array.isArray(modules) && modules.length === 2 && modules[0] !== modules[1]);
const coordinates = {"S00":{"referenceModule":0,"preflightOrder":[0,1],"orders":[["candidate","reference"],["reference","candidate"],["candidate","reference"]]},"S01":{"referenceModule":0,"preflightOrder":[0,1],"orders":[["candidate","reference"],["reference","candidate"],["reference","candidate"]]},"S10":{"referenceModule":0,"preflightOrder":[0,1],"orders":[["candidate","reference"],["candidate","reference"],["candidate","reference"]]},"S11":{"referenceModule":0,"preflightOrder":[0,1],"orders":[["candidate","reference"],["candidate","reference"],["reference","candidate"]]}};
assert.ok(Object.hasOwn(coordinates, config.diagnostic.cell));
const diagnostic = {cell:config.diagnostic.cell,...coordinates[config.diagnostic.cell]};
assert.deepEqual(config.diagnostic, diagnostic);
assert.equal(config.copyModule, new URL(diagnostic.referenceModule === 0 ? "worker-copy.mjs" : "worker.mjs", import.meta.url).href);
const originalRecipe = {"revision":"spending-preset-performance-v1","coldRows":12,"steadyRows":60,"recoveryRows":12,"warmup":100,"measured":300,"orders":[["candidate","reference"],["reference","candidate"],["candidate","reference"]],"coldLimit":1.2,"steadyLimit":1.1,"recoveryCycles":20,"stopAfterFailedRow":true,"childTimeoutMs":900000,"totalTimeoutMs":7200000,"freshBasis":"distinct evaluation identities absent before the whole wave","doubleData":"two exact copies of the same arrival frame in one source.down; second copy is intra-wave replay","memory":"raw process heap/RSS before and after action; GC may make deltas negative, not retained-size proof"};
assert.deepEqual(modules[0].RECIPE, originalRecipe);
assert.deepEqual(modules[1].RECIPE, originalRecipe);
const RECIPE = {...modules[0].RECIPE, orders:diagnostic.orders};`;
const expectedSetup = `const makeArm = (arm, mode) => modules[arm === "reference" ? diagnostic.referenceModule : 1-diagnostic.referenceModule].measurementArm("reference", mode);
const checked3 = modules[diagnostic.preflightOrder[0]].preflight(row, scenario);
put("preflight-first.json", {module:diagnostic.preflightOrder[0],pid:process.pid});
assert.deepEqual(modules[diagnostic.preflightOrder[1]].preflight(row, scenario), checked3, "identical-copy semantic preflight");
put("preflight-order.json", {...diagnostic,pid:process.pid});`;
const expectedHeader = `import assert from "node:assert/strict";
import {appendFileSync,readFileSync,writeFileSync} from "node:fs";
import {performance as performance2} from "node:perf_hooks";
import {setImmediate} from "node:timers/promises";
const graphSnapshot = () => { throw new Error("unsupported non-cold branch"); };`;
export function check(original, derived) {
	assert.equal(hash(original), "d9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2");
	const a = parse(original),
		b = parse(derived);
	assert.equal(b.statements.length, 8, "no extra top-level business or effects");
	assert.deepEqual(
		b.statements.slice(0, 5).map((n) => n.getText(b)),
		texts(expectedHeader),
	);
	const fn = (t, name) => {
		const found = t.statements.filter((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
		assert.equal(found.length, 1, name);
		return found[0];
	};
	for (const name of ["schedule", "cleanupAll"])
		assert.equal(fn(a, name).getText(a), fn(b, name).getText(b), name);
	const old = fn(a, "runRow"),
		fresh = fn(b, "runRow");
	assert.deepEqual(
		fresh.parameters.map((n) => n.getText(b)),
		["configPath", "modules"],
	);
	assert.deepEqual(
		fresh.modifiers.map((n) => n.kind),
		[ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.AsyncKeyword],
	);
	assert.equal(fresh.asteriskToken, undefined, "not a generator");
	const oldText = old.body.statements.map((n) => n.getText(a));
	assert.equal(oldText.length, 16);
	const expected = [
		oldText[0],
		...texts(expectedPrefix),
		oldText[1],
		oldText[2],
		...texts(expectedSetup),
		...oldText.slice(7),
	];
	assert.deepEqual(
		fresh.body.statements.map((n) => n.getText(b)),
		expected,
		"exact whitelist; timer/loop/record/cleanup preserved",
	);
	return {
		kind: "independent-block-source-check-v1",
		valid: true,
		originalDigest: hash(original),
		derivedDigest: hash(derived),
		unchangedLoopDigest: hash(oldText[13]),
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
