import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsup";

/**
 * @graphrefly/graphrefly — presentation layer build (cleave A3, 2026-05-14).
 *
 * Entry structure mirrors the 4-layer model:
 *   substrate → base → utils → presets → solutions (compat sits alongside)
 *
 * Browser-safety: presentation files may import from @graphrefly/pure-ts (external)
 * and from within src/. Node-only subpaths are identified in nodeOnlyEntries.
 * The universal entries must not transitively import node:* — validated by
 * assertBrowserSafeBundles in @graphrefly/pure-ts's tsup config; this config
 * relies on correct layer segregation (node-only behind node/ subpaths).
 *
 * Consumer-driven browser-safety guard (memo:Re RN/Hermes, 2026-05-19):
 * pure-ts's `assertBrowserSafeBundles` only covers the *substrate* package.
 * Presentation entries this repo ships had NO post-build guard. We add a
 * **scoped** mirror of that mechanism here for the entries a Hermes consumer
 * actually pulls (`GUARDED_UNIVERSAL_ENTRIES`) — same bar/precedent as the
 * pure-ts `fromAny`/`fromAsyncIter` audit (assertBrowserSafeBundles clean ⇒
 * Hermes-safe). Scoped (not all-entries) on purpose: a flag-day audit of
 * every presentation entry is out of this slice's scope; add an entry here
 * when a consumer needs it Hermes-safe.
 */

const ENTRY_POINTS = [
	// Root barrel — substrate re-export + full presentation
	"src/index.ts",
	// Base layer
	"src/base/index.ts",
	"src/base/composition/index.ts",
	"src/base/io/index.ts",
	"src/base/meta/index.ts",
	"src/base/mutation/index.ts",
	"src/base/render/index.ts",
	"src/base/sources/index.ts",
	"src/base/sources/event/index.ts",
	"src/base/sources/node/index.ts", // Node-only
	"src/base/sources/browser/index.ts", // Browser-only
	"src/base/utils/index.ts",
	"src/base/worker/index.ts",
	// Utils layer
	"src/utils/index.ts",
	"src/utils/ai/index.ts",
	"src/utils/cqrs/index.ts",
	"src/utils/demo-shell/index.ts",
	"src/utils/domain-templates/index.ts",
	"src/utils/graphspec/index.ts",
	"src/utils/harness/index.ts",
	"src/utils/inspect/index.ts",
	"src/utils/job-queue/index.ts",
	"src/utils/memory/index.ts",
	"src/utils/messaging/index.ts",
	"src/utils/orchestration/index.ts",
	"src/utils/process/index.ts",
	"src/utils/reactive-layout/index.ts",
	"src/utils/reduction/index.ts",
	"src/utils/resilience/index.ts",
	"src/utils/surface/index.ts",
	"src/utils/topology-view/index.ts",
	// Presets layer
	"src/presets/index.ts",
	"src/presets/ai/index.ts",
	"src/presets/harness/index.ts",
	"src/presets/inspect/index.ts",
	"src/presets/resilience/index.ts",
	// Solutions layer
	"src/solutions/index.ts",
	// Testing — public test utilities (universal)
	"src/testing/index.ts",
	// Compat — per-framework adapters
	"src/compat/index.ts",
	"src/compat/jotai/index.ts",
	"src/compat/nanostores/index.ts",
	"src/compat/nestjs/index.ts",
	"src/compat/react/index.ts",
	"src/compat/solid/index.ts",
	"src/compat/svelte/index.ts",
	"src/compat/vue/index.ts",
	"src/compat/zustand/index.ts",
	// AI platform subpaths (browser + node variants)
	"src/utils/ai/node.ts",
	"src/utils/ai/browser.ts",
];

export default defineConfig({
	entry: ENTRY_POINTS,
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: process.env.NODE_ENV !== "production",
	minify: process.env.NODE_ENV === "production",
	platform: "neutral",
	target: "es2022",
	external: [
		"@graphrefly/pure-ts",
		"@graphrefly/native",
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
		await assertBrowserSafeBundles("dist");
	},
});

// ---------------------------------------------------------------------------
// Scoped browser-safety bundle assertion (mirror of pure-ts's guard)
// ---------------------------------------------------------------------------

/**
 * Universal presentation entries (relative to `dist/`, no ext) that a
 * Hermes/RN consumer pulls and that MUST stay free of `node:*` builtins.
 *
 * Add an entry here when a consumer needs it Hermes-safe — do NOT switch to
 * "all entries minus an allow-list": many presentation entries were never
 * audited and a flag-day sweep is a separate effort.
 */
