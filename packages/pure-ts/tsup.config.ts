import { readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsup";

// D4 (post-rustImpl-activation parity cleanup): the published `version`
// export is build-time injected from package.json so there is ONE source
// of truth. `src/index.ts` keeps a `process.env.GRAPHREFLY_PKG_VERSION`
// indirection with a `"0.0.0-dev"` fallback for unbuilt source consumers
// (parity-tests' src alias, evals' tsx) — no source consumer reads
// `.version`, and the `define` below strips the `process.env` reference
// from every shipped chunk (so `assertBrowserSafeBundles` stays clean).
const PKG_VERSION = (
	JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
		version: string;
	}
).version;
// QA-P6: fail the build LOUD if version is absent/empty. Without this,
// `JSON.stringify(undefined)` makes the esbuild `define` a no-op →
// `process.env.GRAPHREFLY_PKG_VERSION` survives into shipped chunks,
// silently breaking BOTH the `version` export and the browser-safety
// invariant the define is responsible for.
if (!PKG_VERSION || typeof PKG_VERSION !== "string") {
	throw new Error(
		`tsup.config: package.json "version" is missing/empty (got ${JSON.stringify(
			PKG_VERSION,
		)}). The version-inject define cannot proceed.`,
	);
}

// Which built-in modules we import from source — esbuild strips the `node:`
// prefix at bundle time (evanw/esbuild#2535) even with `platform: "node"` and
// `external` listing, so we restore it post-build across every emitted chunk.
// Keep this list in sync with Node's full builtin set — a missing entry means
// the bundle ships a bare `require("<name>")` that bypasses both
// `restoreNodePrefix` (nothing to rewrite) and `assertBrowserSafeBundles`
// (only matches `node:*` specifiers).
const NODE_BUILTINS = [
	"assert",
	"assert/strict",
	"async_hooks",
	"buffer",
	"child_process",
	"cluster",
	"console",
	"constants",
	"crypto",
	"dgram",
	"diagnostics_channel",
	"dns",
	"dns/promises",
	"domain",
	"events",
	"fs",
	"fs/promises",
	"http",
	"http2",
	"https",
	"inspector",
	"inspector/promises",
	"module",
	"net",
	"os",
	"path",
	"path/posix",
	"path/win32",
	"perf_hooks",
	"process",
	"punycode",
	"querystring",
	"readline",
	"readline/promises",
	"repl",
	"sqlite",
	"stream",
	"stream/consumers",
	"stream/promises",
	"stream/web",
	"string_decoder",
	"sys",
	"test",
	"timers",
	"timers/promises",
	"tls",
	"trace_events",
	"tty",
	"url",
	"util",
	"util/types",
	"v8",
	"vm",
	"wasi",
	"worker_threads",
	"zlib",
];

async function restoreNodePrefix(dir: string): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			await restoreNodePrefix(p);
			continue;
		}
		if (!/\.(js|cjs|mjs)$/.test(e.name)) continue;
		let src = await readFile(p, "utf8");
		let changed = false;
		for (const name of NODE_BUILTINS) {
			const esc = name.replace(/\//g, "\\/");
			// Matches `from "fs"` / `from 'fs'` / `require("fs")` (not `node:fs`).
			const patterns = [
				new RegExp(`(from\\s+["'])(${esc})(["'])`, "g"),
				new RegExp(`(require\\(["'])(${esc})(["']\\))`, "g"),
			];
			for (const re of patterns) {
				const next = src.replace(re, (_m, a, b, c) => `${a}node:${b}${c}`);
				if (next !== src) {
					src = next;
					changed = true;
				}
			}
		}
		if (changed) await writeFile(p, src);
	}
}

