/** Independent build from archived loaded bytes. Does not import/execute the resulting modules. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(path.join(root, "build.json"), "utf8"));
const hash = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(hash(readFileSync(manifest.esbuildEntry)), manifest.esbuildEntryDigest);
const esbuild = await import(pathToFileURL(manifest.esbuildEntry).href);
assert.equal(esbuild.version, manifest.esbuild);
const output = {};
for (const label of ["B", "C"]) {
	const closure = manifest.arms[label].closure;
	const result = await esbuild.build({
		entryPoints: ["scripts/fixtures/causal-release-comparison.ts"],
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		target: "node24",
		metafile: true,
		treeShaking: true,
		plugins: [
			{
				name: "archive-rebuild",
				setup(api) {
					api.onResolve({ filter: /.*/ }, (args) => {
						if (args.path.startsWith("node:")) return { path: args.path, external: true };
						assert.ok(args.kind === "entry-point" || args.path.startsWith("."));
						let p =
							args.kind === "entry-point"
								? path.posix.normalize(args.path)
								: path.posix.normalize(
										path.posix.join(path.posix.dirname(args.importer), args.path),
									);
						if (p.endsWith(".js")) p = p.slice(0, -3) + ".ts";
						assert.ok(Object.hasOwn(closure, p), `unlisted import ${p}`);
						return { namespace: "snapshot", path: p };
					});
					api.onLoad({ filter: /.*/, namespace: "snapshot" }, (args) => ({
						contents: readFileSync(
							path.join(
								root,
								closure[args.path].loadedSha256 === closure[args.path].sha256
									? "sources"
									: "loaded",
								label,
								args.path,
							),
							"utf8",
						),
						loader: "ts",
					}));
				},
			},
		],
	});
	output[label] = hash(result.outputFiles[0].contents);
	assert.equal(
		output[label],
		hash(readFileSync(path.join(root, label + ".mjs"))),
		"rebuild source-to-bundle " + label,
	);
	assert.deepEqual(
		result.metafile,
		JSON.parse(readFileSync(path.join(root, label + "-metafile.json"), "utf8")),
	);
}
console.log(JSON.stringify({ passed: true, bundles: output, newSamples: 0 }));
