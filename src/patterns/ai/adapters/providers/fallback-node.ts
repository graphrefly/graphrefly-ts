/**
 * Node-subpath extension of {@link fallbackAdapter} — adds filesystem
 * directory convenience options (`fixturesDir`, `record.dir`) that rely on
 * `node:fs` / `node:path` / `fileStorage`.
 *
 * This module intentionally lives outside the main `patterns/ai` entry so
 * browser bundles don't pull `node:fs` / `node:path`. Import this variant
 * from `@graphrefly/graphrefly/patterns/ai/node` in Node
 * environments when you want the ergonomic directory options.
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StorageTier } from "../../../../extra/storage-core.js";
import { fileStorage } from "../../../../extra/storage-node.js";
import type { LLMAdapter } from "../core/types.js";
import {
	type FallbackAdapterOptions as BaseFallbackAdapterOptions,
	fallbackAdapter as baseFallbackAdapter,
} from "./fallback.js";

/**
 * Options for the node-only `fallbackAdapter`. Adds `fixturesDir` and
 * `record.dir` to the base options.
 */
export interface NodeFallbackAdapterOptions extends Omit<BaseFallbackAdapterOptions, "record"> {
	/**
	 * Directory of cache-format JSON files. Auto-namespaced to
	 * `join(dir, keyPrefix)` so multiple adapters pointing at the same root
	 * don't commingle files. Init-time validator throws a clear `TypeError`
	 * if the namespaced subdirectory contains files that aren't in cache
	 * format. Mutually exclusive with `fixtures` and `fixturesStorage`.
	 */
	readonly fixturesDir?: string;
	/**
	 * Record mode — same as the base, with `dir` as a convenience sibling to
	 * `storage`. `dir` auto-namespaces to `join(dir, keyPrefix)`; `storage` is
	 * pass-through. If `dir` is omitted and `fixturesDir` is set, record
	 * defaults to writing to `fixturesDir` — the "read baseline, append
	 * misses to same dir" pattern.
	 */
	readonly record?: {
		readonly adapter: LLMAdapter;
		readonly dir?: string;
		readonly storage?: StorageTier;
	};
}

/**
 * Validate that a namespaced `fixturesDir` subdirectory only contains files
 * in the cache format `withReplayCache` writes. Throws a clear `TypeError`
 * if a hand-authored `{messages, response}` JSON (or any non-cache JSON) is
 * present. Scans the first `.json` file found — doesn't read the whole set.
 * Silently returns if the directory doesn't exist yet (first-run case).
 */
function validateDirShape(dir: string): void {
	if (!existsSync(dir)) return;
	const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	if (files.length === 0) return;
	const sample = files[0] as string;
	const path = join(dir, sample);
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		throw new TypeError(`fallbackAdapter: ${path} is not valid JSON (${(err as Error).message}).`);
	}
	const asObj = raw as {
		response?: { content?: unknown };
		storedAtNs?: unknown;
		messages?: unknown;
	} | null;
	const looksLikeHandAuthored = asObj != null && "messages" in asObj;
	const missingFields =
		asObj == null ||
		typeof asObj.response?.content !== "string" ||
		typeof asObj.storedAtNs !== "number";
	if (looksLikeHandAuthored || missingFields) {
		const hint = looksLikeHandAuthored
			? "`messages` at the top level means this looks hand-authored. "
			: "";
		throw new TypeError(
			`fallbackAdapter: ${path} is not in cache-file format. ${hint}` +
				"Expected `{ response: { content, usage, ... }, storedAtNs, ... }` " +
				"(the shape `withReplayCache` and this adapter's `record` mode write). " +
				"For hand-authored fixtures, use the inline `fixtures: FallbackFixture[]` " +
				"option — the adapter hashes messages for you.",
		);
	}
}

/**
 * Node-only `fallbackAdapter` — the base variant extended with `fixturesDir`
 * and `record.dir` filesystem convenience options. Resolves those to
 * `fileStorage(...)` tiers and delegates to the base `fallbackAdapter`.
 *
 * For browser-safe usage, import `fallbackAdapter` from
 * `@graphrefly/graphrefly/patterns/ai` instead — that variant only accepts
 * `fixtures` and `fixturesStorage`, no `node:*` imports.
 */
export function fallbackAdapter(opts: NodeFallbackAdapterOptions = {}): LLMAdapter {
	const keyPrefix = opts.keyPrefix ?? "fallback";

	// Enforce mutual exclusion across the three fixture sources — same rule as
	// the base adapter, extended with `fixturesDir`.
	const sources: string[] = [];
	if (opts.fixtures != null) sources.push("fixtures");
	if (opts.fixturesDir != null) sources.push("fixturesDir");
	if (opts.fixturesStorage != null) sources.push("fixturesStorage");
	if (sources.length > 1) {
		throw new TypeError(
			`fallbackAdapter: \`fixtures\`, \`fixturesDir\`, and \`fixturesStorage\` ` +
				`are mutually exclusive; got both ${sources.join(" and ")}. Pick one source.`,
		);
	}

	// Resolve `fixturesDir` → `fileStorage(join(dir, keyPrefix))`.
	let fixturesStorage = opts.fixturesStorage;
	if (opts.fixturesDir != null) {
		const namespaced = join(opts.fixturesDir, keyPrefix);
		validateDirShape(namespaced);
		fixturesStorage = fileStorage(namespaced);
	}

	// Resolve record mode:
	// - `record.storage` pass-through;
	// - `record.dir` → `fileStorage(join(record.dir, keyPrefix))`;
	// - `record.dir` defaults to `fixturesDir` for "append to same dir".
	let record: BaseFallbackAdapterOptions["record"] | undefined;
	if (opts.record) {
		if (opts.record.storage && opts.record.dir) {
			throw new TypeError(
				"fallbackAdapter: `record.storage` and `record.dir` are mutually exclusive; pick one.",
			);
		}
		if (opts.record.storage) {
			record = { adapter: opts.record.adapter, storage: opts.record.storage };
		} else {
			const recordDir = opts.record.dir ?? opts.fixturesDir;
			if (recordDir == null) {
				throw new TypeError(
					"fallbackAdapter: record mode requires either `record.dir`, `record.storage`, " +
						"or an inherited `fixturesDir`.",
				);
			}
			record = {
				adapter: opts.record.adapter,
				storage: fileStorage(join(recordDir, keyPrefix)),
			};
		}
	}

	// Hand off to the base adapter with resolved tiers. No filesystem handles
	// leak beyond this module — the base sees only `StorageTier` abstractions.
	// Destructure `fixturesDir` out up front rather than spread-then-delete so
	// the forwarded shape stays frozen-friendly and doesn't carry the already-
	// resolved directory option through to the base's (stricter) opt type.
	const { fixturesDir: _omit, record: _recordOmit, ...restOpts } = opts;
	const baseOpts: BaseFallbackAdapterOptions = {
		...restOpts,
		...(fixturesStorage ? { fixturesStorage } : {}),
		...(record ? { record } : {}),
	};
	return baseFallbackAdapter(baseOpts);
}

// Re-export shared types so users can import everything from the node subpath.
export type {
	FallbackAdapterOptions as BaseFallbackAdapterOptions,
	FallbackFixture,
	FallbackMissError,
	FallbackMissPolicy,
} from "./fallback.js";
