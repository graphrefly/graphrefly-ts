/**
 * Graph observability validation — smoke-exercise helper (D4).
 *
 * One library-level utility that walks every observability surface the library
 * ships — `describe()`, `explain(from, to)`, `observe(path)` — and reports
 * failures as a structured result. Non-throwing by default; composable into
 * example dry-run paths, CI smoke tests, and MCP reduce-path validators.
 *
 * **Motivation.** Dry-run equivalence (CLAUDE.md) requires every observability
 * call the real run exercises to also run under dry-run. Previously each
 * example reimplemented the walk (inbox-reducer caught a `describe()`
 * dangling-pointer bug only after adding an ad-hoc `graph.explain` check).
 * This utility centralizes the smoke-exercise so regressions in
 * `describe` / `explain` / `observe` surface BEFORE any wire spend.
 *
 * **Non-goals.** Not a deep correctness check. `describe()` structural
 * invariants (dangling deps, duplicate paths) are what this catches; actual
 * data assertions belong in application tests.
 *
 * @module
 */

import { toAscii, toD2, toJson, toMermaid, toMermaidUrl, toPretty } from "../extra/render/index.js";
import type { CausalChain } from "./explain.js";
import type { Graph, GraphDescribeOutput } from "./graph.js";

/** Describe render formats exercised by {@link validateGraphObservability}. */
export type ObservabilityDescribeFormat =
	| "json"
	| "pretty"
	| "mermaid"
	| "mermaid-url"
	| "d2"
	| "ascii";

const FORMAT_RENDERERS: Record<ObservabilityDescribeFormat, (g: GraphDescribeOutput) => string> = {
	json: (g) => toJson(g),
	pretty: (g) => toPretty(g),
	mermaid: (g) => toMermaid(g),
	"mermaid-url": (g) => toMermaidUrl(g),
	d2: (g) => toD2(g),
	ascii: (g) => toAscii(g),
};

/** One observability check performed by {@link validateGraphObservability}. */
export type ObservabilityCheck =
	/** `describe()` was exercised and its structural invariants (nodes ⊇ deps) held. */
	| { kind: "describe"; ok: true; nodeCount: number; edgeCount: number }
	| { kind: "describe"; ok: false; reason: string; danglingDeps?: readonly string[] }
	/** `describe({ format })` render was exercised and produced non-empty output. */
	| { kind: "describe-format"; ok: true; format: ObservabilityDescribeFormat; length: number }
	| {
			kind: "describe-format";
			ok: false;
			format: ObservabilityDescribeFormat;
			reason: string;
	  }
	/** `observe(path)` succeeded / failed. `path` is the requested path. */
	| { kind: "observe"; ok: true; path: string }
	| { kind: "observe"; ok: false; path: string; reason: string }
	/** `explain(from, to)` succeeded / failed. `found` is the chain's found flag. */
	| { kind: "explain"; ok: true; from: string; to: string; found: boolean; steps: number }
	| { kind: "explain"; ok: false; from: string; to: string; reason: string };

/** Structured result returned by {@link validateGraphObservability}. */
export interface ValidateObservabilityResult {
	/** `true` iff every performed check passed (`ok: true`). */
	readonly ok: boolean;
	/** All checks performed, in the order they ran. */
	readonly checks: readonly ObservabilityCheck[];
	/** Convenience — checks with `ok: false`. */
	readonly failures: readonly ObservabilityCheck[];
	/** Single-line summary (e.g. for `process.stderr`). */
	summary(): string;
}

/** Options for {@link validateGraphObservability}. */
export interface ValidateObservabilityOptions {
	/**
	 * Paths to exercise via `graph.observe(path)`. Each path is resolved against
	 * the same path grammar `graph.observe` / `graph.resolve` use. Non-existent
	 * paths are reported as observe failures.
	 */
	readonly paths?: readonly string[];
	/**
	 * `(from, to)` pairs to exercise via `graph.describe({ explain: {from, to} })`.
	 * Each pair records `found` and `steps`; a pair where `found === false` does
	 * NOT fail the overall result — pass `requireFound: true` to tighten that.
	 */
	readonly pairs?: ReadonlyArray<readonly [from: string, to: string]>;
	/**
	 * When `true`, `explain` pairs that return `found: false` count as failures.
	 * Default `true` — the common case is "assert this chain exists."
	 */
	readonly requireFound?: boolean;
	/**
	 * When `true`, skip the `describe()` structural check (nodes ⊇ deps).
	 * Default `false`. Turn off only when your graph intentionally keeps
	 * untracked deps (rare — COMPOSITION-GUIDE §24 argues against it).
	 */
	readonly skipDescribe?: boolean;
	/**
	 * Describe formats to exercise via `graph.describe({ format })`. Each
	 * format renders the graph once and checks that the result is a non-empty
	 * string. Useful in dry-run blocks so regressions in the render paths
	 * (ascii, mermaid, pretty, json, d2, mermaid-url) surface before any wire
	 * spend.
	 */
	readonly formats?: readonly ObservabilityDescribeFormat[];
}

