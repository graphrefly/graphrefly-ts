/** Build/prepare only. No consumer imports, clocks, reservation or sampling dispatch. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { build, version } from "esbuild";
import { check } from "./check-causal-workload-source.mjs";
import { derive } from "./derive-causal-workload-driver.mjs";

const [originalPath, target] = process.argv.slice(2);
assert.ok(originalPath && target);
fs.mkdirSync(target, { recursive: false });
const sha = (x) => createHash("sha256").update(x).digest("hex");
const source = fs.readFileSync(originalPath, "utf8");
const bound = JSON.parse(
	fs.readFileSync(
		"docs/design/causal-cost-investigation/source-readiness/source-manifest.json",
		"utf8",
	),
);
const raw = {};
const workerPath = "scripts/fixtures/spending-preset-performance-worker.ts";
const result = await build({
	stdin: {
		contents:
			'export {preflight,graphSnapshot} from "./scripts/fixtures/spending-preset-performance-worker.js"; export {measurementArm,RECIPE} from "./scripts/fixtures/spending-preset-performance.js";',
		resolveDir: process.cwd(),
		sourcefile: "workload-entry.ts",
		loader: "ts",
	},
	bundle: true,
	write: false,
	metafile: true,
	platform: "node",
	format: "esm",
	target: "node24",
	plugins: [
		{
			name: "source-binding",
			setup(api) {
				api.onLoad({ filter: /\.ts$/ }, (args) => {
					const file = path.relative(process.cwd(), args.path);
					let text = fs.readFileSync(args.path, "utf8");
					assert.equal(sha(text), bound.files[file]?.sha256, `source ${file}`);
					raw[file] = text;
					if (file === workerPath) {
						assert.equal(text.split("function graphSnapshot(").length, 2);
						text = text.replace("function graphSnapshot(", "export function graphSnapshot(");
					}
					return { contents: text, loader: "ts" };
				});
			},
		},
	],
});
assert.equal(Object.keys(raw).length, 60);
fs.writeFileSync(path.join(target, "worker.mjs"), result.outputFiles[0].contents);
fs.writeFileSync(path.join(target, "worker-copy.mjs"), result.outputFiles[0].contents);
fs.copyFileSync(originalPath, path.join(target, "frozen-driver-source.mjs"));
fs.copyFileSync(
	new URL("./causal-workload-observation.mjs", import.meta.url),
	path.join(target, "observation.mjs"),
);
const derivations = {};
for (const condition of ["BASE", "CPU", "CPU_GC"]) {
	const d = derive(source, condition);
	const proof = check(source, d.output, condition);
	fs.writeFileSync(path.join(target, condition + ".mjs"), d.output);
	derivations[condition] = { ...d.manifest, proof };
}
// Balanced coordinate list only; capture must preregister its own random permutation per round.
const coordinates = Array.from({ length: 4 }, (_, round) =>
	["BASE", "CPU", "CPU_GC"].flatMap((condition) =>
		["U", "V"].map((orientation) => ({ round, condition, orientation })),
	),
).flat();
fs.writeFileSync(
	path.join(target, "coordinates.json"),
	JSON.stringify({ dispatchAuthorized: false, randomOrderNotDrawn: true, coordinates }, null, 2) +
		"\n",
);
for (const [file, text] of Object.entries(raw)) {
	const p = path.join(target, "sources", file);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, text);
}
fs.writeFileSync(
	path.join(target, "build.json"),
	JSON.stringify(
		{
			sourceRevision: bound.revision,
			esbuild: version,
			rawSourceHashes: Object.fromEntries(
				Object.entries(raw)
					.sort()
					.map(([k, v]) => [k, sha(v)]),
			),
			bundleSha256: sha(result.outputFiles[0].contents),
			workerTransform: "only export graphSnapshot",
			metafile: result.metafile,
			derivations,
			consumerExecutions: 0,
		},
		null,
		2,
	) + "\n",
);
console.log(
	JSON.stringify({
		built: true,
		sourceFiles: 60,
		conditions: 3,
		coordinates: 24,
		consumerExecutions: 0,
	}),
);

// Retain exact executable tooling for portable qualification/capture replay.
const toolNames = [
	"causal-workload-observation.mjs",
	"derive-causal-workload-driver.mjs",
	"check-causal-workload-source.mjs",
	"causal-workload-source.test.mjs",
	"causal-workload-driver.test.mjs",
	"prepare-causal-workload-tools.mjs",
	"qualify-causal-workload-adapters.mjs",
	"probe-causal-workload-observer.mjs",
	"verify-causal-workload-diagnostic.py",
	"causal-workload-verifier.test.py",
	"causal-workload-supervisor.py",
	"causal-workload-supervisor.test.py",
	"capture-causal-workload.py",
	"causal-workload-capture.test.py",
	"verify-causal-workload-run.py",
	"causal-workload-run-verifier.test.py",
	"derive-causal-position-driver.mjs",
	"check-causal-position-source.mjs",
	"derive-causal-block-driver.mjs",
];
fs.mkdirSync(path.join(target, "tools"));
for (const file of toolNames)
	fs.copyFileSync(new URL(file, import.meta.url), path.join(target, "tools", file));