const GUARDED_UNIVERSAL_ENTRIES = [
	// memo:Re §15 zoom-hierarchy spatial UI (Story 3.6 spike-gate). The
	// browser `CanvasMeasureAdapter` touches `OffscreenCanvas` only behind a
	// runtime `typeof OffscreenCanvas` guard; RN consumers plug in
	// `InjectedMeasureAdapter` instead. The guard below verifies (1) no
	// `node:*` imports and (2) every DOM global referenced in a reachable
	// chunk is `typeof`-guarded in its own file — the codebase convention
	// that keeps such refs Hermes-crash-safe. (2) is a heuristic, not a
	// proof of DOM-freedom — see the JSDoc on `assertBrowserSafeBundles`.
	"utils/reactive-layout/index",
	// fromPushNotification + fromCron — the universal event-source island
	// (memo:Re premium-backend push transport). Both import only pure-ts/core.
	"base/sources/event/index",
];

/**
 * DOM globals absent (or crash-on-touch) under React Native / Hermes. A
 * reference to one of these in a guarded chunk is only Hermes-safe if it is
 * `typeof`-guarded before use (the codebase convention — e.g.
 * `CanvasMeasureAdapter`'s `typeof OffscreenCanvas === "undefined"` bail).
 *
 * Deliberately excludes identifiers that exist on Hermes/Node or are
 * universal (`performance`, `setTimeout`, `fetch`, `globalThis`, `URL`,
 * `TextEncoder`, …) — flagging those would be all false-positives.
 */
const DOM_GLOBALS = [
	"document",
	"window",
	"navigator",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"indexedDB",
	"localStorage",
	"sessionStorage",
	"OffscreenCanvas",
	"Worker",
	"MessageChannel",
	"customElements",
	"HTMLElement",
	"getComputedStyle",
	"matchMedia",
];

// Node's builtin module set — matched both as `node:*` and bare specifiers
// (esbuild with `platform:"neutral"` may strip the `node:` prefix). Mirrors
// the pure-ts NODE_BUILTINS list.
const NODE_BUILTIN_SET = new Set<string>([
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
]);

/**
 * Post-build regression check over each {@link GUARDED_UNIVERSAL_ENTRIES}
 * entry's dist chunk graph. Two invariants:
 *
 * 1. **No `node:*` builtins** — sound: a transitive `import`/`require` of a
 *    Node builtin (matched as `node:*` OR bare, since esbuild with
 *    `platform:"neutral"` may strip the prefix) fails the build.
 * 2. **DOM globals must be `typeof`-guarded** — *heuristic, not a DOM-freedom
 *    proof*: if a reachable chunk references a {@link DOM_GLOBALS} identifier
 *    (bare read — not a property access) and that file contains **no**
 *    `typeof <id>` anywhere, it fails. This catches the realistic regression
 *    (a new unguarded `document.x` / static DOM dep) while passing the
 *    sanctioned `typeof OffscreenCanvas` bail. It does NOT prove the absence
 *    of DOM (a file could `typeof document` once yet use it unguarded
 *    elsewhere) — Hermes-crash-safety still rests on the runtime guards +
 *    audit; this only mechanically enforces the guard *convention*.
 *
 * The graph walk is also **sound about its own coverage**: an unresolvable
 * relative specifier (a traversal gap that could hide a `node:*`/DOM reach)
 * fails the build loud rather than being silently skipped.
 *
 * Trimmed mirror of pure-ts's `assertBrowserSafeBundles` (no
 * version-token / `restoreNodePrefix` — pure-ts D4 concerns) plus the DOM
 * heuristic + unresolved-spec soundness, which the substrate guard omits.
 */
