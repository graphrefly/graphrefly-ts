import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const runnerDirectory = resolve(root, "packages/ts/runners/local-untrusted-js");
const packageMetadata = JSON.parse(readFileSync(resolve(root, "packages/ts/package.json"), "utf8"));
const packageRevision = `graphrefly-ts:${packageMetadata.version}`;
const checked = spawnSync(
	process.execPath,
	[
		resolve(root, "node_modules/typescript/bin/tsc"),
		"--noEmit",
		"--project",
		resolve(runnerDirectory, "tsconfig.json"),
	],
	{ encoding: "utf8", stdio: "inherit" },
);
if (checked.error !== undefined) throw checked.error;
if (checked.status !== 0)
	throw new Error(`Local untrusted JS runner typecheck failed (${checked.status ?? "signal"}).`);

await build({
	absWorkingDir: root,
	entryPoints: [resolve(runnerDirectory, "runner.ts")],
	outfile: resolve(runnerDirectory, "local-untrusted-js-runner.mjs"),
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	define: {
		__GRAPHREFLY_TS_PACKAGE_REVISION__: JSON.stringify(packageRevision),
	},
	sourcemap: false,
	minify: false,
	legalComments: "none",
});
