import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(process.argv[2]);
mkdirSync(root, { recursive: false });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const b = await build({
	entryPoints: ["scripts/fixtures/causal-latency-first-use.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
});
writeFileSync(resolve(root, "first.mjs"), b.outputFiles[0].contents);
const sources = {};
for (const p of [
	...Object.keys(b.metafile.inputs),
	"scripts/prepare-causal-latency-first-use.mjs",
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
const orders = [
	["candidate", "reference", "plain"],
	["reference", "plain", "candidate"],
	["plain", "candidate", "reference"],
];
const jobs = [];
for (const profile of ["P1", "P3", "P6"])
	for (let repeat = 0; repeat < 3; repeat++)
		for (const arm of orders[repeat]) jobs.push({ id: jobs.length, profile, repeat, arm });
writeFileSync(
	resolve(root, "first-freeze.json"),
	JSON.stringify(
		{
			jobs,
			sources,
			inputs,
			bundle: sha(b.outputFiles[0].contents),
			limits: { childSeconds: 60, totalSeconds: 300 },
			scope:
				"first invocation with no preflight or warmup before clocks; process/module startup excluded; diagnostic only",
		},
		null,
		2,
	) + "\n",
);
