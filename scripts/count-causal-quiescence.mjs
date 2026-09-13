/** Untimed, isolated bundle instrumentation; never used for latency qualification. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2]),
	out = resolve(process.argv[3]);
const freeze = JSON.parse(readFileSync(resolve(root, "freeze.json"))),
	sha = (b) => createHash("sha256").update(b).digest("hex");
const source = readFileSync(resolve(root, "worker.mjs"), "utf8");
assert.equal(sha(source), freeze.files["worker.mjs"]);
let changed = source;
const replace = (a, b) => {
	assert.equal(changed.split(a).length, 2, a);
	changed = changed.replace(a, b);
};
replace(
	"const recomputeDomain = (revisionDomain) => {",
	"const recomputeDomain = (revisionDomain) => { __qStats.recomputes++;",
);
replace("dataKey(prior2) !== dataKey(value2)", "__qKey(prior2) !== __qKey(value2)");
changed +=
	"\nlet __qStats; export function resetQuiescenceCounts(){__qStats={recomputes:0,encodings:0,totalCharacters:0,maxCharacters:0,nonemptyRefs:0};} export function quiescenceCounts(){return {...__qStats};} function __qKey(v){const k=dataKey(v);__qStats.encodings++;__qStats.totalCharacters+=k.length;__qStats.maxCharacters=Math.max(__qStats.maxCharacters,k.length);if(v.pendingOccurrenceRefs.length)__qStats.nonemptyRefs++;return k;} resetQuiescenceCounts();\n";
const path = resolve(out, "count-worker.mjs");
writeFileSync(path, changed, { flag: "wx" });
const instrumented = await import(pathToFileURL(path).href),
	original = await import(pathToFileURL(resolve(root, "worker.mjs")).href),
	input = JSON.parse(readFileSync(resolve(root, "P6-inputs.json"))),
	results = [];
for (const recipe of ["duplicate2", "verification"]) {
	const a = original.measurementArm("candidate", "off"),
		b = instrumented.measurementArm("candidate", "off");
	try {
		for (const s of input.steps)
			if (recipe === "duplicate2" || s.lane !== "verification") {
				a.send(s);
				b.send(s);
			}
		assert.deepEqual(a.state(), b.state());
		instrumented.resetQuiescenceCounts();
		const action =
			recipe === "duplicate2"
				? [{ lane: "arrivals", values: [input.arrivals, input.arrivals] }]
				: input.steps.filter((s) => s.lane === "verification");
		for (const s of action) {
			a.send(s);
			b.send(s);
			assert.deepEqual(a.state(), b.state());
		}
		results.push({ recipe, ...instrumented.quiescenceCounts(), stateParity: true });
	} finally {
		a.cleanup();
		b.cleanup();
	}
}
console.log(
	JSON.stringify(
		{ originalSha256: sha(source), instrumentedSha256: sha(changed), untimed: true, results },
		null,
		2,
	),
);