async function assertBrowserSafeBundles(dir: string): Promise<void> {
	type FileInfo = {
		rel: string;
		ext: "js" | "cjs" | "mjs";
		imports: string[];
		nodeBuiltins: string[];
		/** DOM globals referenced bare with NO `typeof <id>` guard in-file. */
		domUnguarded: string[];
	};
	const files = new Map<string, FileInfo>();
	await walkBuild(dir, async (abs) => {
		const m = abs.match(/\.(js|cjs|mjs)$/);
		if (!m) return;
		const ext = m[1] as "js" | "cjs" | "mjs";
		const rel = abs.slice(dir.length + 1);
		const src = await readFile(abs, "utf8");
		const imports = extractImportSpecs(src);
		// `node:` prefix OR bare builtin (prefix-strip case). No dead ternary.
		const nodeBuiltins = imports.filter(
			(p) => p.startsWith("node:") || NODE_BUILTIN_SET.has(p.startsWith("node:") ? p.slice(5) : p),
		);
		const domUnguarded: string[] = [];
		for (const g of DOM_GLOBALS) {
			// Bare identifier read: not preceded by `.`/word-char, not part of
			// a longer identifier. Captures `g`, `g(`, `new g`, `g.x`, AND the
			// `typeof g` occurrence itself (harmless — presence-of-typeof is
			// exactly the allow signal).
			const referenced = new RegExp(`(?<![.\\w$])${g}(?![\\w$])`).test(src);
			if (!referenced) continue;
			const typeofGuarded = new RegExp(`\\btypeof\\s+${g}\\b`).test(src);
			if (!typeofGuarded) domUnguarded.push(g);
		}
		files.set(rel, { rel, ext, imports, nodeBuiltins, domUnguarded });
	});

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
		if (/\.(js|cjs|mjs)$/.test(joined)) candidates.push(joined);
		for (const e of exts) candidates.push(`${joined}.${e}`);
		for (const e of exts) candidates.push(`${joined}/index.${e}`);
		for (const cand of candidates) if (files.has(cand)) return cand;
		return null;
	}

	const offenders: Array<{ entry: string; chain: string[]; reason: string }> = [];
	// F3: an unresolvable RELATIVE specifier is a traversal gap that could
	// hide a `node:*`/DOM reach — collect and fail loud (externals and
	// `node:` specifiers are intentionally not resolved and not tracked).
	const unresolved: Array<{ entry: string; from: string; spec: string }> = [];
	for (const noExt of GUARDED_UNIVERSAL_ENTRIES) {
		// Each guarded entry is emitted as both ESM (.js) and CJS (.cjs).
		for (const ext of ["js", "cjs"] as const) {
			const entry = `${noExt}.${ext}`;
			if (!files.has(entry)) {
				throw new Error(
					`Browser-safety guard: guarded entry "${entry}" not found in dist — ` +
						`GUARDED_UNIVERSAL_ENTRIES is stale (entry renamed/removed?).`,
				);
			}
			const visited = new Set<string>();
			const queue: Array<{ rel: string; chain: string[] }> = [{ rel: entry, chain: [entry] }];
			while (queue.length > 0) {
				const { rel, chain } = queue.shift()!;
				if (visited.has(rel)) continue;
				visited.add(rel);
				const info = files.get(rel);
				if (!info) continue;
				if (info.nodeBuiltins.length > 0) {
					offenders.push({
						entry,
						chain,
						reason: `Node builtin "${info.nodeBuiltins[0]!}"`,
					});
					break;
				}
				if (info.domUnguarded.length > 0) {
					offenders.push({
						entry,
						chain,
						reason: `unguarded DOM global "${info.domUnguarded[0]!}" (no \`typeof\` guard in ${rel})`,
					});
					break;
				}
				for (const spec of info.imports) {
					const resolved = resolveSpec(rel, info.ext, spec);
					if (resolved) {
						if (!visited.has(resolved)) queue.push({ rel: resolved, chain: [...chain, resolved] });
					} else if (spec.startsWith(".")) {
						unresolved.push({ entry, from: rel, spec });
					}
				}
			}
		}
	}

	if (unresolved.length > 0) {
		const msg = unresolved
			.map(({ entry, from, spec }) => `  entry ${entry}: ${from} → unresolved "${spec}"`)
			.join("\n");
		throw new Error(
			`Browser-safety guard: unresolvable relative specifier(s) — the chunk-graph walk is ` +
				`incomplete, so the node:*/DOM scan cannot be trusted for the affected entry.\n${msg}\n` +
				"Fix the resolver (or the build output) so every relative import resolves to a dist file.",
		);
	}

	if (offenders.length > 0) {
		const msg = offenders
			.map(
				({ entry, chain, reason }) => `  entry ${entry} → ${reason}\n    via ${chain.join(" → ")}`,
			)
			.join("\n");
		throw new Error(
			`Browser-safety regression: guarded universal entries are not Hermes-safe.\n${msg}\n` +
				"Fix (node:*): route the node-only dependency through a `<x>/node` subpath, or move the " +
				"symbol out of the guarded entry. Fix (DOM global): wrap the reference in a runtime " +
				'`typeof <id> !== "undefined"` guard (the `CanvasMeasureAdapter` convention), or move it ' +
				"behind a `<x>/browser` subpath.",
		);
	}
}

/** Extract module specifiers from a bundled JS/CJS/MJS source string. */
function extractImportSpecs(src: string): string[] {
	const specs: string[] = [];
	const patterns: RegExp[] = [
		/\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
		/\bimport\s*["']([^"']+)["']/g,
		/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
	];
	for (const re of patterns) {
		for (const mm of src.matchAll(re)) specs.push(mm[1]!);
	}
	return specs;
}

async function walkBuild(dir: string, visit: (absPath: string) => Promise<void>): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) await walkBuild(p, visit);
		else if (e.isFile()) await visit(p);
	}
}