/**
 * Exercise every observability surface on `graph` and report failures.
 *
 * Does NOT throw — returns a structured result so callers (dry-run blocks,
 * CLI smoke tests, MCP reduce-path validators) can exit non-zero with a
 * diagnostic instead of letting the process crash mid-inspection.
 *
 * @example
 * ```ts
 * const result = validateGraphObservability(graph, {
 *   paths: ["input", "output"],
 *   pairs: [["input", "output"]],
 * });
 * if (!result.ok) {
 *   console.error(result.summary());
 *   for (const f of result.failures) console.error(f);
 *   process.exit(3);
 * }
 * ```
 */
export function validateGraphObservability(
	graph: Graph,
	opts: ValidateObservabilityOptions = {},
): ValidateObservabilityResult {
	const checks: ObservabilityCheck[] = [];
	const requireFound = opts.requireFound ?? true;

	// 1. describe() — structural invariant: every edge.from / edge.to / deps[]
	//    entry resolves to a node in `nodes`.
	if (opts.skipDescribe !== true) {
		try {
			const d = graph.describe();
			const nodeKeys = new Set(Object.keys(d.nodes));
			const dangling: string[] = [];
			for (const [path, entry] of Object.entries(d.nodes)) {
				for (const dep of entry.deps) {
					if (dep !== "" && !nodeKeys.has(dep)) {
						dangling.push(`${path} → ${dep}`);
					}
				}
			}
			for (const edge of d.edges) {
				if (!nodeKeys.has(edge.from)) dangling.push(`edge.from: ${edge.from}`);
				if (!nodeKeys.has(edge.to)) dangling.push(`edge.to: ${edge.to}`);
			}
			if (dangling.length > 0) {
				checks.push({
					kind: "describe",
					ok: false,
					reason: `describe() has ${dangling.length} dangling pointer(s); nodes ⊉ deps`,
					danglingDeps: dangling,
				});
			} else {
				checks.push({
					kind: "describe",
					ok: true,
					nodeCount: nodeKeys.size,
					edgeCount: d.edges.length,
				});
			}
		} catch (err) {
			checks.push({
				kind: "describe",
				ok: false,
				reason: `describe() threw: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	// 1b. Renderers — exercise each requested render path once. Composes the
	//     pure renderers from `extra/render` directly (Tier 2.1 A2 dropped
	//     `describe({ format })`; renderers now consume the describe snapshot).
	//     A regression in any renderer (e.g. mermaid producing empty output
	//     after a refactor) surfaces here instead of on the paid run.
	if ((opts.formats?.length ?? 0) > 0) {
		const snapshot = graph.describe();
		for (const format of opts.formats!) {
			try {
				const rendered = FORMAT_RENDERERS[format](snapshot);
				if (typeof rendered !== "string" || rendered.length === 0) {
					checks.push({
						kind: "describe-format",
						ok: false,
						format,
						reason: `${format} renderer returned empty or non-string output`,
					});
				} else {
					checks.push({
						kind: "describe-format",
						ok: true,
						format,
						length: rendered.length,
					});
				}
			} catch (err) {
				checks.push({
					kind: "describe-format",
					ok: false,
					format,
					reason: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	// 2. observe(path) — path must resolve. `graph.resolve` throws on missing
	//    path; that's the only signal we need. We deliberately do NOT
	//    subscribe: waking a lazy producer (e.g. `fromTimer` / `fromPromise`)
	//    just to probe resolvability would fire real side effects (timers,
	//    HTTP requests) in a validation pass that should be observationally
	//    inert.
	for (const path of opts.paths ?? []) {
		try {
			graph.resolve(path);
			checks.push({ kind: "observe", ok: true, path });
		} catch (err) {
			checks.push({
				kind: "observe",
				ok: false,
				path,
				reason: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// 3. describe({explain: {...}}) — returns CausalChain. When `requireFound: true`
	//    (default), a `found: false` result counts as a failure.
	for (const [from, to] of opts.pairs ?? []) {
		try {
			const chain: CausalChain = graph.describe({ explain: { from, to } });
			if (requireFound && chain.found === false) {
				checks.push({
					kind: "explain",
					ok: false,
					from,
					to,
					reason: `explain(${from} → ${to}) found no path${chain.reason ? `: ${chain.reason}` : ""}`,
				});
			} else {
				checks.push({
					kind: "explain",
					ok: true,
					from,
					to,
					found: chain.found,
					steps: chain.steps.length,
				});
			}
		} catch (err) {
			checks.push({
				kind: "explain",
				ok: false,
				from,
				to,
				reason: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const failures = checks.filter((c): c is Extract<ObservabilityCheck, { ok: false }> => !c.ok);
	const ok = failures.length === 0;
	const paths = opts.paths?.length ?? 0;
	const pairs = opts.pairs?.length ?? 0;
	const formatCount = opts.formats?.length ?? 0;

	return {
		ok,
		checks,
		failures,
		summary(): string {
			const bits = [
				opts.skipDescribe === true ? null : "describe",
				formatCount > 0 ? `${formatCount} format${formatCount === 1 ? "" : "s"}` : null,
				paths > 0 ? `${paths} observe path${paths === 1 ? "" : "s"}` : null,
				pairs > 0 ? `${pairs} explain pair${pairs === 1 ? "" : "s"}` : null,
			].filter((b): b is string => b != null);
			const scope = bits.length > 0 ? bits.join(", ") : "describe-only";
			return ok
				? `validateGraphObservability: OK (${scope})`
				: `validateGraphObservability: ${failures.length} failure(s) across ${scope}`;
		},
	};
}
