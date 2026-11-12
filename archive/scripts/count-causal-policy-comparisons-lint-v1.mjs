/** Untimed comparison accounting in a disposable bundle; no product memoization. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [inputRoot, outputRoot] = process.argv.slice(2),
	root = resolve(inputRoot),
	out = resolve(outputRoot);
mkdirSync(out, { recursive: false });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const source = readFileSync(resolve(root, "worker.mjs"), "utf8");
const f = JSON.parse(readFileSync(resolve(root, "freeze.json")));
assert.equal(sha(source), f.files["worker.mjs"]);
const start = source.indexOf("  const publicationPolicy = make("),
	end = source.indexOf("  const occurrences = make(", start);
assert.ok(start > 0 && end > start);
const original = source.slice(start, end);
assert.equal(original.split("    (ctx) => {").length, 2);
const sites = [...original.matchAll(/\bsame\(/g)];
assert.equal(sites.length, 5);
let site = 0;
const instrumented = original
	.replace(
		"    (ctx) => {",
		"    (ctx) => { const __seen=new Map(); if(__enabled)__stats.invocations++; const __same=(site,a,b)=>{ const encode=(value)=>{ const text=canonicalMaterial(value); if(__enabled){const previous=__seen.get(value);__stats.encodings++;__stats.characters+=text.length;__stats.sites[site]=(__stats.sites[site]??0)+1;if(previous!==undefined){assertPolicyText(previous,text);__stats.repeatedIdentity++;__stats.repeatedCharacters+=text.length;}else{__seen.set(value,text);__stats.uniqueIdentity++;} }return text;};return encode(a)===encode(b);};",
	)
	.replace(/\bsame\(/g, () => `__same(${site++},`);
const changed =
	source.slice(0, start) +
	instrumented +
	source.slice(end) +
	`
let __enabled=false,__stats;export function resetPolicyCounts(){__stats={invocations:0,encodings:0,characters:0,repeatedIdentity:0,repeatedCharacters:0,uniqueIdentity:0,sites:{}};__enabled=true;} export function policyCounts(){__enabled=false;return {...__stats};}function assertPolicyText(a,b){if(a!==b)throw new Error('identity changed inside invocation');}
`;
writeFileSync(resolve(out, "original.mjs"), source);
writeFileSync(resolve(out, "count-worker.mjs"), changed);
const base = await import(pathToFileURL(resolve(out, "original.mjs")).href),
	counter = await import(pathToFileURL(resolve(out, "count-worker.mjs")).href);
const results = [];
for (const profile of ["P1", "P3", "P6"]) {
	const bytes = readFileSync(resolve(root, "..", "before", profile + "-inputs.json"));
	writeFileSync(resolve(out, profile + "-inputs.json"), bytes);
	const input = JSON.parse(bytes);
	for (const recipe of ["initial", "duplicate2", "verification"]) {
		const a = base.measurementArm("candidate", "off"),
			b = counter.measurementArm("candidate", "off");
		try {
			for (const step of input.steps)
				if (
					recipe === "duplicate2" ||
					(recipe === "verification" && step.lane !== "verification")
				) {
					a.send(step);
					b.send(step);
					assert.deepEqual(a.state(), b.state());
				}
			counter.resetPolicyCounts();
			const actions =
				recipe === "initial"
					? input.steps
					: recipe === "duplicate2"
						? [{ lane: "arrivals", values: [input.arrivals, input.arrivals] }]
						: input.steps.filter((s) => s.lane === "verification");
			for (const step of actions) {
				a.send(step);
				b.send(step);
				assert.deepEqual(a.state(), b.state());
			}
			results.push({ profile, recipe, ...counter.policyCounts(), stateParity: true });
		} finally {
			a.cleanup();
			b.cleanup();
		}
	}
}
writeFileSync(
	resolve(out, "result.json"),
	JSON.stringify(
		{
			untimed: true,
			originalSha256: sha(source),
			instrumentedSha256: sha(changed),
			sites: sites.map((m) => original.slice(m.index, m.index + 100)),
			results,
		},
		null,
		2,
	) + "\n",
);
console.log("POLICY_COUNTS_DONE", results.length);
