/** Build only. Never invokes a performance factory. Uses git blobs at virtual, revision-neutral paths. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build, transformSync, version } from "esbuild";
import ts from "typescript";

const esbuildEntry = createRequire(import.meta.url).resolve("esbuild");
const [root, repository] = process.argv.slice(2);
assert.ok(root && repository);
const commits = {
	B: "8253488bd7458a8f6caeb31e79fa04e4f870c77b",
	C: "9c30967c8953ae09aa8de5949e0fbdd6de3c4813",
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
	// Keep the rejected artifact inspectable too; never execute it here.
	put(path.join(root, `${label}.mjs`), bundle);
	json(path.join(root, `${label}-metafile.json`), result.metafile);
	verifyUninstrumented(
		bundle,
		readFileSync(path.join(root, "sources", label, "packages/ts/src/dispatcher/index.ts"), "utf8"),
	);
	all[label] = { commit, closure, bundleDigest: hash(bundle) };
}
const keys = Object.keys(all.B.closure).sort();
assert.deepEqual(keys, Object.keys(all.C.closure).sort());
const different = keys.filter((k) => all.B.closure[k].sha256 !== all.C.closure[k].sha256);
assert.deepEqual(different, ["packages/ts/src/node/core.ts"]);
const before = readFileSync(path.join(root, "sources/B", different[0]), "utf8");
let after = readFileSync(path.join(root, "sources/C", different[0]), "utf8");
const marker = "export function makeDepBookkeeping(";
assert.equal(before.split(marker).length, 2);
assert.equal(after.split(marker).length, 2);
assert.equal(before.split(marker)[0], after.split(marker)[0], "only factory body differs");
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

/** Match the retained, default-off recorder exactly; no other performance clock site is allowed. */
function verifyUninstrumented(bundle, dispatcherSource) {
	const parse = (text) =>
		ts.createSourceFile("clock-check.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const printer = ts.createPrinter({ removeComments: true });
	const methods = (ast) => {
		const found = [];
		function visit(node) {
			if (
				ts.isMethodDeclaration(node) &&
				node.name.getText(ast) === "invoke" &&
				node.body?.getText(ast).includes("this._recording")
			)
				found.push(node);
			ts.forEachChild(node, visit);
		}
		visit(ast);
		return found;
	};
	assert.ok(dispatcherSource.includes("private _recording = false;"), "recorder default");
	const frozen = parse(transformSync(dispatcherSource, { loader: "ts", target: "node24" }).code);
	const actual = parse(bundle),
		expected = methods(frozen),
		retained = methods(actual);
	assert.equal(expected.length, 1);
	assert.equal(retained.length, 1);
	// esbuild may alpha-rename locals during bundling (e.g. key -> key2).
	// Recompile only this isolated method with identifier minification; free names/properties remain.
	const print = (node, ast) =>
		transformSync(`class __Recorder { ${printer.printNode(ts.EmitHint.Unspecified, node, ast)} }`, {
			loader: "js",
			target: "node24",
			minifyIdentifiers: true,
		}).code;
	assert.equal(
		print(retained[0], actual),
		print(expected[0], frozen),
		"fixed recorder invoke differs",
	);
	const sites = [];
	const importedClocks = new Set();
	function imports(node) {
		if (ts.isImportSpecifier(node) && (node.propertyName?.text ?? node.name.text) === "performance")
			importedClocks.add(node.name.text);
		ts.forEachChild(node, imports);
	}
	imports(actual);
	function visit(node) {
		if (
			(ts.isIdentifier(node) &&
				(/^performance(?:_?\d+)?$/.test(node.text) || importedClocks.has(node.text)) &&
				!ts.isImportSpecifier(node.parent)) ||
			(ts.isStringLiteral(node) &&
				node.text === "performance" &&
				ts.isElementAccessExpression(node.parent))
		)
			sites.push(node);
		ts.forEachChild(node, visit);
	}
	visit(actual);
	assert.equal(sites.length, 2, "unexpected internal clock sites");
	for (const site of sites)
		assert.ok(
			site.pos >= retained[0].pos && site.end <= retained[0].end,
			"clock outside fixed recorder",
		);
}
