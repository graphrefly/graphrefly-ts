import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, ".."),
	dir = path.join(root, "packages/ts/src/solutions/causal-occurrence");
const source = readFileSync(path.join(dir, "identity.ts"), "utf8");
async function load(text) {
	const r = await build({
		stdin: {
			contents:
				'export { currentnessChanged, canonicalSnapshot, dataKey, causalOccurrenceDigest } from "./identity.ts"; export { transitionCausalAuthority } from "./transition.ts";',
			resolveDir: dir,
			sourcefile: "private-currentness-test.ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		plugins: [
			{
				name: "private-test-export",
				setup(b) {
					b.onLoad({ filter: /\/causal-occurrence\/identity\.ts$/ }, () => ({
						contents: text + "\nexport { currentnessChanged };",
						loader: "ts",
					}));
				},
			},
		],
	});
	return import(
		"data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64")
	);
}

function cases(m) {
	const o = m.canonicalSnapshot({
		revisionDomain: "d",
		occurrenceId: "o",
		revision: 1,
		digest: "sha256:" + "a".repeat(64),
		sourceRefs: [{ kind: "input", id: "x" }],
		value: { large: "x".repeat(8192) },
	});
	const record = (state = "current", n = 1) => ({
		kind: "causal-currentness",
		occurrence: o,
		evaluatedThroughRevision: n,
		state,
	});
	const capture = (fn) => {
		try {
			return { value: fn() };
		} catch (e) {
			return { error: e.constructor.name, message: e.message };
		}
	};
	let count = 0;
	function check(a, b) {
		assert.deepEqual(
			capture(() => m.currentnessChanged(a, b, o)),
			capture(() => m.dataKey(a) !== m.dataKey(b)),
		);
		count++;
	}
	for (const a of ["current", "stale", "superseded", "unverifiable"])
		for (const b of ["current", "stale", "superseded", "unverifiable"])
			for (const n of [0, 1, 2]) check(record(a), record(b, n));
	for (const n of [-0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
		check(record(), record("current", n));
	check(record("current", -0), record("current", 0));
	for (const field of ["kind", "occurrence", "evaluatedThroughRevision", "state"]) {
		const a = record();
		delete a[field];
		check(a, record());
	}
	for (const field of ["missingRevision", "gapRef", "supersededBy", "extra"]) {
		const a = { ...record(), [field]: field === "supersededBy" ? o : { reason: "gap" } };
		check(a, record());
		check(a, { ...a });
	}
	check({ ...record(), occurrence: structuredClone(o) }, record());
	check({ ...record(), occurrence: { ...o, value: "changed" } }, record());
	check({ ...record(), occurrence: { ...o, sourceRefs: [] } }, record());
	check({ ...record(), kind: "other" }, record());
	check(Object.assign(Object.create(null), record()), record());
	let reads = 0;
	const a = record();
	Object.defineProperty(a, "occurrence", {
		get() {
			reads++;
			return o;
		},
		enumerable: true,
	});
	check(a, record());
	assert.equal(reads, 0);
	const symbol = record();
	symbol[Symbol("hidden")] = 1;
	check(symbol, record());
	const hidden = record();
	Object.defineProperty(hidden, "extra", { value: 1 });
	check(hidden, record());
	const nonenum = record();
	Object.defineProperty(nonenum, "state", { value: "current", enumerable: false });
	check(nonenum, record());
	// Eligible pairs should reach the metadata comparison without serializing payload.
	const metaSource = source.replace(
		"return dataKey(before) !== dataKey(after);",
		'throw new Error("fast-path-reached");',
	);
	return { count, record, o, metaSource };
}
const m = await load(source);
const { count, record, o, metaSource } = cases(m);
const tracer = await load(metaSource);
assert.throws(() => tracer.currentnessChanged(record(), record(), o), /fast-path-reached/);
const old = await load(
	source.replace(
		"currentnessChanged(prior, value, occurrence))",
		"(dataKey(prior) !== dataKey(value)))",
	),
);
const opts = {
	requiredBranches: ["done"],
	requiredEvidenceKinds: ["proof"],
	maxOccurrences: 8,
	maxPending: 8,
	maxEffects: 8,
	maxEvidence: 8,
};
function scenario(mod) {
	const raw = {
		revisionDomain: "d",
		occurrenceId: "o",
		revision: 1,
		sourceRefs: [{ kind: "input", id: "x" }],
		value: { payload: "x".repeat(1024) },
	};
	const occurrence = { ...raw, digest: mod.causalOccurrenceDigest(raw) };
	const ref = { ...occurrence };
	delete ref.value;
	const admission = {
		occurrence: ref,
		decisionId: "admit",
		decisionDigest: "sha256:" + "b".repeat(64),
		state: "admitted",
	};
	const laterRaw = { ...raw, occurrenceId: "later", revision: 3 };
	const later = { ...laterRaw, digest: mod.causalOccurrenceDigest(laterRaw) };
	const middleRaw = { ...raw, occurrenceId: "middle", revision: 2 };
	const middle = { ...middleRaw, digest: mod.causalOccurrenceDigest(middleRaw) };
	const conflictRaw = { ...raw, value: "conflict" };
	const conflict = { ...conflictRaw, digest: mod.causalOccurrenceDigest(conflictRaw) };
	const stream = [
		{ lane: "occurrences", values: [occurrence] },
		{ lane: "admissions", values: [admission] },
		{ lane: "watermarks", values: [{ revisionDomain: "d", revision: 1 }] },
		{ lane: "occurrences", values: [occurrence] },
		{ lane: "occurrences", values: [structuredClone(occurrence)] },
		{ lane: "occurrences", values: [{ ...occurrence, value: "conflict" }] },
		{ lane: "watermarks", values: [{ revisionDomain: "d", revision: 2 }] },
		{ lane: "occurrences", values: [later] },
		{ lane: "occurrences", values: [middle] },
		{ lane: "occurrences", values: [later] },
		{ lane: "occurrences", values: [structuredClone(later)] },
		{ lane: "occurrences", values: [conflict] },
		{
			lane: "admissions",
			values: [middle, later].map(({ value, ...occurrence }) => ({
				...admission,
				occurrence,
				decisionId: occurrence.occurrenceId,
			})),
		},
		{ lane: "watermarks", values: [{ revisionDomain: "d", revision: 3 }] },
		{ lane: "occurrences", values: [later] },
	];
	let state;
	const outputs = [];
	for (const [index, a] of stream.entries()) {
		const r = mod.transitionCausalAuthority(state, [a], opts);
		state = r.state;
		outputs.push(r.outputs);
		if (index === 7) assert.equal(state.pending.size, 1, "future occurrence retained");
		if (index >= 8) {
			assert.equal(state.pending.size, 0, "pending occurrence promoted");
			assert.equal(state.highWaterByDomain.get("d"), 3);
		}
	}
	assert.match(JSON.stringify(outputs[5]), /causal-occurrence\/digest-mismatch/);
	assert.match(JSON.stringify(outputs[11]), /causal-occurrence\/replay-conflict/);
	return { state, outputs };
}
assert.deepEqual(scenario(m), scenario(old));
assert.throws(() => scenario(tracer), /fast-path-reached/);
const mutations = [
	[
		"drop-watermark",
		(s) =>
			s.replace(
				"evaluatedThroughRevision: fields.evaluatedThroughRevision.value,",
				"evaluatedThroughRevision: 0,",
			),
	],
	["drop-state", (s) => s.replace("state: fields.state.value,", 'state: "current",')],
	[
		"drop-occurrence-guard",
		(s) => s.replace("fields.occurrence.value !== occurrence ||", "false ||"),
	],
	[
		"allow-extra",
		(s) =>
			s
				.replace("keys.length !== 4 ||", "false ||")
				.replace('key === "state",', 'key === "state" || key === "extra",'),
	],
	[
		"digest-only",
		(s) =>
			s.replace(
				"return dataKey(prior) !== dataKey(value);",
				"return prior.occurrence?.digest !== value.occurrence?.digest;",
			),
	],
	["skip-fallback", (s) => s.replace("return dataKey(prior) !== dataKey(value);", "return false;")],
	[
		"lost-currentness",
		(s) =>
			s.replace(
				"if (prior === undefined || currentnessChanged(prior, value, occurrence))",
				"if (false)",
			),
	],
];
const caught = [];
for (const [name, mutate] of mutations) {
	const changed = mutate(source);
	assert.notEqual(changed, source, name);
	const mutant = await load(changed);
	let helperKilled = false;
	let transitionKilled = false;
	try {
		cases(mutant);
	} catch {
		helperKilled = true;
	}
	try {
		assert.deepEqual(scenario(mutant), scenario(old));
	} catch {
		transitionKilled = true;
	}
	assert(helperKilled || transitionKilled, "survived " + name);
	if (["drop-watermark", "digest-only", "skip-fallback", "lost-currentness"].includes(name)) {
		assert(transitionKilled, "transition oracle missed " + name);
	}
	caught.push({ name, helperKilled, transitionKilled });
}
console.log(
	JSON.stringify({
		passed: true,
		differentialCases: count,
		transitionSteps: 15,
		loadedMutants: caught,
		fastPathReached: true,
		publicExportsAdded: 0,
		performanceSamples: 0,
	}),
);
