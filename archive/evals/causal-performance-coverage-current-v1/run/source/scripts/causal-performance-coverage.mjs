/** Diagnostic coverage preparation only. No performance factory is invoked here. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const [output] = process.argv.slice(2);
assert.ok(output && process.argv.length === 3);
const root = resolve(output);
mkdirSync(root, { recursive: false });
const hash = (b) => createHash("sha256").update(b).digest("hex");
const put = (name, x) =>
	writeFileSync(resolve(root, name), JSON.stringify(x, null, 2) + "\n", { flag: "wx" });
const worker = "scripts/fixtures/spending-preset-performance-worker.ts";
const original = readFileSync(worker, "utf8");
// Only the timed arm selector changes; preflight still exercises actual candidate/reference/plain.
assert.equal(original.split("measurementArm(arm, row.mode)").length, 3);
assert.equal(original.split("const checked = preflight(row, scenario);").length, 2);
const adapted = original
	.replaceAll("measurementArm(arm, row.mode)", "measure(arm, row.mode)")
	.replace(
		"const checked = preflight(row, scenario);",
		'const measure = (arm: Arm, mode: "off" | "summary") => measurementArm((config as typeof config & { identicalReference: boolean }).identicalReference && arm === "candidate" ? "reference" : arm, mode);\n\tconst checked = preflight(row, scenario);',
	);
writeFileSync(resolve(root, "adapted-worker.ts"), adapted, { flag: "wx" });
const built = await build({
	entryPoints: [worker],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
	plugins: [
		{
			name: "diagnostic-selector",
			setup(api) {
				api.onLoad({ filter: /spending-preset-performance-worker\.ts$/ }, () => ({
					contents: adapted,
					loader: "ts",
					resolveDir: resolve("scripts/fixtures"),
				}));
			},
		},
	],
});
writeFileSync(resolve(root, "worker.mjs"), built.outputFiles[0].contents, { flag: "wx" });
const { RECIPE, matrixRows } = await import(pathToFileURL(resolve(root, "worker.mjs")).href);
const rows = matrixRows();
assert.equal(rows.length, 84);
const archive = "packages/ts/qualification/causal-occurrence/preset-reference-v1/evidence.tar.gz";
const receipt = JSON.parse(
	readFileSync("packages/ts/qualification/causal-occurrence/preset-reference-v1/receipt.json"),
);
assert.equal("sha256:" + hash(readFileSync(archive)), receipt.rawEvidence.digest);
const indexPath =
	"packages/ts/qualification/causal-occurrence/preset-reference-v1/artifact-index.json";
assert.equal("sha256:" + hash(readFileSync(indexPath)), receipt.rawEvidence.indexDigest);
const index = JSON.parse(readFileSync(indexPath));
const inputs = {};
for (const p of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
	const name = `${p}-inputs.json`;
	const b = execFileSync("tar", ["-xOf", archive, `./freeze-qualified/${name}`], {
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal("sha256:" + hash(b), index.files[`freeze-qualified/${name}`]);
	writeFileSync(resolve(root, name), b, { flag: "wx" });
	inputs[name] = hash(b);
}
const sources = {};
for (const p of [
	...Object.keys(built.metafile.inputs),
	"scripts/causal-performance-coverage.mjs",
	"scripts/causal-performance-coverage.py",
	"scripts/verify-causal-performance-coverage.py",
	"pnpm-lock.yaml",
])
	sources[p] = hash(readFileSync(p));
for (const [p, digest] of Object.entries(sources)) {
	const bytes = readFileSync(p);
	assert.equal(hash(bytes), digest);
	const dest = resolve(root, "source", p);
	mkdirSync(resolve(dest, ".."), { recursive: true });
	writeFileSync(dest, bytes, { flag: "wx" });
}
const entropy = randomBytes(84);
const jobs = [];
for (const [i, row] of rows.entries())
	for (const identicalReference of entropy[i] % 2 ? [true, false] : [false, true])
		jobs.push({ position: jobs.length, row, identicalReference });
put("freeze.json", {
	kind: "diagnostic-coverage-not-D168-or-D169-qualification",
	approval:
		"User: 不要我一步步说继续了，我批准，你直接性能诊断+诊断工具修改+性能验收直到找到我们想知道的。",
	owner: "graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS",
	commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	runtime: { node: process.version, platform: process.platform, arch: process.arch },
	recipe: RECIPE,
	sources,
	inputs,
	bundle: hash(built.outputFiles[0].contents),
	adapted: hash(adapted),
	entropyHex: entropy.toString("hex"),
	jobs,
	limits: { processes: 168, childSeconds: 30, totalSeconds: 1800, rssMiB: 256, retries: 0 },
	interpretation:
		"Complete fixed coverage, original per-sample clocks and work. One main and identical-reference process per row; both retain timed plain history. Ratios descriptive only; no repeated-process qualification or control correction. Stop on structural/resource failure, never stop/select on a timing ratio.",
});
console.log("COVERAGE_PREPARED", root, jobs.length);
