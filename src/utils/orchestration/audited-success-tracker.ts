/**
 * `auditedSuccessTracker` — domain-agnostic per-key success-rate tracker.
 *
 * Reactive `key → { attempts, successes, successRate }` map mounted as a
 * Graph subclass. Reusable substrate for any domain that needs to track
 * outcomes per identifier (routing strategy effectiveness, A/B-test arms,
 * cache-policy tuning, retry-strategy selection, etc.).
 *
 * Replaces the prior `effectivenessTracker` and `strategyModel` factories
 * (Class B audit Alt E collapse, 2026-04-30). Composite-key callers (e.g.
 * `rootCause × intervention`) convert to a string key at the call site.
 *
 * @module
 */

import type { Node } from "@graphrefly/pure-ts/core/node.js";
import { keepalive, type ReactiveMapBundle, reactiveMap } from "@graphrefly/pure-ts/extra";
import { Graph, type GraphOptions } from "@graphrefly/pure-ts/graph";

/** A single success-rate record for one key. */
export interface AuditedSuccessEntry<TKey extends string = string> {
	readonly key: TKey;
	readonly attempts: number;
	readonly successes: number;
	readonly successRate: number;
}

/** Snapshot shape — fresh `ReadonlyMap` on every mutation. */
export type AuditedSuccessSnapshot<
	TKey extends string = string,
	TEntry extends AuditedSuccessEntry<TKey> = AuditedSuccessEntry<TKey>,
> = ReadonlyMap<TKey, TEntry>;

/** Options for {@link auditedSuccessTracker}. */
export interface AuditedSuccessTrackerOptions {
	/** Optional graph identity (passed to the underlying Graph constructor). */
	graph?: GraphOptions;
	/** Name of the tracker subgraph. Default `"audited-success-tracker"`. */
	name?: string;
}

/**
 * Reactive success-rate tracker mounted as a Graph subclass.
 *
 * `key → AuditedSuccessEntry` with `record(key, success, extra?)` /
 * `lookup(key)` methods. The {@link entries} field is a
 * `Node<ReadonlyMap<TKey, TEntry>>` suitable for graph composition —
 * exposed under name `"entries"` for `describe()` / `explain()`.
 *
 * Backed by the {@link reactiveMap} substrate; each successful `record(...)`
 * fires a DATA emission carrying the post-mutation map.
 *
 * **Field name.** This Graph subclass uses `entries` (not `snapshot`) for
 * the public-face Node because `Graph.prototype.snapshot()` is the
 * built-in persistence-snapshot method on the parent class — using
 * `snapshot` here would shadow it and break DTS generation.
 *
 * @typeParam TKey - String-typed key shape. Composite-key domains (e.g.
 *   `rootCause × intervention`) convert to a string at the call site.
 * @typeParam TEntry - Entry shape; defaults to {@link AuditedSuccessEntry}.
 *   Domains that need extra fields (e.g. `rootCause`/`intervention`) extend
 *   this interface and pass the extra fields via `record(...)`'s `extra` arg.
 */
export class AuditedSuccessTrackerGraph<
	TKey extends string = string,
	TEntry extends AuditedSuccessEntry<TKey> = AuditedSuccessEntry<TKey>,
> extends Graph {
	/** Reactive entries — `Node<ReadonlyMap<TKey, TEntry>>`, fresh map per mutation. */
	readonly entries: Node<AuditedSuccessSnapshot<TKey, TEntry>>;

	private readonly _map: ReactiveMapBundle<TKey, TEntry>;

	constructor(opts?: AuditedSuccessTrackerOptions) {
		super(opts?.name ?? "audited-success-tracker", opts?.graph);
		this._map = reactiveMap<TKey, TEntry>({ name: "entries" });
		this.entries = this._map.entries;
		this.add(this.entries, { name: "entries" });

		// Keep the entries node activated without external subscribers so
		// `tracker.entries.cache` is readable from sync code paths and
		// `lookup()` callers don't have to manage subscriptions. Released on
		// Graph dispose along with the underlying reactiveMap.
		this.addDisposer(keepalive(this.entries));
		this.addDisposer(() => this._map.dispose());
	}

	/**
	 * Record a completed attempt. `extra` fields are merged into the stored
	 * entry — use for domain-specific decoration (e.g. `{ rootCause,
	 * intervention }` on the strategy-model collapse path).
	 *
	 * **Caller contract for typed `TEntry`.** When `TEntry` extends
	 * {@link AuditedSuccessEntry} with required fields beyond
	 * `key`/`attempts`/`successes`/`successRate`, the caller must supply
	 * those required fields in `extra` on the **first** `record(key, ...)`
	 * for that key. The internal `as TEntry` cast trusts this. Subsequent
	 * `record(key, ...)` calls inherit the prior entry's fields, so `extra`
	 * may be omitted or partial. Forgetting required fields on the first
	 * record produces an entry whose typed-required fields are `undefined`
	 * at runtime — TS won't catch it. Strategy callers always pass
	 * `{ rootCause, intervention }`, so the StrategyEntry case is safe.
	 */
	record(
		key: TKey,
		success: boolean,
		extra?: Partial<Omit<TEntry, "key" | "attempts" | "successes" | "successRate">>,
	): void {
		const existing = this._map.get(key);
		const attempts = (existing?.attempts ?? 0) + 1;
		const successes = (existing?.successes ?? 0) + (success ? 1 : 0);
		this._map.set(key, {
			...(existing ?? {}),
			...(extra ?? {}),
			key,
			attempts,
			successes,
			successRate: successes / attempts,
		} as TEntry);
	}

	/**
	 * Look up the entry for a key.
	 *
	 * Pure read: this tracker doesn't configure a TTL on the underlying
	 * `reactiveMap`, so `_map.get(key)` never triggers TTL-expiry pruning
	 * (which would otherwise be an observable side effect emitting a fresh
	 * `entries` snapshot). If `AuditedSuccessTrackerOptions` ever gains a
	 * `mapOptions` carve-out exposing TTL, revisit this contract.
	 */
	lookup(key: TKey): TEntry | undefined {
		return this._map.get(key);
	}
}

/**
 * Construct an {@link AuditedSuccessTrackerGraph}. Replaces the prior
 * `effectivenessTracker()` and `strategyModel()` factories.
 *
 * @example
 * ```ts
 * // Generic per-action tracker
 * const tracker = auditedSuccessTracker({ name: "ab-test" });
 * tracker.record("variant-a", true);
 * tracker.record("variant-b", false);
 * tracker.entries.subscribe(snap => console.log(snap.get("variant-a")));
 *
 * // Composite-key (rootCause × intervention) tracker — caller computes the key
 * type StrategyEntry = AuditedSuccessEntry<StrategyKey> & {
 *   rootCause: RootCause;
 *   intervention: Intervention;
 * };
 * const strategy = auditedSuccessTracker<StrategyKey, StrategyEntry>({
 *   name: "strategy",
 * });
 * strategy.record(
 *   strategyKey(rootCause, intervention),
 *   true,
 *   { rootCause, intervention },
 * );
 * ```
 *
 * @category extra
 */
export function auditedSuccessTracker<
	TKey extends string = string,
	TEntry extends AuditedSuccessEntry<TKey> = AuditedSuccessEntry<TKey>,
>(opts?: AuditedSuccessTrackerOptions): AuditedSuccessTrackerGraph<TKey, TEntry> {
	return new AuditedSuccessTrackerGraph<TKey, TEntry>(opts);
}
