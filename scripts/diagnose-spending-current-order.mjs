/** Private order counterfactual; no product edits, semantic repair, or qualification rerun. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { account, canonical, instrumentNode } from "./diagnose-spending-node-cold.mjs";
import { instrumentShell } from "./diagnose-spending-preset-cold.mjs";

const hash = (b) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const put = (p, r) => writeFileSync(p, `${JSON.stringify(r, null, 2)}\n`);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
export function swapCurrent(source, arm) {
	const file = ts.createSourceFile(
		"order.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const name = arm === "candidate" ? "buildAdmission" : "buildReferencePreset";
	const fn = file.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
	assert.ok(fn?.body, "exact builder required");
	if (arm === "candidate") {
		const stmts = [...fn.body.statements],
			i = stmts.findIndex(
				(s) =>
					ts.isVariableStatement(s) &&
					s.declarationList.declarations[0].name.getText(file) === "currentFacts",
			);
		assert.ok(i >= 0 && ts.isVariableStatement(stmts[i + 1]));
		assert.equal(
			stmts[i + 1].declarationList.declarations[0].name.getText(file),
			"verificationFacts",
		);
		const a = stmts[i],
			b = stmts[i + 1];
		assert.equal(a.end, b.getFullStart());
		const begin = a.getFullStart(),
			mid = a.end,
			end = b.end;
		return (
			source.slice(0, begin) + source.slice(mid, end) + source.slice(begin, mid) + source.slice(end)
		);
	}
	assert.equal(arm, "reference");
	const statement = fn.body.statements.find(
		(s) =>
			ts.isVariableStatement(s) &&
			s.declarationList.declarations[0].name.getText(file) === "current",
	);
	assert.ok(statement);
	const [a, b] = statement.declarationList.declarations;
	assert.equal(b.name.getText(file), "verification");
	const begin = a.getStart(file),
		end = b.end,
		gap = source.slice(a.end, b.getStart(file));
	assert.match(gap, /^,\s*$/);
	return source.slice(0, begin) + b.getText(file) + gap + a.getText(file) + source.slice(end);
}

export function instrumentCore(source) {
	const file = ts.createSourceFile(
		"core.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const cls = file.statements.find((n) => ts.isClassDeclaration(n) && n.name?.text === "NodeCore");
	const method = cls?.members.find(
		(n) => ts.isMethodDeclaration(n) && n.name?.getText(file) === "createSlot",
	);
	assert.ok(method?.body, "exact createSlot required");
	assert.equal(method.parameters[0].name.getText(file), "slot");
	const body = method.body;
	return (
		source.slice(0, body.getStart(file) + 1) +
		"\nconst __coreProbeStart=globalThis.performance.now(); try {\n" +
		source.slice(body.getStart(file) + 1, body.end - 1) +
		"\n} finally {globalThis.__spendingCoreRecord(slot.factory,__coreProbeStart,globalThis.performance.now());}\n" +
		source.slice(body.end - 1)
	);
}
export function instrumentSteps(source, className) {
	const file = ts.createSourceFile(
			"steps.ts",
			source,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		),
		edits = [];
	const cls = file.statements.find((n) => ts.isClassDeclaration(n) && n.name?.text === className);
	assert.ok(cls);
	const wrap = (body, label) => {
		assert.ok(body);
		edits.push(
			{
				at: body.getStart(file) + 1,
				text: `\nconst __stepProbeStart=globalThis.performance.now(); try {\n`,
			},
			{
				at: body.end - 1,
				text: `\n} finally {globalThis.__spendingStepRecord(${JSON.stringify(label)},__stepProbeStart,globalThis.performance.now());}\n`,
			},
		);
	};
	if (className === "Graph") {
		for (const name of ["_nodeOpts", "_addWithId"]) {
			const m = cls.members.find(
				(n) => ts.isMethodDeclaration(n) && n.name?.getText(file) === name,
			);
			wrap(m?.body, name);
		}
		let owned;
		const walk = (n) => {
			if (ts.isPropertyAssignment(n) && n.name?.getText(file) === "createOwned") {
				assert.ok(!owned);
				owned = n.initializer;
			}
			ts.forEachChild(n, walk);
		};
		walk(cls);
		assert.ok(owned && ts.isArrowFunction(owned));
		wrap(owned.body, "createOwned");
	} else {
		assert.equal(className, "Node");
		const m = cls.members.find(ts.isConstructorDeclaration);
		wrap(m?.body, "Node.constructor");
	}
	for (const e of edits.sort((a, b) => b.at - a.at))
		source = source.slice(0, e.at) + e.text + source.slice(e.at);
	return source;
}
const stats = (xs) => {
	const x = [...xs].sort((a, b) => a - b);
	return {
		meanUs: (xs.reduce((a, b) => a + b, 0) / xs.length) * 1000,
		p50Us: x[Math.ceil(x.length * 0.5) - 1] * 1000,
		p95Us: x[Math.ceil(x.length * 0.95) - 1] * 1000,
	};
};
async function run(output, coreProbe = false, stepProbe = false) {
	assert.ok(output && !existsSync(output), "fresh output required");
	mkdirSync(output, { recursive: true });
	try {
		const priorPath =
				"packages/ts/qualification/causal-occurrence/preset-performance-v1/receipt.json",
			prior = read(priorPath);
		assert.equal(hash(readFileSync(prior.rawEvidence.path)), prior.rawEvidence.digest);
		assert.equal(hash(readFileSync(prior.rawEvidence.indexPath)), prior.rawEvidence.indexDigest);
		const input = execFileSync("tar", [
			"-xOzf",
			prior.rawEvidence.path,
			"attempt-01/P2-inputs.json",
		]);
		assert.equal(hash(input), read(prior.rawEvidence.indexPath).files["attempt-01/P2-inputs.json"]);
		writeFileSync(`${output}/P2-inputs.json`, input);
		const snapshot = new Map(
			Object.entries(prior.sourceBindings).map(([p, d]) => {
				const b = readFileSync(p);
				assert.equal(hash(b), d, p);
				return [resolve(p), b];
			}),
		);
		const bundles = {},
			variants = ["original", "swapped"];
		for (const variant of variants) {
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
				write: false,
				metafile: true,
				plugins: [
					{
						name: "order-only-generated-probe",
						setup(b) {
							b.onLoad({ filter: /\.(ts|js|mjs|json)$/ }, (args) => {
								const original = snapshot.get(args.path);
								assert.ok(original, `unbound ${args.path}`);
								let contents = original.toString();
								const p = relative(process.cwd(), args.path);
								if (stepProbe && p === "packages/ts/src/graph/graph.ts")
									contents = instrumentSteps(contents, "Graph");
								if (stepProbe && p === "packages/ts/src/node/node.ts")
									contents = instrumentSteps(contents, "Node");
								if (coreProbe && p === "packages/ts/src/node/core.ts")
									contents = instrumentCore(contents);
								if (p === "packages/ts/src/graph/construction-scope.ts")
									contents = instrumentNode(contents, "ConstructionScope").source;
								if (p === "packages/ts/src/graph/graph.ts")
									contents = instrumentNode(contents, "Graph").source;
								if (p === "scripts/fixtures/spending-preset-performance.ts")
									contents = instrumentShell(contents).source;
								if (variant === "swapped" && p === "examples/spending-alerts/causal-admission.ts")
									contents = swapCurrent(contents, "candidate");
								if (variant === "swapped" && p === "scripts/fixtures/spending-preset-reference.ts")
									contents = swapCurrent(contents, "reference");
								if (contents !== original.toString())
									writeFileSync(`${output}/${variant}-${p.split("/").at(-1)}`, contents);
								return {
									contents,
									loader: p.endsWith(".ts") ? "ts" : p.endsWith(".json") ? "json" : "js",
								};
							});
						},
					},
				],
			});
			writeFileSync(`${output}/${variant}.mjs`, result.outputFiles[0].contents);
			put(`${output}/${variant}-metafile.json`, result.metafile);
			bundles[variant] = hash(result.outputFiles[0].contents);
		}
		for (const [p, b] of snapshot) assert.equal(hash(readFileSync(p)), hash(b));
		const cells = [
				["candidate", "original"],
				["candidate", "swapped"],
				["reference", "original"],
				["reference", "swapped"],
			],
			orders = [
				[0, 1, 2, 3],
				[3, 2, 1, 0],
				[1, 0, 3, 2],
				[2, 3, 0, 1],
			],
			modes = ["off", "summary"];
		const freeze = {
			qualification: false,
			coreProbe,
			stepProbe,
			kind: "adjacent-independent-node-order-counterfactual",
			baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
			cells,
			orders,
			modes,
			warmup: 100,
			measured: 300,
			timeoutMs: 120000,
			bundles,
			sourceBindings: prior.sourceBindings,
			toolBindings: Object.fromEntries(
				[
					"scripts/diagnose-spending-current-order.mjs",
					"scripts/diagnose-spending-node-cold.mjs",
					"scripts/diagnose-spending-preset-cold.mjs",
				].map((p) => [p, hash(readFileSync(p))]),
			),
			priorReceiptDigest: hash(readFileSync(priorPath)),
			limitations: [
				"Both variants instrumented identically; no uninstrumented speed claim",
				"Separate bundles share one process; order/JIT/allocation effects not individually isolated",
				"Only adjacent independent current/verification creation is exchanged; topology and guards retained",
				"Wall time includes pauses; all attempts and samples retained; no historical-cause or qualification claim",
			],
		};
		put(`${output}/freeze.json`, freeze);
		let active;
		globalThis.__spendingStepRecord = (label, start, end) => {
			if (active) active.steps.push({ label, start, end });
		};
		globalThis.__spendingCoreRecord = (factory, start, end) => {
			if (active) active.core.push({ factory, start, end });
		};
		globalThis.__spendingNodeRecord = (kind, id, start, end) => {
			if (active) active.nodes.push({ kind, id, start, end });
		};
		globalThis.__spendingColdMark = (label) => {
			if (active) active.marks.push({ label, at: performance.now() });
		};
		const mods = {},
			tops = {},
			checks = [];
		try {
			for (const v of variants) mods[v] = await import(pathToFileURL(`${output}/${v}.mjs`).href);
			for (const mode of modes)
				for (const variant of variants) {
					checks.push({
						mode,
						variant,
						result: mods[variant].preflight(
							{ id: `order-P2-${mode}-${variant}`, group: "cold", profile: "P2", mode },
							JSON.parse(input),
						),
					});
					put(`${output}/preflight.json`, checks);
					for (const arm of ["candidate", "reference"]) {
						let g;
						try {
							g = mods[variant].graphArm(arm, mode);
							tops[`${mode}/${arm}/${variant}`] = g.graph
								.describe()
								.nodes.map(({ id, factory, deps }) => ({ id, factory, deps }));
						} finally {
							g?.cleanup();
						}
					}
				}
			put(`${output}/preflight.json`, checks);
			put(`${output}/topologies.json`, tops);
			const normalized = (ns, map = false) =>
				ns
					.map((n) => ({
						id: map ? canonical(n.id) : n.id,
						deps: n.deps.map((d) => (map ? canonical(d) : d)),
						...(map ? {} : { factory: n.factory }),
					}))
					.sort((a, b) => a.id.localeCompare(b.id));
			for (const mode of modes) {
				for (const arm of ["candidate", "reference"])
					assert.deepEqual(
						normalized(tops[`${mode}/${arm}/original`]),
						normalized(tops[`${mode}/${arm}/swapped`]),
					);
				assert.deepEqual(
					normalized(tops[`${mode}/candidate/original`], true),
					normalized(tops[`${mode}/reference/original`], true),
				);
			}
			const began = Date.now(),
				samples = [];
			for (const mode of modes)
				for (let batch = 0; batch < 4; batch++)
					for (const cell of orders[batch]) {
						const [arm, variant] = cells[cell],
							expected = tops[`${mode}/${arm}/${variant}`].map((n) => n.id);
						const current =
								arm === "candidate" ? "spending/currentFacts" : "spending/reference/current",
							verification =
								arm === "candidate"
									? "spending/verificationFacts"
									: "spending/reference/verification";
						const originalOrdinal = arm === "candidate" ? 22 : 18,
							ordinal = originalOrdinal + (variant === "swapped" ? 1 : 0);
						assert.equal(expected.indexOf(current) + 1, ordinal, "current creation ordinal");
						assert.equal(
							expected.indexOf(verification) + 1,
							originalOrdinal + (variant === "swapped" ? 0 : 1),
							"verification creation ordinal",
						);
						for (let index = 0; index < 400; index++) {
							assert.ok(Date.now() - began < freeze.timeoutMs, "timeout");
							const s = {
								mode,
								batch,
								arm,
								variant,
								index,
								phase: index < 100 ? "warmup" : "measured",
								nodes: [],
								marks: [],
								core: [],
								steps: [],
							};
							let g;
							try {
								active = s;
								s.start = performance.now();
								g = mods[variant].graphArm(arm, mode);
								s.end = performance.now();
								active = undefined;
								s.accounting = account(s, expected);
								if (stepProbe) {
									const expectedCount = s.nodes.length * 3 + (s.nodes.length - 6);
									assert.equal(s.steps.length, expectedCount, "step coverage");
									for (let j = 0; j < s.nodes.length; j++) {
										const n = s.nodes[j];
										n.steps = {};
										for (const label of [
											"_nodeOpts",
											"_addWithId",
											"Node.constructor",
											...(j < 6 ? [] : ["createOwned"]),
										]) {
											const matches = s.steps.filter(
												(x) => x.label === label && x.start >= n.start && x.end <= n.end,
											);
											assert.equal(matches.length, 1, "one enclosed step per node");
											n.steps[label] = matches[0].end - matches[0].start;
										}
									}
								}

								if (coreProbe) {
									assert.equal(s.core.length, s.nodes.length);
									for (let j = 0; j < s.core.length; j++) {
										const c = s.core[j],
											n = s.nodes[j];
										assert.equal(c.factory ?? "node", tops[`${mode}/${arm}/${variant}`][j].factory);
										assert.ok(c.start >= n.start && c.end <= n.end && c.end >= c.start);
									}
								}
								assert.deepEqual(
									s.nodes.map((n) => n.id),
									expected,
									"actual constructor order",
								);
								appendFileSync(`${output}/samples.jsonl`, `${JSON.stringify(s)}\n`);
								samples.push(s);
							} catch (error) {
								active = undefined;
								put(`${output}/failed-sample.json`, {
									sample: s,
									error: String(error),
									stack: error?.stack,
								});
								throw error;
							} finally {
								active = undefined;
								g?.cleanup();
							}
						}
					}
			const summary = [];
			for (const mode of modes)
				for (let batch = 0; batch < 4; batch++)
					for (const [arm, variant] of cells) {
						const rs = samples.filter(
							(s) =>
								s.mode === mode &&
								s.batch === batch &&
								s.arm === arm &&
								s.variant === variant &&
								s.phase === "measured",
						);
						assert.equal(rs.length, 300);
						summary.push({
							mode,
							batch,
							arm,
							variant,
							total: stats(rs.map((s) => s.accounting.totalMs)),
							nodeTotal: stats(rs.map((s) => s.accounting.nodeMs)),
							residual: stats(rs.map((s) => s.accounting.residualMs)),
							nodes: Object.fromEntries(
								rs[0].nodes.map((n, i) => [
									canonical(n.id),
									{
										ordinal: i + 1,
										...(stepProbe
											? {
													steps: Object.fromEntries(
														Object.keys(n.steps).map((label) => [
															label,
															stats(rs.map((s) => s.nodes[i].steps[label])),
														]),
													),
												}
											: {}),
										...stats(rs.map((s) => s.nodes[i].end - s.nodes[i].start)),
										...(coreProbe
											? { core: stats(rs.map((s) => s.core[i].end - s.core[i].start)) }
											: {}),
									},
								]),
							),
						});
					}
			put(`${output}/summary.json`, summary);
			put(`${output}/completion.json`, {
				completed: true,
				qualification: false,
				samples: samples.length,
				preflights: checks.length,
			});
			console.log("CURRENT_ORDER_DONE", samples.length);
		} finally {
			delete globalThis.__spendingStepRecord;
			delete globalThis.__spendingCoreRecord;
			delete globalThis.__spendingNodeRecord;
			delete globalThis.__spendingColdMark;
		}
	} catch (error) {
		put(`${output}/attempt-failure.json`, { error: String(error), stack: error?.stack });
		throw error;
	}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await run(
		process.argv[2] && resolve(process.argv[2]),
		process.argv.includes("--core"),
		process.argv.includes("--steps"),
	);
