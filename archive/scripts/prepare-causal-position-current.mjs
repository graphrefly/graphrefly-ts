/** New current-source D169 preparation; old tools and frozen method remain untouched. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { adaptWorker } from "./spending-preset-repetition.mjs";

const [out] = process.argv.slice(2);
assert.ok(out);
const root = resolve(out);
mkdirSync(root, { recursive: false });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const put = (name, x) =>
	writeFileSync(resolve(root, name), JSON.stringify(x, null, 2) + "\n", { flag: "wx" });
const source = "scripts/fixtures/spending-preset-performance-worker.ts";
const adapted = adaptWorker(readFileSync(source, "utf8"));
const built = await build({
	entryPoints: [source],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
	plugins: [
		{
			name: "existing-d168-adapter",
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
const bytes = built.outputFiles[0].contents;
const digest = sha(bytes);
for (const name of ["worker.mjs", "worker-copy.mjs"])
	writeFileSync(resolve(root, name), bytes, { flag: "wx" });
const copied = {};
for (const name of [
	"derive-causal-block-driver.mjs",
	"derive-causal-position-driver.mjs",
	"check-causal-position-source.mjs",
	"causal-position-pairs.test.mjs",
]) {
	const original = readFileSync("scripts/" + name, "utf8");
	let text = original;
	// This new attempt binds the current full bundle. The three historical clock/cleanup/schedule
	// function SHA locks stay unchanged. Independent source checker still compares every loop byte.
	const old = "d9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2";
	if (["derive-causal-block-driver.mjs", "check-causal-position-source.mjs"].includes(name)) {
		assert.equal(text.split(old).length, 2);
		text = text.replace(old, digest);
	}
	text = text.replace(
		'from "typescript"',
		"from " + JSON.stringify(import.meta.resolve("typescript")),
	);
	writeFileSync(resolve(root, name), text, { flag: "wx" });
	copied[name] = { original: sha(original), bound: sha(text) };
}
const { derive } = await import(
	pathToFileURL(resolve(root, "derive-causal-position-driver.mjs")).href
);
const { check } = await import(
	pathToFileURL(resolve(root, "check-causal-position-source.mjs")).href
);
const d = derive(Buffer.from(bytes).toString());
check(Buffer.from(bytes).toString(), d.output);
writeFileSync(resolve(root, "position.mjs"), d.output, { flag: "wx" });
put("derivation.json", d.manifest);
const archive = "packages/ts/qualification/causal-occurrence/preset-reference-v1/evidence.tar.gz";
const receipt = JSON.parse(
	readFileSync("packages/ts/qualification/causal-occurrence/preset-reference-v1/receipt.json"),
);
assert.equal("sha256:" + sha(readFileSync(archive)), receipt.rawEvidence.digest);
const indexPath =
	"packages/ts/qualification/causal-occurrence/preset-reference-v1/artifact-index.json";
assert.equal("sha256:" + sha(readFileSync(indexPath)), receipt.rawEvidence.indexDigest);
const fixture = execFileSync("tar", ["-xOf", archive, "./freeze-qualified/P2-inputs.json"], {
	maxBuffer: 16 * 1024 * 1024,
});
assert.equal(
	"sha256:" + sha(fixture),
	JSON.parse(readFileSync(indexPath)).files["freeze-qualified/P2-inputs.json"],
);
writeFileSync(resolve(root, "P2-inputs.json"), fixture, { flag: "wx" });
const sources = {};
for (const p of [
	...Object.keys(built.metafile.inputs),
	"scripts/prepare-causal-position-current.mjs",
	"scripts/causal-position-current.py",
	"scripts/verify-causal-position-current.py",
	"scripts/causal-position-pairs.py",
	"scripts/verify-causal-position-pairs.py",
	"scripts/causal-control-crossover.py",
	"scripts/causal-block-history.py",
	"scripts/verify-causal-block-history.py",
	"scripts/verify-causal-control-crossover.py",
	"scripts/spending-preset-repetition.mjs",
	"pnpm-lock.yaml",
	...Object.keys(copied).map((n) => "scripts/" + n),
]) {
	const b = readFileSync(p);
	sources[p] = sha(b);
	const dest = resolve(root, "source", p);
	mkdirSync(resolve(dest, ".."), { recursive: true });
	writeFileSync(dest, b, { flag: "wx" });
}
put("current-binding.json", {
	method: "graphrefly-ts:D169 unchanged; current-P2-summary Z/M only",
	runtime: {
		node: process.version,
		v8: process.versions.v8,
		platform: process.platform,
		arch: process.arch,
	},
	bundle: digest,
	position: sha(d.output),
	fixture: sha(fixture),
	sources,
	copied,
	derivation: d.manifest,
	formalConsumerQualification: false,
});
console.log("CURRENT_POSITION_PREPARED", digest);
