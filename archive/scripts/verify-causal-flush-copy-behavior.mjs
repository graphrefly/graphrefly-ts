/** Deterministic baseline/candidate transition and alias differential; no timing claims. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2]);
const replay = process.argv[3] === "replay";
const saved = replay ? JSON.parse(readFileSync(resolve(root, "receipt.json"))) : undefined;
if (!replay) mkdirSync(root, { recursive: false });
const target = "packages/ts/src/solutions/causal-occurrence/transition.ts";
const original = replay
		? ""
		: execFileSync("git", ["show", `4f7edccb:${target}`], { encoding: "utf8" }),
	currentSource = replay ? "" : readFileSync(target, "utf8");
let current = currentSource;
const mutation = replay ? "baseline" : (process.argv[3] ?? "baseline");
assert.ok(["baseline", "skip-refresh", "force-unchanged", "share-gap-evidence"].includes(mutation));
if (mutation !== "baseline") {
	const patch =
		mutation === "skip-refresh"
			? ["refreshProjections();", "void 0;"]
			: mutation === "force-unchanged"
				? ["if (!changed)", "if (true)"]
				: [
						"evidenceRef: { ...current.gapRef.evidenceRef }",
						"evidenceRef: current.gapRef.evidenceRef",
					];
	assert.equal(current.split(patch[0]).length, 2);
	current = current.replace(patch[0], patch[1]);
}
const sha = (b) => createHash("sha256").update(b).digest("hex"),
	modules = {};
for (const [name, contents] of [
	["before", original],
	["after", current],
]) {
	if (replay) {
		const path = resolve(root, name + ".mjs");
		assert.equal(sha(readFileSync(path)), saved.bundles[name]);
		modules[name] = await import(pathToFileURL(path).href);
		continue;
	}
	const { build } = await import("esbuild");
	const b = await build({
		stdin: {
			contents: `export { transitionCausalAuthority } from './${target}'; export { causalOccurrenceDigest,refKey } from './packages/ts/src/solutions/causal-occurrence/identity.ts';`,
			resolveDir: process.cwd(),
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		plugins: [
			{
				name: "exact-transition",
				setup(api) {
					api.onLoad({ filter: /causal-occurrence\/transition\.ts$/ }, () => ({
						contents,
						loader: "ts",
						resolveDir: resolve(target, ".."),
					}));
				},
			},
		],
	});
	const path = resolve(root, name + ".mjs");
	writeFileSync(path, b.outputFiles[0].contents);
	modules[name] = await import(pathToFileURL(path).href);
}
function ordered(value) {
	if (value instanceof Map) return { map: [...value].map(([k, v]) => [ordered(k), ordered(v)]) };
	if (value instanceof Set) return { set: [...value].map(ordered) };
	if (Array.isArray(value)) return value.map(ordered);
	if (value !== null && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ordered(v)]));
	return value;
}
function aliases(r) {
	return r.outputs.flatMap((f) => {
		if (f.kind === "currentness") {
			const stored = r.state.currentness.get(modules.before.refKey(f.value.occurrence));
			return [
				[
					f.kind,
					stored === f.value,
					stored?.occurrence === f.value.occurrence,
					stored?.gapRef === f.value.gapRef,
					stored?.gapRef?.evidenceRef === f.value.gapRef?.evidenceRef,
				],
			];
		}
		if (f.kind === "quiescence") {
			const stored = r.state.quiescence.get(f.value.revisionDomain);
			return [
				[
					f.kind,
					stored === f.value,
					stored?.pendingOccurrenceRefs === f.value.pendingOccurrenceRefs,
					stored?.pendingEffectIds === f.value.pendingEffectIds,
					stored?.pendingOccurrenceRefs.map((v, i) => v === f.value.pendingOccurrenceRefs[i]),
				],
			];
		}
		return [];
	});
}
let steps = 0;
const kinds = new Set();
for (let seed = 1; seed <= 200; seed++) {
	let rng = seed;
	const rand = (n) => {
		rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
		return rng % n;
	};
	const opts = {
		requiredBranches: ["a", "b"],
		requiredEvidenceKinds: ["proof"],
		maxOccurrences: 1 + (seed % 7),
		maxPending: 1 + (seed % 9),
		maxEffects: 1 + (seed % 4),
		maxEvidence: 1 + (seed % 5),
	};
	const facts = [];
	for (let d = 0; d < 3; d++)
		for (let revision = 1; revision <= 3; revision++) {
			const material = {
				revisionDomain: `d${d}`,
				occurrenceId: `o${revision % 2}`,
				revision,
				sourceRefs: [{ kind: "input", id: `${d}-${revision}` }],
				value: { seed, revision },
			};
			const occurrence = { ...material, digest: modules.before.causalOccurrenceDigest(material) },
				proposal = {
					occurrence,
					effectId: `e${d}-${revision}`,
					requestRef: { kind: "request", id: `r${d}-${revision}` },
					proposalDigest: `sha256:${"a".repeat(64)}`,
				};
			const admission = {
				...proposal,
				state: "admitted",
				admissionRef: { kind: "admission", id: `a${d}-${revision}` },
			};
			for (const [lane, value] of [
				["occurrences", occurrence],
				[
					"admissions",
					{
						occurrence,
						state: rand(4) ? "admitted" : "rejected",
						decisionId: `d${revision}`,
						decisionDigest: `sha256:${"b".repeat(64)}`,
					},
				],
				["watermarks", { revisionDomain: `d${d}`, revision }],
				[
					"branch-terminals",
					{ occurrence, branch: "a", state: "completed", result: { kind: "ok", value: 1 } },
				],
				[
					"branch-terminals",
					{ occurrence, branch: "b", state: "completed", result: { kind: "ok", value: 2 } },
				],
				["effect-proposals", proposal],
				["effect-admissions", admission],
				["effect-outcomes", { ...admission, state: "succeeded", result: { kind: "ok", value: 3 } }],
				[
					"evidence",
					{
						occurrence,
						evidenceId: `proof${revision}`,
						evidenceKind: "proof",
						evidenceDigest: `sha256:${"c".repeat(64)}`,
						coverage: "included",
					},
				],
			])
				facts.push({ lane, values: [value] });
		}
	facts.push(...facts.slice(0, 12));
	if (seed % 3)
		for (let i = facts.length - 1; i > 0; i--) {
			const j = rand(i + 1);
			[facts[i], facts[j]] = [facts[j], facts[i]];
		}
	let a, b;
	const run = (arrivals) => {
		const left = modules.before.transitionCausalAuthority(a, arrivals, opts),
			right = modules.after.transitionCausalAuthority(b, arrivals, opts);
		assert.deepEqual(right, left, `seed${seed} step${steps}`);
		assert.deepEqual(ordered(right.state), ordered(left.state), `collection order seed${seed}`);
		assert.deepEqual(aliases(right), aliases(left), `aliases seed${seed}`);
		for (const f of left.outputs) kinds.add(f.kind);
		a = left.state;
		b = right.state;
		steps++;
	};
	while (facts.length) {
		run(facts.splice(0, 1 + rand(4)));
		if (rand(4) === 0) run([]);
		if (rand(11) === 0) {
			a = structuredClone(a);
			b = structuredClone(b);
		}
	}
	run([]);
}
const report = {
	passed: true,
	mutation,
	traces: 200,
	transitionComparisons: steps,
	orderedOutputsAndState: true,
	projectionAliases: true,
	outputKinds: [...kinds].sort(),
	beforeSource: replay ? saved.beforeSource : sha(original),
	afterSource: replay ? saved.afterSource : sha(current),
	bundles: Object.fromEntries(
		["before", "after"].map((n) => [n, sha(readFileSync(resolve(root, n + ".mjs")))]),
	),
};
if (replay) assert.deepEqual(report, saved);
else writeFileSync(resolve(root, "receipt.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
