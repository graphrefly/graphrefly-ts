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
	entryPoints: ["scripts/fixtures/causal-granularity.ts"],
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
	"scripts/prepare-causal-granularity.mjs",
	"scripts/run-causal-granularity.py",
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
const jobs = [];
const orders = [
	["candidate", "reference", "plain"],
	["reference", "plain", "candidate"],
	["plain", "candidate", "reference"],
];
for (const profile of ["P3", "P6"])
	for (const change of ["one-new", "duplicate"])
		for (const selection of ["full", "last"])
			for (const dataCount of [1, 2]) {
				const row = {
					id: `steady-${profile}-off-${change}-${dataCount}`,
					group: "steady",
					profile,
					mode: "off",
					change,
					dataCount,
				};
				rows.push({ row, selection });
				for (let repeat = 0; repeat < 3; repeat++)
					jobs.push({ id: jobs.length, row, selection, repeat, order: orders[repeat] });
			}
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
