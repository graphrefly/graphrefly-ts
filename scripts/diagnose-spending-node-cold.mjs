/** Private generated-copy node construction probe. Never a qualification estimator. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { instrumentShell } from "./diagnose-spending-preset-cold.mjs";

const hash = (b) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const put = (p, x) => writeFileSync(p, `${JSON.stringify(x, null, 2)}\n`);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
export const pairs = {
	selection: "evaluationSelections",
	transaction: "transaction",
	moments: "vendorStats",
	profile: "userProfile",
	policy: "policy",
	current: "currentFacts",
	verification: "verificationFacts",
	local: "localFacts",
	inbox: "inboxFacts",
	score: "anomalyScore",
	gate: "thresholdGate",
	reason: "reasonFactors",
	message: "alertMessage",
	assessment: "assessment",
	material: "requestMaterials",
	store: "materialStore",
	snapshot: "materialSnapshot",
	proposals: "effectProposals",
	permission: "publicationPolicy",
	occurrences: "occurrences",
	occurrenceAdmissions: "occurrenceAdmissions",
	terminals: "branchTerminals",
	effectAdmissions: "effectAdmissions",
	outcomes: "effectOutcomes",
	evidence: "evidence",
	watermarks: "watermarks",
	issues: "consumerIssues",
	summary: "diagnosticSummary",
};
export function canonical(id) {
	if (!id.startsWith("spending/reference/")) return id;
	const short = id.slice("spending/reference/".length);
	assert.ok(Object.hasOwn(pairs, short), `unmapped reference node ${id}`);
	return `spending/${pairs[short]}`;
}
export function instrumentNode(source, className) {
	const file = ts.createSourceFile(
		"probe.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const classes = file.statements.filter(
		(s) => ts.isClassDeclaration(s) && s.name?.text === className,
	);
	assert.equal(classes.length, 1, "exact class required");
	const methods = classes[0].members.filter(
		(s) => ts.isMethodDeclaration(s) && s.name?.getText(file) === "node",
	);
	assert.equal(methods.length, 1, "exact node method required");
	const body = methods[0].body;
	assert.ok(body);
	assert.equal(methods[0].parameters[2]?.name.getText(file), "opts");
	assert.ok(!source.includes("__nodeProbeStart"), "probe identifier collision");
	const begin = "\nconst __nodeProbeStart = globalThis.performance.now(); try {\n";
	const end = `\n} finally { globalThis.__spendingNodeRecord(${JSON.stringify(className)}, opts.name, __nodeProbeStart, globalThis.performance.now()); }\n`;
	return {
		source:
			source.slice(0, body.getStart(file) + 1) +
			begin +
			source.slice(body.getStart(file) + 1, body.end - 1) +
			end +
			source.slice(body.end - 1),
		begin,
		end,
	};
}
export function account(sample, expected) {
	assert.ok(
		Number.isFinite(sample.start) && Number.isFinite(sample.end) && sample.end >= sample.start,
	);
	assert.equal(sample.nodes.length, expected.length, "complete node coverage");
	const ids = sample.nodes.map((n) => n.id);
	assert.equal(new Set(ids).size, ids.length, "duplicate node identity");
	assert.deepEqual([...ids].sort(), [...expected].sort(), "node identity mismatch");
	let prev = sample.start,
		nodeMs = 0;
	for (const n of sample.nodes) {
		assert.ok(
			Number.isFinite(n.start) &&
				Number.isFinite(n.end) &&
				n.start >= prev &&
				n.end >= n.start &&
				n.end <= sample.end,
			"overlap or invalid node interval",
		);
		nodeMs += n.end - n.start;
		prev = n.end;
	}
	assert.equal(sample.marks.length, 10, "shell boundary coverage");
	const marks = [
		{ label: "shell-entry", at: sample.start },
		...sample.marks,
		{ label: "end", at: sample.end },
	];
	assert.equal(new Set(marks.map((m) => m.label)).size, marks.length, "duplicate stage label");
	const stages = {};
	let prior = sample.start;
	for (let i = 0; i < marks.length - 1; i++) {
		const a = marks[i],
			b = marks[i + 1];
		assert.ok(a.at >= prior && b.at >= a.at && b.at <= sample.end);
		prior = b.at;
		const inside = sample.nodes.filter((n) => n.start >= a.at && n.end <= b.at);
		const crossed = sample.nodes.filter(
			(n) => n.start < b.at && n.end > a.at && !inside.includes(n),
		);
		assert.equal(crossed.length, 0, "node crosses shell boundary");
		const attributed = inside.reduce((s, n) => s + n.end - n.start, 0);
		stages[a.label] = {
			totalMs: b.at - a.at,
			nodeMs: attributed,
			residualMs: b.at - a.at - attributed,
		};
	}
	for (const [key, expectedTotal] of [
		["totalMs", sample.end - sample.start],
		["nodeMs", nodeMs],
		["residualMs", sample.end - sample.start - nodeMs],
	]) {
		assert.ok(
			Math.abs(Object.values(stages).reduce((n, s) => n + s[key], 0) - expectedTotal) < 1e-7,
			"stage reconciliation",
		);
	}
	return {
		totalMs: sample.end - sample.start,
		nodeMs,
		residualMs: sample.end - sample.start - nodeMs,
		stages,
	};
}
const stats = (xs) => {
	const a = [...xs].sort((a, b) => a - b);
	return {
		meanMs: a.reduce((x, y) => x + y, 0) / a.length,
		p50Ms: a[Math.ceil(a.length * 0.5) - 1],
		p95Ms: a[Math.ceil(a.length * 0.95) - 1],
	};
};
async function run(output) {
	assert.ok(output && !existsSync(output), "fresh output directory required");
	mkdirSync(output, { recursive: true });
	const base = "packages/ts/qualification/causal-occurrence/";
	const prior = read(`${base}preset-performance-v1/receipt.json`);
	assert.equal(hash(readFileSync(prior.rawEvidence.path)), prior.rawEvidence.digest);
	assert.equal(hash(readFileSync(prior.rawEvidence.indexPath)), prior.rawEvidence.indexDigest);
	const oldIndex = read(prior.rawEvidence.indexPath).files;
	const scenarioBytes = execFileSync("tar", [
		"-xOzf",
		prior.rawEvidence.path,
		"attempt-01/P2-inputs.json",
	]);
	assert.equal(hash(scenarioBytes), oldIndex["attempt-01/P2-inputs.json"]);
	writeFileSync(`${output}/P2-inputs.json`, scenarioBytes);
	const snapshot = new Map(
		Object.entries(prior.sourceBindings).map(([p, d]) => {
			const b = readFileSync(p);
			assert.equal(hash(b), d, p);
			return [resolve(p), b];
		}),
	);
	const bundles = {};
	for (const variant of ["control", "probe"]) {
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
					name: "frozen-node-diagnostic",
					setup(b) {
						b.onLoad({ filter: /\.(ts|js|mjs|json)$/ }, (args) => {
							const original = snapshot.get(args.path);
							assert.ok(original, `unbound source ${args.path}`);
							let contents = original.toString();
							const p = relative(process.cwd(), args.path);
							if (variant === "probe") {
								if (p === "packages/ts/src/graph/construction-scope.ts")
									contents = instrumentNode(contents, "ConstructionScope").source;
								if (p === "packages/ts/src/graph/graph.ts")
									contents = instrumentNode(contents, "Graph").source;
								if (p === "scripts/fixtures/spending-preset-performance.ts")
									contents = instrumentShell(contents).source;
								if (contents !== original.toString())
									writeFileSync(`${output}/${p.split("/").at(-1)}.diagnostic.ts`, contents);
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
		writeFileSync(`${output}/${variant}.mjs`, result.outputFiles[0].contents);
		put(`${output}/${variant}-metafile.json`, result.metafile);
		bundles[variant] = hash(result.outputFiles[0].contents);
	}
	for (const [p, b] of snapshot) assert.equal(hash(readFileSync(p)), hash(b), "post-build drift");
	const cells = [
		["candidate", "control"],
		["candidate", "probe"],
		["reference", "control"],
		["reference", "probe"],
	];
	// Rotate and reverse positions across four batches; every cell occupies every ordinal once.
	const orders = [
		[0, 1, 2, 3],
		[3, 2, 1, 0],
		[1, 0, 3, 2],
		[2, 3, 0, 1],
	];
	const freeze = {
		qualification: false,
		baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
		modes: ["off", "summary"],
		cells,
		orders,
		warmup: 100,
		measured: 300,
		timeoutMs: 120000,
		bundles,
		sourceBindings: prior.sourceBindings,
		toolBindings: Object.fromEntries(
			["scripts/diagnose-spending-node-cold.mjs", "scripts/diagnose-spending-preset-cold.mjs"].map(
				(p) => [p, hash(readFileSync(p))],
			),
		),
		pairs,
		priorReceiptDigest: hash(readFileSync(`${base}preset-performance-v1/receipt.json`)),
		limits: [
			"Generated wrapper, clocks and collection can change JIT/GC; no per-node overhead subtraction",
			"Control/probe have separate module/runtime instances in the same process; shared process load is uncontrolled",
			"Node timers cover node method only, not caller option preparation or business execution",
			"No historical-cause proof or formal qualification rerun",
		],
	};
	put(`${output}/freeze.json`, freeze);
	let active,
		unrecorded = 0;
	globalThis.__spendingNodeRecord = (kind, id, start, end) => {
		if (active) active.nodes.push({ kind, id, start, end });
		else unrecorded++;
	};
	globalThis.__spendingColdMark = (label) => {
		if (active) active.marks.push({ label, at: performance.now() });
	};
	const mods = {};
	for (const variant of ["control", "probe"])
		mods[variant] = await import(pathToFileURL(`${output}/${variant}.mjs`).href);
	const checks = [],
		topologies = {};
	for (const mode of freeze.modes)
		for (const variant of ["control", "probe"]) {
			checks.push({
				mode,
				variant,
				result: mods[variant].preflight(
					{ id: `node-P2-${mode}-${variant}`, group: "cold", profile: "P2", mode },
					JSON.parse(scenarioBytes),
				),
			});
			for (const arm of ["candidate", "reference"]) {
				let g;
				try {
					g = mods[variant].graphArm(arm, mode);
					const desc = g.graph.describe();
					const nodes = desc.nodes.map((n) => ({
						id: n.id,
						factory: n.factory,
						deps: desc.edges.filter((e) => e.to === n.id).map((e) => e.from),
					}));
					topologies[`${mode}/${variant}/${arm}`] = nodes;
				} finally {
					g?.cleanup();
				}
			}
		}
	put(`${output}/preflight.json`, checks);
	put(`${output}/topologies.json`, topologies);
	for (const mode of freeze.modes) {
		for (const arm of ["candidate", "reference"])
			assert.deepEqual(topologies[`${mode}/control/${arm}`], topologies[`${mode}/probe/${arm}`]);
		const normalized = (arm) =>
			topologies[`${mode}/probe/${arm}`]
				.map((n) => ({ id: canonical(n.id), deps: n.deps.map(canonical).sort() }))
				.sort((a, b) => a.id.localeCompare(b.id));
		assert.deepEqual(
			normalized("candidate"),
			normalized("reference"),
			"explicit map must preserve all actual edges",
		);
	}
	const samples = [],
		began = Date.now();
	try {
		for (const mode of freeze.modes)
			for (let batch = 0; batch < orders.length; batch++)
				for (const cell of orders[batch]) {
					const [arm, variant] = cells[cell],
						expected = topologies[`${mode}/${variant}/${arm}`].map((n) => n.id);
					for (let index = 0; index < 400; index++) {
						assert.ok(Date.now() - began < freeze.timeoutMs, "diagnostic timeout");
						let g;
						const sample = {
							mode,
							batch,
							arm,
							variant,
							index,
							phase: index < 100 ? "warmup" : "measured",
							nodes: [],
							marks: [],
						};
						try {
							active = variant === "probe" ? sample : undefined;
							sample.start = performance.now();
							g = mods[variant].graphArm(arm, mode);
							sample.end = performance.now();
							active = undefined;
							sample.accounting =
								variant === "probe"
									? account(sample, expected)
									: { totalMs: sample.end - sample.start };
							appendFileSync(`${output}/samples.jsonl`, `${JSON.stringify(sample)}\n`);
							samples.push(sample);
						} catch (error) {
							active = undefined;
							put(`${output}/failed-sample.json`, {
								sample,
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
	} finally {
		delete globalThis.__spendingNodeRecord;
		delete globalThis.__spendingColdMark;
	}
	const summary = [];
	for (const mode of freeze.modes)
		for (let batch = 0; batch < 4; batch++)
			for (const [arm, variant] of cells) {
				const rows = samples.filter(
					(s) =>
						s.mode === mode &&
						s.batch === batch &&
						s.arm === arm &&
						s.variant === variant &&
						s.phase === "measured",
				);
				assert.equal(rows.length, 300);
				summary.push({
					mode,
					batch,
					arm,
					variant,
					total: stats(rows.map((s) => s.accounting.totalMs)),
					...(variant === "probe"
						? {
								nodeTotal: stats(rows.map((s) => s.accounting.nodeMs)),
								residual: stats(rows.map((s) => s.accounting.residualMs)),
								nodes: Object.fromEntries(
									rows[0].nodes.map((n) => [
										canonical(n.id),
										stats(
											rows.map((s) => {
												const v = s.nodes.find((x) => x.id === n.id);
												return v.end - v.start;
											}),
										),
									]),
								),
								stages: Object.fromEntries(
									Object.keys(rows[0].accounting.stages).map((k) => [
										k,
										Object.fromEntries(
											["totalMs", "nodeMs", "residualMs"].map((v) => [
												v,
												stats(rows.map((s) => s.accounting.stages[k][v])),
											]),
										),
									]),
								),
							}
						: {}),
				});
			}
	put(`${output}/summary.json`, summary);
	put(`${output}/completion.json`, {
		completed: true,
		qualification: false,
		samples: samples.length,
		preflightChecks: checks.length,
		unrecordedOutsideMeasurements: unrecorded,
	});
	console.log("NODE_COLD_DIAGNOSTIC_DONE", samples.length);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await run(process.argv[2] && resolve(process.argv[2]));
