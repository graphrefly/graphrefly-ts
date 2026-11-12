/** Freeze source and protocol before running the publication comparison. Never overwrite an attempt. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const get = (name) => {
	const i = process.argv.indexOf(name);
	return i < 0 ? undefined : resolve(process.argv[i + 1]);
};
const freeze = get("--freeze"),
	output = get("--output"),
	check = process.argv.includes("--check-only");
assert.ok(freeze, "--freeze path required");
const hash = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const temp = mkdtempSync(join(tmpdir(), "publication-comparison-"));
try {
	const entry = join(root, "scripts/fixtures/spending-publication-measure.ts"),
		bundle = join(temp, "measure.mjs");
	const compiled = await build({
		entryPoints: [entry],
		outfile: bundle,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		metafile: true,
		define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: '"graphrefly-ts:0.9.0"' },
	});
	const sources = Object.fromEntries(
		Object.keys(compiled.metafile.inputs)
			.sort()
			.map((p) => [p, hash(readFileSync(resolve(root, p)))]),
	);
	sources["scripts/compare-spending-publication.mjs"] = hash(
		readFileSync(fileURLToPath(import.meta.url)),
	);
	const manifest = {
		schema: "graphrefly-ts/spending-publication-performance-freeze/v1",
		sources,
		bundleDigest: hash(readFileSync(bundle)),
		protocol:
			"18 construction rows;108 steady rows (1/2 DATA per wave);36 cold DATA recovery rows;100 warmup+300 measured paired per AB/BA/AB batch;construction1.20,steady ratio-of-median-batch-p95s1.10;20 reconnects per cold order;off/summary observer;retained all failures",
		node: process.version,
	};
	if (!output) {
		assert.equal(existsSync(freeze), false);
		writeFileSync(freeze, JSON.stringify(manifest, null, 2) + "\n");
		console.log("PUBLICATION_BASELINE_FROZEN", freeze);
	} else {
		assert.equal(existsSync(output), false);
		const expected = JSON.parse(readFileSync(freeze, "utf8"));
		assert.deepEqual(manifest, expected, "source/baseline changed after freeze");
		writeFileSync(output + ".bundle.mjs", readFileSync(bundle));
		writeFileSync(output + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n");
		const child = spawnSync(
			process.execPath,
			[bundle, output, ...(check ? ["--check-only"] : [])],
			{ cwd: root, stdio: "inherit", timeout: 3600000 },
		);
		assert.ifError(child.error);
		assert.equal(child.signal, null);
		for (const [p, d] of Object.entries(sources))
			assert.equal(hash(readFileSync(resolve(root, p))), d, p + " changed while running");
		process.exitCode = child.status ?? 1;
	}
} finally {
	rmSync(temp, { recursive: true, force: true });
}
