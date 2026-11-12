import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const [out, fixtureRoot] = process.argv.slice(2);
assert.ok(out && fixtureRoot);
const root = resolve(out);
mkdirSync(root, { recursive: false });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const put = (n, x) =>
	writeFileSync(resolve(root, n), JSON.stringify(x, null, 2) + "\n", { flag: "wx" });
const source = "scripts/fixtures/spending-preset-performance.ts";
const original = readFileSync(source, "utf8");
const target = 'new Graph({ name: "spending-performance" })';
assert.equal(original.split(target).length, 2);
const altered = original.replace(
	target,
	'new Graph({ name: "spending-performance", profile: true })',
);
const b = await build({
	entryPoints: ["scripts/fixtures/causal-coverage-profile.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
	plugins: [
		{
			name: "existing-profile-option",
			setup(api) {
				api.onLoad({ filter: /spending-preset-performance\.ts$/ }, () => ({
					contents: altered,
					loader: "ts",
					resolveDir: resolve("scripts/fixtures"),
				}));
			},
		},
	],
});
writeFileSync(resolve(root, "entry.mjs"), b.outputFiles[0].contents, { flag: "wx" });
const sources = {};
for (const p of [
	...Object.keys(b.metafile.inputs),
	"scripts/prepare-causal-coverage-profile.mjs",
	"pnpm-lock.yaml",
]) {
	const bytes = readFileSync(p);
	sources[p] = sha(bytes);
	const dest = resolve(root, "source", p);
	mkdirSync(resolve(dest, ".."), { recursive: true });
	writeFileSync(dest, bytes, { flag: "wx" });
}
const f = JSON.parse(readFileSync(resolve(fixtureRoot, "freeze.json")));
const inputs = {};
for (const name of Object.keys(f.inputs)) {
	const bytes = readFileSync(resolve(fixtureRoot, name));
	assert.equal(sha(bytes), f.inputs[name]);
	writeFileSync(resolve(root, name), bytes, { flag: "wx" });
	inputs[name] = sha(bytes);
}
put("freeze.json", {
	rows: 84,
	coldOrSteadyActionsPerArm: 3,
	recoveryCyclesPerArm: 20,
	inputs,
	bundle: sha(b.outputFiles[0].contents),
	sources,
	profileIntervention: { original: sha(original), loaded: sha(altered) },
	limits: { seconds: 900, rssMiB: 2048 },
	scope:
		"Offline attribution only. Entire current84 rows, actual original business preflight, existing opt-in node profiles. No p95 or formal qualification.",
});
console.log("PROFILE_MAP_PREPARED");
