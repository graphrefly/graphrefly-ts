import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const [out] = process.argv.slice(2);
assert.ok(out);
const root = resolve(out);
mkdirSync(root, { recursive: false });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const source = "scripts/fixtures/spending-preset-performance.ts";
assert.ok(readFileSync(source, "utf8").includes('new Graph({ name: "spending-performance" })'));
const b = await build({
	entryPoints: ["scripts/fixtures/causal-latency-baseline.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
});
writeFileSync(resolve(root, "entry.mjs"), b.outputFiles[0].contents);
const sources = {};
for (const p of [
	...Object.keys(b.metafile.inputs),
	"scripts/prepare-causal-latency-baseline.mjs",
	"scripts/run-causal-latency-baseline.py",
	"pnpm-lock.yaml",
]) {
	const bytes = readFileSync(p);
	sources[p] = sha(bytes);
	const dest = resolve(root, "source", p);
	mkdirSync(resolve(dest, ".."), { recursive: true });
	writeFileSync(dest, bytes);
}
const inputs = {};
for (const p of ["P1", "P3", "P6"]) {
	const bytes = readFileSync(`latency-inputs/${p}-inputs.json`);
	inputs[p] = sha(bytes);
	writeFileSync(resolve(root, `${p}-inputs.json`), bytes);
}
const rows = [];
for (const profile of ["P1", "P3", "P6"]) {
	rows.push({
		row: { id: `cold-${profile}-off`, group: "cold", profile, mode: "off" },
		initial: false,
	});
	rows.push({
		row: { id: `cold-${profile}-off`, group: "cold", profile, mode: "off" },
		initial: true,
	});
	for (const change of ["duplicate", "all-new", ...(profile === "P1" ? [] : ["one-new"])])
		for (const dataCount of change === "duplicate" ? [1, 2] : [change === "one-new" ? 1 : 2])
			rows.push({
				row: {
					id: `steady-${profile}-off-${change}-${dataCount}`,
					group: "steady",
					profile,
					mode: "off",
					change,
					dataCount,
				},
				initial: false,
			});
	rows.push({
		row: { id: `recovery-${profile}-off`, group: "recovery", profile, mode: "off" },
		initial: false,
	});
}
const orders = [
	["candidate", "reference", "plain"],
	["reference", "plain", "candidate"],
	["plain", "candidate", "reference"],
];
const jobs = [];
for (const r of rows)
	for (let repeat = 0; repeat < 3; repeat++)
		for (const control of repeat % 2 ? [true, false] : [false, true])
			jobs.push({ id: jobs.length, ...r, repeat, control, order: orders[repeat] });
writeFileSync(
	resolve(root, "freeze.json"),
	JSON.stringify(
		{
			scope: "unprofiled latency diagnostic; user expectation about100ms, not a new formal gate",
			profiler: false,
			sources,
			inputs,
			bundle: sha(b.outputFiles[0].contents),
			rows,
			jobs,
			limits: { childSeconds: 120, totalSeconds: 1800, rssMiB: 2048 },
			retries: 0,
		},
		null,
		2,
	) + "\n",
);
console.log("LATENCY_PREPARED", rows.length, jobs.length);
