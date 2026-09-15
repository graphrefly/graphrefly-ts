/** Private source derivation. Never imports or executes the business bundle. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "file:///Users/davidchenallio/src/graphrefly-ts/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js";

export const sha = (s) => createHash("sha256").update(s).digest("hex");
const LOCKS = {
	runRow: "c36a27e4a40aaae9cec16aea83a5bfa9db5afff04ddd184eb392838645eec5a3",
	schedule: "20db86119f6367133cb1534d3d94c9606d8a764801d8176c2fcbc4475c66063a",
	cleanupAll: "512a11336f9831c67126edc36b62e214c29e5817be759788a9fbb2eda369d782",
};
const guard = `assert.deepEqual(config.row, {id:"cold-P2-summary",group:"cold",profile:"P2",mode:"summary"});
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
const setup = `const makeArm = (arm, mode) => modules[arm === "reference" ? diagnostic.referenceModule : 1-diagnostic.referenceModule].measurementArm("reference", mode);
const checked3 = modules[diagnostic.preflightOrder[0]].preflight(row, scenario);
put("preflight-first.json", {module:diagnostic.preflightOrder[0],pid:process.pid});
assert.deepEqual(modules[diagnostic.preflightOrder[1]].preflight(row, scenario), checked3, "identical-copy semantic preflight");
put("preflight-order.json", {...diagnostic,pid:process.pid});`;
const header = `import assert from "node:assert/strict";
import {appendFileSync,readFileSync,writeFileSync} from "node:fs";
import {performance as performance2} from "node:perf_hooks";
import {setImmediate} from "node:timers/promises";
const graphSnapshot = () => { throw new Error("unsupported non-cold branch"); };`;

export function derive(source) {
	assert.equal(
		sha(source),
		"d72fff7041885588d92de6ce2d193e339aa36621a45fe4a4645964943055a99b",
		"original bundle",
	);
	const tree = ts.createSourceFile(
		"worker.mjs",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	assert.equal(tree.parseDiagnostics.length, 0);
	const functions = {};
	for (const [name, digest] of Object.entries(LOCKS)) {
		const nodes = tree.statements.filter(
			(n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
		);
		assert.equal(nodes.length, 1, name);
		assert.equal(sha(nodes[0].getText(tree)), digest, name);
		functions[name] = nodes[0];
	}
	const body = functions.runRow.body.statements.map((n) => n.getText(tree));
	assert.equal(body.length, 16);
	const statements = [body[0], guard, body[1], body[2], setup, ...body.slice(7)];
	const output = `${header}\n${functions.schedule.getText(tree)}\n${functions.cleanupAll.getText(tree)}\nexport async function runRow(configPath, modules) {\n${statements.join("\n")}\n}\n`;
	return {
		output,
		manifest: {
			kind: "block-driver-source-derivation-v1",
			originalDigest: sha(source),
			derivedDigest: sha(output),
			functionDigests: LOCKS,
			unchangedStatementIndices: [0, 1, 2, 7, 8, 9, 10, 11, 12, 13, 14, 15],
			replacedStatementIndices: [3, 4, 5, 6],
			changes: [
				"parameter/modules guards and bounded orders recipe copy",
				"two external factories and ordered preflight",
				"cold-only closure guard",
			],
			parserVersion: ts.version,
		},
	};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assert.equal(process.argv.length, 5, "usage: source output manifest");
	const { output, manifest } = derive(readFileSync(process.argv[2], "utf8"));
	writeFileSync(process.argv[3], output, { flag: "wx" });
	writeFileSync(process.argv[4], `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
}
