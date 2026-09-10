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
const target = "examples/spending-alerts/causal-numeric.ts",
	original = readFileSync(resolve(root, target), "utf8");
const source = "delta * delta * (n - 1n)";
assert.equal(original.split(source).length, 2);
const materialTarget = "examples/spending-alerts/causal-material-owner.ts";
const materialOriginal = readFileSync(resolve(root, materialTarget), "utf8");
assert.equal(materialOriginal.split("message: message.message,").length, 2);
const variants = {
	baseline: { target, changed: original },
	population: { target, changed: original.replace(source, "delta * delta * n") },
	equivalent: { target, changed: original.replace(source, "(n - 1n) * delta ** 2n") },
	"payload-only": {
		target: materialTarget,
		changed: materialOriginal.replace(
			"message: message.message,",
			'message: message.message + " corrupted",',
		),
	},
};
const results = [];
for (const [variant, { target: variantTarget, changed }] of Object.entries(variants)) {
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
					b.onLoad({ filter: /spending-alerts\/causal-(numeric|material-owner)\.ts$/ }, (args) =>
						args.path === resolve(root, variantTarget)
							? { contents: changed, loader: "ts" }
							: undefined,
					);
				},
			},
		],
	});
	const sources = Object.fromEntries(
		Object.keys(compiled.metafile.inputs)
			.sort()
			.map((p) => [
				p,
				hash(
					resolve(root, p) === resolve(root, variantTarget)
						? changed
						: readFileSync(resolve(root, p)),
				),
			]),
	);
	const manifest = {
		variant,
		changedPath: variantTarget,
		sourceDigest: hash(changed),
		bundleDigest: hash(readFileSync(bundle)),
		sources,
		numericContractDigest: hash(
			readFileSync(resolve(root, "docs/design/causal-preset-numeric-contract-v1.md")),
		),
		verifierRevision: "spending-oracle-v2",
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
		for (let i = 0; i < r.result.length; i++)
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
assert.equal(readFileSync(resolve(root, materialTarget), "utf8"), materialOriginal);
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
