import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute actual adapted runRow with deterministic injected dependencies, no performance sampling.
const original = readFileSync("scripts/fixtures/spending-preset-performance-worker.ts", "utf8");
const adapted = original
	.replaceAll("measurementArm(arm, row.mode)", "measure(arm, row.mode)")
	.replace(
		"const checked = preflight(row, scenario);",
		'const measure = (arm: Arm, mode: "off" | "summary") => measurementArm((config as typeof config & { identicalReference: boolean }).identicalReference && arm === "candidate" ? "reference" : arm, mode);\n\tconst checked = preflight(row, scenario);',
	);
const tree = ts.createSourceFile("worker.ts", adapted, ts.ScriptTarget.Latest, true);
const fn = tree.statements
	.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "runRow")
	.getText(tree)
	.replace("export async", "async");
const js = ts.transpileModule(fn, {
	compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
let cases = 0;
for (const row of [
	{ id: "cold", group: "cold" },
	...["duplicate", "all-new", "one-new"].map((change) => ({ id: change, group: "steady", change })),
	{ id: "recovery", group: "recovery" },
])
	for (const identicalReference of [false, true]) {
		let t = 0,
			preflights = 0;
		const values = [],
			creates = [],
			cleans = [];
		const config = {
			row: { ...row, mode: "summary" },
			output: "out",
			scenarioPath: "scenario",
			identicalReference,
		};
		const make = (arm) => {
			creates.push(arm);
			const counts = { assessment: 1, publication: 1, startup: 1 };
			return {
				graph: {},
				counts,
				send() {},
				disconnect() {},
				connect() {
					for (const k in counts) counts[k]++;
				},
				cleanup() {
					cleans.push(arm);
				},
			};
		};
		const run = new Function(
			"assert",
			"readFileSync",
			"writeFileSync",
			"appendFileSync",
			"preflight",
			"schedule",
			"measurementArm",
			"RECIPE",
			"setImmediate",
			"performance",
			"process",
			"graphSnapshot",
			"cleanupAll",
			"console",
			js + ";return runRow;",
		)(
			assert,
			(p) => JSON.stringify(p === "config" ? config : {}),
			() => {},
			(_p, line) => values.push(JSON.parse(line)),
			() => {
				preflights++;
				return { passed: true };
			},
			() => ({ before: [{}], action: [{}] }),
			make,
			{
				orders: [
					["candidate", "reference"],
					["reference", "candidate"],
					["candidate", "reference"],
				],
				warmup: 100,
				measured: 300,
				recoveryCycles: 20,
			},
			async () => {},
			{ now: () => ++t },
			{ version: "fake", pid: 1, uptime: () => 0, memoryUsage: () => ({ rss: 1 }) },
			() => ({}),
			(runs) => {
				for (const r of runs) r?.cleanup();
			},
			{ log() {} },
		);
		await run("config");
		assert.equal(preflights, 1);
		assert.deepEqual(cleans.sort(), creates.sort());
		assert.equal(values.length, row.group === "recovery" ? 40 : 3600);
		const per =
			row.group === "cold" || row.change === "all-new" || row.change === "one-new"
				? 1200
				: row.group === "recovery"
					? 1
					: 3;
		assert.equal(creates.filter((a) => a === "candidate").length, identicalReference ? 0 : per);
		assert.equal(
			creates.filter((a) => a === "reference").length,
			identicalReference ? 2 * per : per,
		);
		assert.equal(creates.filter((a) => a === "plain").length, row.group === "recovery" ? 0 : per);
		cases++;
	}
console.log("COVERAGE_LOADED_ADAPTER_PASS", cases);
