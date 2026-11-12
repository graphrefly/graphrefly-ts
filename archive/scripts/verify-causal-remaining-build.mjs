import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, version } from "esbuild";
import { adaptWorker } from "./spending-preset-repetition.mjs";

const root = resolve(process.argv[2]);
const f = JSON.parse(readFileSync(resolve(root, "freeze.json")));
const sha = (b) => createHash("sha256").update(b).digest("hex");
for (const [p, h] of Object.entries(f.files))
	if (p.startsWith("source/")) {
		const name = p.slice(7);
		assert.equal(sha(execFileSync("git", ["show", `${f.base}:${name}`])), h, name);
		assert.equal(sha(readFileSync(name)), h, name);
	}
const adapter = "scripts/spending-preset-repetition.mjs";
assert.equal(
	sha(readFileSync(adapter)),
	sha(execFileSync("git", ["show", `${f.base}:${adapter}`])),
);
const entry = "scripts/fixtures/spending-preset-performance-worker.ts";
const b = await build({
	entryPoints: [entry],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
	plugins: [
		{
			name: "controlled-source",
			setup(api) {
				api.onLoad({ filter: /spending-preset-performance-worker\.ts$/ }, () => ({
					contents: adaptWorker(readFileSync(entry, "utf8")),
					loader: "ts",
					resolveDir: resolve("scripts/fixtures"),
				}));
				api.onLoad({ filter: /spending-alerts\/causal-admission\.ts$/ }, () => ({
					contents: readFileSync("examples/spending-alerts/causal-admission.ts", "utf8"),
					loader: "ts",
					resolveDir: resolve("examples/spending-alerts"),
				}));
			},
		},
	],
});
for (const p of Object.keys(b.metafile.inputs))
	assert.equal(sha(readFileSync(p)), f.files[`source/${p}`], p);
assert.equal(sha(b.outputFiles[0].contents), f.files["worker.mjs"]);
console.log(
	JSON.stringify(
		{
			verified: true,
			base: f.base,
			workerSha256: f.files["worker.mjs"],
			esbuild: version,
			adapterSha256: sha(readFileSync(adapter)),
			sourceFiles: Object.keys(b.metafile.inputs).length,
			scope:
				"Exact workspace rebuild equals captured worker; every bundled source and adapter checked against base git revision. Requires this repository and installed build dependencies.",
		},
		null,
		2,
	),
);