// Authoritative list of entry points — the guardrail uses this to distinguish
// real entries from shared chunks without relying on filename heuristics.
//
// Post-cleave A2 (2026-05-14): pure-ts ships the SUBSTRATE ONLY.
// Presentation layer (patterns, compat, io adapters, framework bindings)
// lives in `@graphrefly/graphrefly` (root shim). See CLAUDE.md § Layout.
const ENTRY_POINTS = [
	// Root barrel (substrate surface)
	"src/index.ts",
	// Core layer: node primitive, messages, batch, sugar constructors
	"src/core/index.ts",
	// Phase 13.6.B B9 (Lock 3.B): public testing utilities subpath —
	// browser-safe by default; consumers add to their test runner only.
	"src/testing/index.ts",
	// Extra: operators, sources, data-structures, storage (substrate only)
	"src/extra/index.ts",
	// Node-only extra: file/sqlite storage backends
	"src/extra/node.ts",
	// Browser-only extra: IndexedDB storage backends
	"src/extra/browser.ts",
	// Operators subpath (substrate operators)
	"src/extra/operators/index.ts",
	// Sources subpath (substrate sources: iter, timer, async, keepalive)
	"src/extra/sources/index.ts",
	// Storage subpaths (substrate storage tiers)
	"src/extra/storage/index.ts",
	"src/extra/storage/tiers-node.ts",
	"src/extra/storage/tiers-browser.ts",
	"src/extra/storage/wal.ts",
	// Graph layer: Graph container, describe, observe, snapshot
	"src/graph/index.ts",
];

export default defineConfig({
	entry: ENTRY_POINTS,
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	define: {
		"process.env.GRAPHREFLY_PKG_VERSION": JSON.stringify(PKG_VERSION),
	},
	sourcemap: process.env.NODE_ENV !== "production",
	minify: process.env.NODE_ENV === "production",
	platform: "node",
	target: "node22",
	external: [
		"@nestjs/common",
		"@nestjs/core",
		"@nestjs/microservices",
		"@nestjs/platform-express",
		"@nestjs/websockets",
		"rxjs",
		"reflect-metadata",
		"react",
		"react-dom",
		"vue",
		"solid-js",
		"svelte",
	],
	async onSuccess() {
		await restoreNodePrefix("dist");
		await assertBrowserSafeBundles("dist");
	},
});

/**
 * Post-build regression check: browser-safe entry points MUST NOT contain
 * `from "node:..."` imports NOR an unsubstituted `GRAPHREFLY_PKG_*`
 * version-define token (D2 defense-in-depth, 2026-05-17). Node-only
 * entries are explicitly allow-listed.
 *
 * Any universal entry whose dist chunks transitively import a `node:*`
 * builtin OR carry a surviving `GRAPHREFLY_PKG` env token fails the build
 * — this is the guardrail behind the formal browser/node split in the
 * exports map and the D4 version-`define` browser-safety claim. (Generic
 * `process.env.NODE_ENV` / CJS-interop `process` refs are intentionally
 * NOT flagged — they are bundler-emitted and browser-safe.)
 */
