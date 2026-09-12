/** Build only. Never invokes a performance factory. Uses git blobs at virtual, revision-neutral paths. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build, version } from "esbuild";
import ts from "typescript";

const esbuildEntry = createRequire(import.meta.url).resolve("esbuild");
const [root, repository] = process.argv.slice(2);
assert.ok(root && repository);
const commits = {
	B: "2f19cc0d79937bee0faa462cc9f2cf5209b62111",
	C: "907eec8138cddce9f8ff0e74d9f19d60db8c5b96",
};
const hash = (b) => createHash("sha256").update(b).digest("hex");
const put = (p, b) => {
	mkdirSync(path.dirname(p), { recursive: true });
	writeFileSync(p, b, { flag: "wx" });
};
const json = (p, x) => put(p, `${JSON.stringify(x)}\n`);
const wrapperPath = "scripts/fixtures/causal-release-comparison.ts";
const oraclePath = "scripts/fixtures/causal-release-comparison-oracle.ts";
const wrapper = readFileSync(path.join(root, "tools", path.basename(wrapperPath)), "utf8");
const all = {};
for (const [label, commit] of Object.entries(commits)) {
	const closure = {};
	const result = await build({
		entryPoints: [wrapperPath],
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		target: "node24",
		metafile: true,
		treeShaking: true,
		plugins: [
			{
				name: "frozen-git",
				setup(api) {
					api.onResolve({ filter: /.*/ }, (args) => {
						if (args.path.startsWith("node:")) return { path: args.path, external: true };
						let file =
							args.kind === "entry-point"
								? path.posix.normalize(args.path)
								: path.posix.normalize(
										path.posix.join(path.posix.dirname(args.importer), args.path),
									);
						assert.ok(
							args.kind === "entry-point" || args.path.startsWith("."),
							`unexpected external ${args.path}`,
						);
						if (file.endsWith(".js")) file = file.slice(0, -3) + ".ts";
						assert.ok(!file.startsWith("../") && !path.isAbsolute(file), file);
						return { path: file, namespace: "snapshot" };
					});
					api.onLoad({ filter: /.*/, namespace: "snapshot" }, (args) => {
						let content = [wrapperPath, oraclePath].includes(args.path)
							? readFileSync(path.join(root, "tools", path.basename(args.path)), "utf8")
							: execFileSync("git", ["show", `${commit}:${args.path}`], {
									cwd: repository,
									encoding: "utf8",
									maxBuffer: 16 * 1024 * 1024,
								});
						const raw = content;
						if (args.path === "scripts/fixtures/spending-preset-performance-worker.ts") {
							// Preserve the original semantic preflight; expose its already-checked independent data.
							assert.equal(content.split("function graphSnapshot(").length, 2);
							content =
								'import { expectedSnapshot } from "./causal-release-comparison-oracle.js";\n' +
								content.replace("function graphSnapshot(", "export function graphSnapshot(");
							const target = "\t\t\teffects: saved.effects.length,";
							assert.equal(content.split(target).length, 2);
							content = content.replace(
								target,
								target + "\n\t\t\texpected: expectedSnapshot(c.plain),",
							);
						}
						closure[args.path] = {
							sha256: hash(raw),
							loadedSha256: hash(content),
							gitBlob: [wrapperPath, oraclePath].includes(args.path)
								? null
								: execFileSync("git", ["rev-parse", `${commit}:${args.path}`], {
										cwd: repository,
										encoding: "utf8",
									}).trim(),
						};
						put(path.join(root, "sources", label, args.path), raw);
						if (content !== raw) put(path.join(root, "loaded", label, args.path), content);
						return { contents: content, loader: "ts" };
					});
				},
			},
		],
	});
	const bundle = result.outputFiles[0].text;
	assert.ok(!bundle.includes("performance.now()"), "original timed worker must be tree-shaken");
	put(path.join(root, `${label}.mjs`), bundle);
	json(path.join(root, `${label}-metafile.json`), result.metafile);
	all[label] = { commit, closure, bundleDigest: hash(bundle) };
}
const keys = Object.keys(all.B.closure).sort();
assert.deepEqual(keys, Object.keys(all.C.closure).sort());
const different = keys.filter((k) => all.B.closure[k].sha256 !== all.C.closure[k].sha256);
assert.deepEqual(different, ["packages/ts/src/graph/graph.ts"]);
function outsideMethod(s) {
	const start = s.indexOf("\tprivate _releaseNodes("),
		end = s.indexOf("\n\t// ── 8 verbs", start);
	assert.ok(start > 0 && end > start);
	return s.slice(0, start) + s.slice(end);
}
assert.equal(
	outsideMethod(readFileSync(path.join(root, "sources/B/packages/ts/src/graph/graph.ts"), "utf8")),
	outsideMethod(readFileSync(path.join(root, "sources/C/packages/ts/src/graph/graph.ts"), "utf8")),
);
put(path.join(root, "B-copy.mjs"), readFileSync(path.join(root, "B.mjs")));
json(path.join(root, "build.json"), {
	esbuild: version,
	esbuildEntry,
	esbuildEntryDigest: hash(readFileSync(esbuildEntry)),
	typescript: ts.version,
	wrapperDigest: hash(wrapper),
	arms: all,
	runtimeDifferences: different,
});
console.log(
	JSON.stringify({
		built: true,
		closureFiles: keys.length,
		esbuild: version,
		typescript: ts.version,
	}),
);
