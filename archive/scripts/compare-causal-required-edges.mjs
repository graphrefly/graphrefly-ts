/** A2 differential: execute the frozen and current actual pure helper/checker functions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
assert.ok(
	outputIndex >= 0 && process.argv[outputIndex + 1],
	"--output requires a fresh evidence path",
);
const digest = (x) => `sha256:${createHash("sha256").update(x).digest("hex")}`;
const frozenPath = "packages/ts/qualification/causal-occurrence/ts-v7-helper-inputs.json";
const sourcePath = "packages/ts/src/solutions/causal-occurrence.ts";
const frozen = JSON.parse(readFileSync(resolve(root, frozenPath), "utf8"));
assert.equal(
	frozen.receiptDigest,
	digest(
		readFileSync(resolve(root, "packages/ts/qualification/causal-occurrence/ts-v7-receipt.json")),
	),
);
const previous = frozen.files[sourcePath];
assert.equal(digest(previous.text), previous.digest);
assert.equal(
	JSON.parse(
		readFileSync(
			resolve(root, "packages/ts/qualification/causal-occurrence/ts-v7-receipt.json"),
			"utf8",
		),
	).files[sourcePath],
	previous.digest,
);
const currentPath = "packages/ts/src/solutions/causal-occurrence/construction.ts";
const current = readFileSync(resolve(root, currentPath), "utf8");
const symbols = ["causalOccurrenceRequiredEdges", "assertCausalOccurrenceTopology"];
async function actualFunctions(source, label) {
	const ast = ts.createSourceFile(label + ".ts", source, ts.ScriptTarget.Latest, true);
	const functions = ast.statements.filter(
		(s) => ts.isFunctionDeclaration(s) && symbols.includes(s.name?.text),
	);
	assert.equal(functions.length, 2);
	const text = functions.map((s) => s.getText(ast)).join("\n");
	const js = ts.transpileModule(text, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
		reportDiagnostics: true,
	});
	assert.equal(js.diagnostics?.length ?? 0, 0);
	return {
		module: await import(
			`data:text/javascript;base64,${Buffer.from(js.outputText + "\n// " + label).toString("base64")}`
		),
		digest: digest(text),
	};
}
const baseline = await actualFunctions(previous.text, "frozen-ts-v7");
const candidate = await actualFunctions(current, "a2");
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
function execute(module, seed, mode, addedView = false) {
	const name = ["causal", "__proto__", "域/🌳", "a\0b", "a|b::c->d", ""][seed % 6];
	const access = [],
		identities = [];
	const edge = (from, to, index) => {
		const value = {
			from,
			get to() {
				access.push(`to:${index}`);
				if (mode === "to-throw" && index === 2) throw new RangeError("edge failure");
				return to;
			},
		};
		identities.push(value);
		return value;
	};
	const edges = lanes.map((lane, i) => edge("source/" + i, `${name}/input/${lane}`, i));
	edges.push(
		edge("duplicate", `${name}/input/occurrences`, 8),
		edges[0],
		edge("noise", "unrelated", 10),
	);
	for (let i = 0; i < Math.floor(seed / 6); i++)
		edges.push(edge(`extra/${i}`, `unrelated/${seed}/${i}`, 20 + i));
	for (let i = 0; i < seed % 7; i++) edges.push(edges.shift());
	if (seed % 2) edges.reverse();
	if (mode === "sparse") {
		edges.length += 3;
		delete edges[1];
	}
	let reads = 0;
	const description =
		mode === "omitted"
			? undefined
			: {
					get edges() {
						access.push(`edges:${reads++}`);
						if (mode === "edges-throw" && reads === 3) throw new TypeError("description failure");
						if (mode === "changing")
							return [edge("changing/" + reads, `${name}/input/${lanes[reads - 1]}`, 100 + reads)];
						return mode === "empty" ? [] : edges;
					},
				};
	let helper;
	try {
		let result = module.causalOccurrenceRequiredEdges(name, description);
		if (addedView) {
			assert.deepEqual(result.at(-1), {
				from: `${name}/authority`,
				to: `${name}/committed-effects`,
			});
			result = Object.freeze(result.slice(0, -1));
		}
		// Record identity without reading accessor properties a second time.
		helper = {
			frozen: Object.isFrozen(result),
			sources: result.slice(0, -21).map((e) => identities.indexOf(e)),
			internal: result.slice(-21),
		};
	} catch (e) {
		helper = { error: [e.constructor.name, e.message] };
	}
	const helperAccess = [...access];
	const allInternal = module.causalOccurrenceRequiredEdges(name);
	const internal = addedView ? allInternal.slice(0, -1) : allInternal;
	const a = module.causalOccurrenceRequiredEdges(name),
		b = module.causalOccurrenceRequiredEdges(name);
	assert.notEqual(a, b);
	assert.notEqual(a[0], b[0]);
	assert.ok(Object.isFrozen(a));
	const complete = [
		...lanes.map((lane, i) => ({ from: "source/" + i, to: `${name}/input/${lane}` })),
		...internal,
	];
	const outcomes = [];
	for (let remove = -1; remove < complete.length; remove++) {
		const snapshot = {
			edges: complete.filter((_, i) => i !== remove && (remove < 0 || i !== remove + 1)).reverse(),
		};
		try {
			module.assertCausalOccurrenceTopology(
				addedView ? { edges: [...snapshot.edges, allInternal.at(-1)] } : snapshot,
				name,
			);
			outcomes.push("accepted");
		} catch (e) {
			outcomes.push([e.constructor.name, e.message]);
		}
	}
	if (addedView)
		assert.throws(
			() => module.assertCausalOccurrenceTopology({ edges: complete }, name),
			/committed-effects/,
		);
	return { helper, helperAccess, outcomes };
}
const cases = [];
for (let seed = 0; seed < 24; seed++)
	for (const mode of [
		"ordinary",
		"sparse",
		"omitted",
		"empty",
		"changing",
		"edges-throw",
		"to-throw",
	]) {
		const before = execute(baseline.module, seed, mode),
			after = execute(candidate.module, seed, mode, true);
		assert.deepEqual(after, before, `${seed}:${mode}`);
		cases.push({ seed, mode, matched: true, baseline: before, candidate: after });
	}
writeFileSync(
	resolve(process.argv[outputIndex + 1]),
	JSON.stringify(
		{
			schema: "task-differential/causal-required-edges/v1",
			passed: true,
			sourceDigest: digest(current),
			frozenSourceDigest: previous.digest,
			frozenArchiveDigest: digest(readFileSync(resolve(root, frozenPath))),
			runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
			extractedFunctions: { baseline: baseline.digest, candidate: candidate.digest },
			boundary:
				"Actual helper/checker declarations compiled from receipt-bound source; original helper/checker behavior with separately asserted D163 added edge; finite pure-function differential, not full runtime or independent business verification. Primitive string names only.",
			cases,
		},
		null,
		2,
	) + "\n",
);
console.log(`REQUIRED_EDGES_DIFFERENTIAL_DONE cases=${cases.length}`);