async function assertBrowserSafeBundles(dir: string): Promise<void> {
	// Entry points (relative to `dist/`, no ext) that are allowed to transitively
	// reach `node:*` builtins. Everything else MUST be browser-safe.
	//
	// These correspond to tsup entries whose source file is itself Node-only.
	// Keep in sync with `ENTRY_POINTS` (strip `src/` prefix + `.ts`).
	// IMPORTANT: keep aligned with ENTRY_POINTS Node-only entries even if the
	// source path moves to a sub-folder. Future contributors moving a Node-only
	// entry to a sub-folder must update both lists or assertBrowserSafeBundles
	// will silently pass.
	const nodeOnlyEntries = new Set<string>([
		// Node-only substrate entries (may import node:* builtins)
		"extra/node",
		"extra/storage/tiers-node",
	]);

	// Derive the canonical set of entry paths (no ext) from `ENTRY_POINTS` so
	// `isEntry` doesn't rely on filename heuristics. Chunks emitted by tsup
	// (shared code between entries) don't appear in this set.
	const entryPaths = new Set(ENTRY_POINTS.map((p) => p.replace(/^src\//, "").replace(/\.ts$/, "")));

	type FileInfo = {
		abs: string;
		rel: string;
		ext: "js" | "cjs" | "mjs";
		imports: string[];
		nodeBuiltins: string[];
		/**
		 * D2 defense-in-depth (gate blind-spot follow-up, 2026-05-17): a
		 * **residual version-define token** in a universal chunk. The D4
		 * browser-safety claim rests entirely on the shared tsup
		 * `defineConfig` substituting the `GRAPHREFLY_PKG_VERSION` env token
		 * to a string literal at build time; an entry built OUTSIDE that
		 * config would ship the unsubstituted token (a `process` reference
		 * that breaks browser bundles + a wrong `version` export).
		 *
		 * Scoped to the `GRAPHREFLY_PKG_*` token family ON PURPOSE — a
		 * generic `process.env` match is NOT a browser-safety violation
		 * (esbuild legitimately emits guarded / DCE-eligible
		 * `process.env.NODE_ENV` reads + CJS-interop `process` refs in
		 * every chunk; flagging those is all false-positives). The precise
		 * invariant D4 protects is "the version define ran", and that is
		 * exactly what this detects.
		 */
		hasResidualVersionToken: boolean;
	};
	const files = new Map<string, FileInfo>();
	await walkBuild(dir, async (abs) => {
		const m = abs.match(/\.(js|cjs|mjs)$/);
		if (!m) return;
		const ext = m[1] as "js" | "cjs" | "mjs";
		const rel = abs.slice(dir.length + 1);
		const src = await readFile(abs, "utf8");
		const imports = extractImportSpecs(src);
		// Match both `node:*` (what `restoreNodePrefix` produces) and bare
		// builtin names — guards against a future regression where
		// `restoreNodePrefix`'s NODE_BUILTINS list is incomplete.
		const nodeBuiltins = imports.filter((p) => p.startsWith("node:") || BUILTIN_SET.has(p));
		// `define` substitutes the version token to a string literal at
		// build time; a surviving `GRAPHREFLY_PKG_*` env reference in dist
		// means the define did NOT run for this entry (the D4 leak).
		const hasResidualVersionToken = /process\s*\.\s*env\s*\.\s*GRAPHREFLY_PKG/.test(src);
		files.set(rel, { abs, rel, ext, imports, nodeBuiltins, hasResidualVersionToken });
	});

	// Resolve a specifier against the calling file's directory. Keep ESM/CJS
	// trees disjoint: a `.cjs` file resolves to `.cjs` candidates only;
	// `.js`/`.mjs` resolve to `.js`/`.mjs` candidates. Prevents a CJS require
	// from accidentally resolving to the ESM twin of a node-only module.
	function resolveSpec(
		fromRel: string,
		fromExt: "js" | "cjs" | "mjs",
		spec: string,
	): string | null {
		if (spec.startsWith("node:") || !spec.startsWith(".")) return null;
		const baseDir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
		const parts = (baseDir ? `${baseDir}/${spec}` : spec).split("/");
		const stack: string[] = [];
		for (const p of parts) {
			if (p === "" || p === ".") continue;
			if (p === "..") stack.pop();
			else stack.push(p);
		}
		const joined = stack.join("/");
		const exts = fromExt === "cjs" ? ["cjs"] : ["js", "mjs"];
		const candidates: string[] = [];
		// If the specifier carries an extension, try it first (same-format).
		if (/\.(js|cjs|mjs)$/.test(joined)) candidates.push(joined);
		for (const e of exts) candidates.push(`${joined}.${e}`);
		// Directory-as-index resolution (`./foo` → `./foo/index.js`).
		for (const e of exts) candidates.push(`${joined}/index.${e}`);
		for (const cand of candidates) {
			if (files.has(cand)) return cand;
		}
		return null;
	}

	// Universal entries = dist files whose no-ext path is a declared entry
	// but NOT on the node-only allow-list. Chunks aren't in `entryPaths`, so
	// they're traversed during BFS but never seeded as roots.
	const universalEntries: string[] = [];
	for (const rel of files.keys()) {
		const noExt = rel.replace(/\.(js|cjs|mjs)$/, "");
		if (!entryPaths.has(noExt)) continue;
		if (nodeOnlyEntries.has(noExt)) continue;
		universalEntries.push(rel);
	}

	const offenders: Array<{ entry: string; chain: string[]; builtin: string }> = [];
	for (const entry of universalEntries) {
		const visited = new Set<string>();
		const queue: Array<{ rel: string; chain: string[] }> = [{ rel: entry, chain: [entry] }];
		while (queue.length > 0) {
			const { rel, chain } = queue.shift()!;
			if (visited.has(rel)) continue;
			visited.add(rel);
			const info = files.get(rel);
			if (!info) continue;
			if (info.nodeBuiltins.length > 0) {
				offenders.push({ entry, chain, builtin: info.nodeBuiltins[0] });
				break;
			}
			if (info.hasResidualVersionToken) {
				offenders.push({
					entry,
					chain,
					builtin: "unsubstituted GRAPHREFLY_PKG version token (D2 guard)",
				});
				break;
			}
			for (const spec of info.imports) {
				const resolved = resolveSpec(rel, info.ext, spec);
				if (resolved && !visited.has(resolved)) {
					queue.push({ rel: resolved, chain: [...chain, resolved] });
				}
			}
		}
	}

	if (offenders.length > 0) {
		const msg = offenders
			.map(
				({ entry, chain, builtin }) =>
					`  entry ${entry} → ${builtin}\n    via ${chain.join(" → ")}`,
			)
			.join("\n");
		throw new Error(
			`Browser-safety regression: universal entries transitively reach a Node-only token.\n${msg}\n` +
				"Fix (node:* builtin): route the node-only dependency through an `extra/node` or " +
				"`patterns/<x>/node` subpath, or add the entry to `nodeOnlyEntries` if it is genuinely " +
				"Node-only.\nFix (D2 version-token guard): the entry shipped an unsubstituted " +
				"`GRAPHREFLY_PKG_*` token — it was built outside the shared tsup `defineConfig` " +
				"`define`. Route the entry through that config so the version is inlined.",
		);
	}
}

// Pre-computed builtin lookup for `assertBrowserSafeBundles`. Mirrors
// NODE_BUILTINS as a Set for O(1) membership and catches bare
// `require("<builtin>")` emissions that slipped past `restoreNodePrefix`.
const BUILTIN_SET = new Set<string>(NODE_BUILTINS);

/**
 * Extract module specifiers from a bundled JS/CJS/MJS source string.
 *
 * Handles:
 *   - `import { x } from "foo"` / `import{x}from"foo"` (any whitespace around `from`)
 *   - `import "foo"` (side-effect import)
 *   - `export { x } from "foo"` / `export*from"foo"` (re-export, minified or not)
 *   - `import("foo")` / `require("foo")` / `__require("foo")` (dynamic / CJS / esbuild wrapper)
 */
function extractImportSpecs(src: string): string[] {
	const specs: string[] = [];
	const patterns: RegExp[] = [
		// `import ... from "X"` / `export ... from "X"` — whitespace around
		// `from` is optional so minified output (`from"X"`) matches.
		/\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
		// Side-effect import: `import "X"` (no bindings, no `from`).
		/\bimport\s*["']([^"']+)["']/g,
		// Dynamic `import()` and CJS `require()`. `\brequire` also matches
		// esbuild's `__require("X")` wrapper via the word boundary at `r`.
		/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
	];
	for (const re of patterns) {
		for (const m of src.matchAll(re)) {
			specs.push(m[1]);
		}
	}
	return specs;
}

async function walkBuild(dir: string, visit: (absPath: string) => Promise<void>): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			await walkBuild(p, visit);
		} else if (e.isFile()) {
			await visit(p);
		}
	}
}
