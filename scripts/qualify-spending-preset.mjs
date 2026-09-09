/** Actual loaded same-topology algorithm changes and independent authorization evidence. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--output");
assert.ok(arg >= 0 && process.argv[arg + 1], "fresh --output directory required");
const out = resolve(process.argv[arg + 1]);
assert.equal(existsSync(out), false);
mkdirSync(out, { recursive: true });
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const target = "examples/spending-alerts/causal-business.ts",
	original = readFileSync(resolve(root, target), "utf8");
const source = "Math.sqrt(m2 / (count - 1))";
assert.equal(original.split(source).length, 2);
const variants = {
	baseline: original,
	population: original.replace(source, "Math.sqrt(m2 / count)"),
	equivalent: original.replace(source, "Math.sqrt(m2 / (count + -1))"),
};
const results = [];
for (const [variant, changed] of Object.entries(variants)) {
	const bundle = resolve(out, `${variant}.cjs`);
	const compiled = await build({
		entryPoints: [resolve(root, "scripts/fixtures/spending-preset-verification.ts")],
		outfile: bundle,
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node24",
		metafile: true,
		define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: '"graphrefly-ts:0.9.0"' },
		plugins: [
			{
				name: "actual-source-variant",
				setup(b) {
					b.onLoad({ filter: /spending-alerts\/causal-business\.ts$/ }, () => ({
						contents: changed,
						loader: "ts",
					}));
				},
			},
		],
	});
	const sources = Object.fromEntries(
		Object.keys(compiled.metafile.inputs)
			.sort()
			.map((p) => [
				p,
				hash(resolve(root, p) === resolve(root, target) ? changed : readFileSync(resolve(root, p))),
			]),
	);
	const manifest = {
		variant,
		sourceDigest: hash(changed),
		bundleDigest: hash(readFileSync(bundle)),
		sources,
	};
	const mp = resolve(out, `${variant}.manifest.json`),
		rp = resolve(out, `${variant}.result.json`);
	writeFileSync(mp, JSON.stringify(manifest, null, 2));
	writeFileSync(resolve(out, `${variant}.source.ts`), changed);
	const child = spawnSync(process.execPath, [bundle, mp, rp], {
		cwd: root,
		encoding: "utf8",
		timeout: 60000,
	});
	writeFileSync(resolve(out, `${variant}.log`), `${child.stdout}${child.stderr}`);
	assert.ifError(child.error);
	assert.equal(child.status, 0, `${variant}: ${child.stderr}`);
	const r = JSON.parse(readFileSync(rp, "utf8"));
	assert.equal(hash(readFileSync(bundle)), manifest.bundleDigest);
	if (results.length)
		for (let i = 0; i < 2; i++)
			assert.deepEqual(
				r.result[i].topology,
				results[0].result[i].topology,
				"identity/topology changed",
			);
	results.push(r);
	writeFileSync(
		resolve(out, "results.json"),
		JSON.stringify({ kind: "loaded-business-verification", complete: false, results }, null, 2),
	);
	console.log("PRESET_VARIANT_DONE", variant);
}
assert.equal(readFileSync(resolve(root, target), "utf8"), original);
writeFileSync(
	resolve(out, "results.json"),
	JSON.stringify(
		{
			kind: "loaded-business-verification",
			complete: true,
			scope: "N4 finite sample; not full preset-v1 qualification",
			results,
		},
		null,
		2,
	),
);
console.log("PRESET_SOURCE_QUALIFICATION_DONE");
