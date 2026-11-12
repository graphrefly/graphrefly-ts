/**
 * Typecheck gate for legacy workspace packages that nothing else typechecks.
 *
 * B66 note: the old structural Impl parity harness was retired and removed;
 * clean-slate parity is authority conformance in
 * `~/src/graphrefly/spec/conformance.jsonl` (D24). Git history preserves the
 * retired harness. B111.7 adds the first active standalone example target so
 * its public imports and host boundary remain typechecked.
 *
 * B66 note: `evals/` was retired to `archive/evals` on 2026-06-27. CSP-8 may
 * design a new clean-slate eval harness later, but this gate should not point
 * at the archived legacy scripts.
 *
 * Each target is checked with its own tsconfig, except that `@graphrefly/ts`
 * and its subpaths resolve to `packages/ts/src` instead of the package's
 * built `dist/`. The examples' own tsconfigs keep resolving the package the
 * way a standalone copy would, and this gate does not need a build first
 * (CI runs lint before build).
 */

import { createRequire } from "node:module";
import { resolve } from "node:path";
import type * as TS from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const ts: typeof TS = createRequire(import.meta.url)("typescript");
const SRC = resolve(ROOT, "packages/ts/src");
/** `@graphrefly/ts[/subpath]` → package source; a target's own `paths` entries win. */
const SOURCE_PATHS: Record<string, string[]> = {
	"@graphrefly/ts": [`${SRC}/index.ts`],
	"@graphrefly/ts/*": [`${SRC}/*/index.ts`, `${SRC}/*.ts`],
};

/**
 * Previously-ungated packages this gate now enforces: every example and demo
 * tsconfig, so none of them drifts from the current package API.
 */
const TARGETS: readonly { name: string; project: string }[] = [
	{ name: "spending-alerts example", project: "examples/spending-alerts/tsconfig.json" },
	{
		name: "keyed-rate-limit example",
		project: "examples/basic/keyed-rate-limit/tsconfig.json",
	},
	{
		name: "state-and-derived example",
		project: "examples/basic/state-and-derived/tsconfig.json",
	},
	{ name: "jotai compat example", project: "examples/compat/jotai/tsconfig.json" },
	{ name: "nanostores compat example", project: "examples/compat/nanostores/tsconfig.json" },
	{ name: "zustand compat example", project: "examples/compat/zustand/tsconfig.json" },
	{ name: "react framework example", project: "examples/framework/react/tsconfig.json" },
	{ name: "solid framework example", project: "examples/framework/solid/tsconfig.json" },
	{ name: "svelte framework example", project: "examples/framework/svelte/tsconfig.json" },
	{ name: "vue framework example", project: "examples/framework/vue/tsconfig.json" },
	{ name: "knowledge-graph example", project: "examples/knowledge-graph/tsconfig.json" },
	{
		name: "nestjs-graph-boundary example",
		project: "examples/nestjs-graph-boundary/tsconfig.json",
	},
	{
		name: "reactive-layout flow example",
		project: "examples/reactive-layout/flow/tsconfig.json",
	},
	{ name: "compat-matrix demo", project: "demos/compat-matrix/tsconfig.json" },
	{ name: "reactive-layout demo", project: "demos/reactive-layout/tsconfig.json" },
];

let failed = false;

const host: TS.FormatDiagnosticsHost = {
	getCanonicalFileName: (fileName) => fileName,
	getCurrentDirectory: () => ROOT,
	getNewLine: () => "\n",
};

for (const { name, project } of TARGETS) {
	const configErrors: TS.Diagnostic[] = [];
	const parsed = ts.getParsedCommandLineOfConfigFile(
		resolve(ROOT, project),
		{},
		{ ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => configErrors.push(d) },
	);
	if (parsed === undefined || configErrors.length > 0) {
		// Discriminate "the project could not be read" (bad path, broken
		// extends) from "it was read and has type errors".
		failed = true;
		console.error(
			`\ntypecheck: ${name} (${project}) — tsconfig COULD NOT BE READ. ` +
				`Not a type error: check the path and its extends chain ` +
				`(\`pnpm install\` for extended package configs).\n`,
		);
		console.error(ts.formatDiagnostics(configErrors, host));
		continue;
	}
	const options = { ...parsed.options, paths: { ...SOURCE_PATHS, ...parsed.options.paths } };
	const program = ts.createProgram({
		rootNames: parsed.fileNames,
		options,
		projectReferences: parsed.projectReferences,
	});
	const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
	if (diagnostics.length === 0) {
		console.log(`typecheck: ${name} (${project}) — clean`);
		continue;
	}
	failed = true;
	console.error(
		`\ntypecheck: ${name} (${project}) — ${diagnostics.length} error(s). ` +
			`This gate has NO baseline: fix the error, do not silence it.\n`,
	);
	console.error(ts.formatDiagnostics(diagnostics, host));
}

if (failed) {
	process.exit(1);
}
console.log(`typecheck: ${TARGETS.length} package(s) checked, all clean.`);
