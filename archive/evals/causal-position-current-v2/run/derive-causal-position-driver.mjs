/** D169 private cold driver derivation; source parsing only. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "file:///Users/davidchenallio/src/graphrefly-ts/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js";
import { derive as originalDerive, sha } from "./derive-causal-block-driver.mjs";

const header =
	'import assert from "node:assert/strict";\nimport {appendFileSync,readFileSync,writeFileSync} from "node:fs";\nimport {performance as performance2} from "node:perf_hooks";\nimport {setImmediate} from "node:timers/promises";\nconst graphSnapshot = () => { throw new Error("unsupported non-cold branch"); };';
const guard =
	'assert.deepEqual(config.row, {id:"cold-P2-summary",group:"cold",profile:"P2",mode:"summary"});\nassert.ok(["control","main","mutation","plain"].includes(config.kind));\nassert.equal(config.control, config.kind === "control");\nassert.ok(Array.isArray(modules) && modules.length === 2 && modules[0] !== modules[1]);\nconst orders = {U:[["candidate","reference"],["reference","candidate"],["candidate","reference"]],V:[["reference","candidate"],["candidate","reference"],["reference","candidate"]],P:[["plain"],["plain"],["plain"]]};\nassert.ok(Object.hasOwn(orders,config.orientation));\nassert.equal(config.orientation === "P", config.kind === "plain");\nconst originalRecipe = {"revision":"spending-preset-performance-v1","coldRows":12,"steadyRows":60,"recoveryRows":12,"warmup":100,"measured":300,"orders":[["candidate","reference"],["reference","candidate"],["candidate","reference"]],"coldLimit":1.2,"steadyLimit":1.1,"recoveryCycles":20,"stopAfterFailedRow":true,"childTimeoutMs":900000,"totalTimeoutMs":7200000,"freshBasis":"distinct evaluation identities absent before the whole wave","doubleData":"two exact copies of the same arrival frame in one source.down; second copy is intra-wave replay","memory":"raw process heap/RSS before and after action; GC may make deltas negative, not retained-size proof"};\nassert.deepEqual(modules[0].RECIPE,originalRecipe);\nassert.deepEqual(modules[1].RECIPE,originalRecipe);\nconst RECIPE = {...originalRecipe,orders:orders[config.orientation]};';
const factory =
	'export function makeFactory(modules,kind) {\n  assert.ok(["control","main","mutation","plain"].includes(kind));\n  assert.ok(Array.isArray(modules) && modules.length === 2 && modules[0] !== modules[1]);\n  return (arm,mode) => {\n    assert.ok(["candidate","reference","plain"].includes(arm));\n    const slot = arm === "candidate" ? 1 : 0;\n    const selected = arm === "plain" ? "plain" : arm === "candidate" && kind === "main" ? "candidate" : "reference";\n    if (kind === "mutation" && arm === "candidate") {\n      const extra = modules[slot].measurementArm(selected,mode);\n      cleanupAll([extra]);\n    }\n    return modules[slot].measurementArm(selected,mode);\n  };\n}';
const setup =
	'const makeArm = makeFactory(modules,config.kind);\nconst checked3 = modules[0].preflight(row,scenario);\nput("preflight-first.json",{module:0,pid:process.pid});\nif (config.kind !== "plain") assert.deepEqual(modules[1].preflight(row,scenario),checked3,"two-module semantic preflight");\nput("preflight-order.json",{modules:config.kind === "plain" ? [0] : [0,1],pid:process.pid});';
const oldArms =
	'const arms = [...RECIPE.orders[batch2], ...row.group === "recovery" || config.control ? [] : ["plain"]];';
const newArms = "const arms = RECIPE.orders[batch2];";
export function derive(source) {
	const baseline = originalDerive(source); // verifies exact immutable business/function hashes
	const tree = ts.createSourceFile(
		"worker.mjs",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	const fn = (name) =>
		tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
	const body = fn("runRow").body.statements.map((n) => n.getText(tree));
	assert.equal(body[13].split(oldArms).length, 2, "single arm schedule boundary");
	const loop = body[13].replace(oldArms, newArms);
	const output =
		[
			header,
			fn("schedule").getText(tree),
			fn("cleanupAll").getText(tree),
			factory,
			"export async function runRow(configPath, modules) {",
			body[0],
			guard,
			body[1],
			body[2],
			setup,
			...body.slice(7, 13),
			loop,
			...body.slice(14),
			"}",
		].join("\n") + "\n";
	return {
		output,
		manifest: {
			kind: "cold-position-pairs-v3-source",
			originalDigest: sha(source),
			derivedDigest: sha(output),
			functionDigests: baseline.manifest.functionDigests,
			parserVersion: ts.version,
		},
	};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assert.equal(process.argv.length, 5);
	const { output, manifest } = derive(readFileSync(process.argv[2], "utf8"));
	writeFileSync(process.argv[3], output, { flag: "wx" });
	writeFileSync(process.argv[4], JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
}
