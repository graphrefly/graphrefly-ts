/**
 * `simpleFactStore()` — the 80%-case ergonomic wrapper over
 * {@link reactiveFactStore} / {@link persistentReactiveFactStore}
 * (DS-14.7 follow-up #2; design LOCKED 2026-05-17 `/dev-dispatch` Q-walk,
 * Q1–Q6 + sub-decisions resolved).
 *
 * Closes the gap where a consumer wanting durable agent memory had to
 * hand-compose: an `ingest` source + `extractDependencies` + (optionally) a
 * `StorageBackend` + decay/consolidation recipes + the
 * `BigInt(monotonicNs())` fragment boilerplate. `simpleFactStore` owns all
 * of that and exposes a single ergonomic `remember(id, payload, opts?)`.
 *
 * **Q-walk locks (canonical: `docs/optimizations.md` DS-14.7 follow-up #2):**
 * - **Q1** — `extractDependencies` defaults to `() => []` (flat store;
 *   cascade inert by default — dependency-tracking is opt-in).
 * - **Q2** — single factory, **optional `storage`**: present → wraps
 *   {@link persistentReactiveFactStore} (durable, event-sourced); absent →
 *   in-memory {@link reactiveFactStore}.
 * - **Q3** — the wrapper **owns** the internal `ingest` source and exposes
 *   {@link SimpleFactStoreGraph.remember}. `remember` `.emit`s into the
 *   owned leaf source — this is the *sanctioned* external push that the
 *   `reactiveFactStore` ingest contract documents (same shape as the
 *   `decay`/replay recipes' `.emit`-into-source), **not** a spec-§5.9
 *   imperative trigger: it feeds DATA into a source node, it does not
 *   bypass topology for control flow. Reactive reads (`answer` / `review` /
 *   `events`) stay the canonical observation surface.
 * - **Q4** — auto-wire **default recipes** with internal `fromTimer`
 *   cadences (batteries-included; user-blessed 2026-05-17). `decay` is
 *   generically meaningful (confidence forgetting needs no domain
 *   knowledge) → **ON by default** with conservative defaults
 *   ({@link DEFAULT_DECAY_HALF_LIFE_NS} / {@link DEFAULT_DECAY_PERIOD_MS}),
 *   tunable or `false` to disable. `consolidate` is **domain-bound** —
 *   {@link consolidationRem} *requires* a `summarize` (there is no generic
 *   default; an arbitrary `T` cannot be summarized blindly), so it is wired
 *   **iff** the caller supplies `opts.consolidate`. This consolidation
 *   asymmetry is dictated by the recipe's own required contract, not an
 *   autonomous downgrade of the Q4 lock.
 * - **Q5** — minimal input: `remember(id, payload, { tags? })` auto-fills
 *   `t_ns = BigInt(monotonicNs())` (per the {@link MemoryFragment.t_ns}
 *   contract + the clock-return-type rule — `monotonicNs()` is `number`,
 *   the `BigInt(...)` wrap is load-bearing) and `confidence = 1`.
 * - **Q6** — **wraps** the existing factories (not a parallel impl).
 *
 * Presentation-only (`@graphrefly/graphrefly`, `utils/memory` barrel),
 * universal tier (`fromTimer` only, no `node:*`/DOM — the optional
 * `StorageBackend` impl's tier is the *caller's* concern, forwarded
 * verbatim, exactly as {@link persistentReactiveFactStore} does).
 *
 * @module
 */

import { monotonicNs, node } from "@graphrefly/pure-ts/core";
import type { Codec, StorageBackend } from "@graphrefly/pure-ts/extra";
import type { FactId, MemoryFragment, ReactiveFactStoreGraph } from "./fact-store.js";
import { reactiveFactStore } from "./fact-store.js";
import type { PersistentReactiveFactStoreGraph } from "./persistent-fact-store.js";
import { persistentReactiveFactStore } from "./persistent-fact-store.js";
import { type ConsolidationRemOptions, consolidationRem } from "./recipes/consolidation-rem.js";
import { type DecayExponentialOptions, decayExponential } from "./recipes/decay-exponential.js";

/**
 * Default exponential-decay half-life: **7 days** in nanoseconds. Confidence
 * halves once per week of fact age — gentle forgetting suitable for the
 * 80%-case agent memory. Override via `opts.decay.halfLifeNs`.
 */
export const DEFAULT_DECAY_HALF_LIFE_NS = 604_800_000_000_000n; // 7 * 24 * 3600 * 1e9

/**
 * Default decay tick cadence: **1 hour** (ms). How often the forgetting pass
 * runs. Override via `opts.decay.periodMs`.
 */
export const DEFAULT_DECAY_PERIOD_MS = 3_600_000; // 60 * 60 * 1000

/** Per-fact override fields accepted by {@link SimpleFactStoreGraph.remember}. */
export interface RememberOptions {
	/** Tags. Default `[]`. */
	readonly tags?: readonly string[];
	/** Dependency edges (fact IDs this fact derives from). Default `[]`. */
	readonly sources?: readonly FactId[];
	/** Confidence 0..1. Default `1`. */
	readonly confidence?: number;
	/** Valid-time end — set to obsolete a fact (MEME L3 lever). */
	readonly validTo?: bigint;
	/** Valid-time start — `undefined` = unbounded past. */
	readonly validFrom?: bigint;
	/** Free-form provenance string. */
	readonly provenance?: string;
}

export interface SimpleFactStoreOptions<T> {
	/**
	 * Durable backing. Present → delegates to
	 * {@link persistentReactiveFactStore} (event-sourced, replay-on-start,
	 * substrate-owned cursor). Absent → in-memory {@link reactiveFactStore}.
	 * The backend's runtime tier (node / browser) is the caller's concern —
	 * forwarded verbatim.
	 */
	readonly storage?: StorageBackend;
	/**
	 * Cascade dependency extractor. **Default `() => []`** — flat store, no
	 * cascade. Supply to opt into MEME L2 cascade invalidation.
	 */
	readonly extractDependencies?: (f: MemoryFragment<T>) => readonly FactId[];
	/**
	 * Exponential-decay forgetting. **Default: ON** with
	 * {@link DEFAULT_DECAY_HALF_LIFE_NS} / {@link DEFAULT_DECAY_PERIOD_MS}.
	 * Pass a partial to tune; pass `false` to disable. Wires an internal
	 * `fromTimer` (the user-blessed batteries-included cadence).
	 */
	readonly decay?: false | Partial<DecayExponentialOptions>;
	/**
	 * REM-replay consolidation. **Domain-bound** — requires a `summarize`
	 * (no generic default exists). Supply the full
	 * {@link ConsolidationRemOptions} to enable; omit to disable. Wires an
	 * internal `fromTimer` at `consolidate.periodMs`.
	 */
	readonly consolidate?: ConsolidationRemOptions<T>;
	/** Persistent-only: durable bucket name. Default `fact_store_ingest`. */
	readonly persistName?: string;
	/** Persistent-only: durable codec. Default `bigintJsonCodecFor`. */
	readonly codec?: Codec<readonly MemoryFragment<T>[]>;
}

/**
 * The ergonomic write added to every `simpleFactStore` graph. Normalizes to a
 * {@link MemoryFragment} (auto `t_ns = BigInt(monotonicNs())`,
 * `confidence = 1`, `tags`/`sources` = `[]`) and `.emit`s it into the owned
 * `ingest` source. Re-`remember`ing an existing `id` is the MEME L1
 * direct-replace lever; set `opts.validTo` to obsolete (MEME L3).
 */
export type SimpleFactStoreRemember<T> = (id: FactId, payload: T, opts?: RememberOptions) => void;

/**
 * In-memory `simpleFactStore` graph (no `storage`) augmented with
 * {@link SimpleFactStoreRemember}.
 */
export interface SimpleFactStoreGraph<T> extends ReactiveFactStoreGraph<T> {
	remember: SimpleFactStoreRemember<T>;
}

/**
 * Durable (`storage`-backed) `simpleFactStore` graph — the **type-honest**
 * persistent surface. EC-LOW-1 (`/qa` 2026-05-17): the `storage` overload
 * returns this so `position` / `replayedCount` / `flush` / `tier` are typed
 * without a hand-cast (the durable path is the headline 80%-case).
 */
export type PersistentSimpleFactStoreGraph<T> = PersistentReactiveFactStoreGraph<T> & {
	remember: SimpleFactStoreRemember<T>;
};

/**
 * Build a fact store with sensible defaults and a one-call `remember`.
 *
 * @example
 * ```ts
 * import { simpleFactStore } from "@graphrefly/graphrefly/utils/memory";
 * import { memoryBackend } from "@graphrefly/graphrefly/extra";
 *
 * const mem = simpleFactStore<string>(); // in-memory, decay ON
 * mem.remember("user:lang", "TypeScript", { tags: ["pref"] });
 * mem.answer.subscribe((a) => console.log(a)); // reactive read
 *
 * // Durable: the `storage` overload returns the typed persistent surface
 * // (no hand-cast needed for `position` / `flush`).
 * const durable = simpleFactStore<string>({ storage: memoryBackend() });
 * durable.remember("k", "v");
 * await durable.flush();
 * ```
 *
 * @category memory
 */
export function simpleFactStore<T>(
	opts: SimpleFactStoreOptions<T> & { storage: StorageBackend },
): PersistentSimpleFactStoreGraph<T>;
export function simpleFactStore<T>(opts?: SimpleFactStoreOptions<T>): SimpleFactStoreGraph<T>;
export function simpleFactStore<T>(opts: SimpleFactStoreOptions<T> = {}): SimpleFactStoreGraph<T> {
	// Q3: the wrapper OWNS the ingest source (a leaf source — no deps).
	const ingest = node<MemoryFragment<T>>([], { initial: undefined });
	const extractDependencies = opts.extractDependencies ?? (() => []);

	// Consolidation is config-time (recipe returns `{consolidateTrigger,
	// consolidate}` to spread BEFORE construction) — unlike decay, which is a
	// post-construction self-add. Wire it iff a domain `summarize` was given.
	const consolidationCfg = opts.consolidate ? consolidationRem<T>(opts.consolidate) : undefined;

	const baseCfg = {
		ingest,
		extractDependencies,
		...(consolidationCfg ?? {}),
	};

	const mem = opts.storage
		? persistentReactiveFactStore<T>({
				...baseCfg,
				storage: opts.storage,
				...(opts.persistName !== undefined ? { persistName: opts.persistName } : {}),
				...(opts.codec !== undefined ? { codec: opts.codec } : {}),
			})
		: reactiveFactStore<T>(baseCfg);

	// Q4: decay ON by default (generic; needs no domain knowledge).
	if (opts.decay !== false) {
		const d = opts.decay ?? {};
		// EC-LOW-2 (/qa 2026-05-17): spread-then-default forwards ANY future
		// `DecayExponentialOptions` field automatically (the prior key-by-key
		// enumeration would silently drop a newly-added recipe knob). `d` is
		// `Partial<DecayExponentialOptions>`; under `exactOptionalPropertyTypes`
		// a present-but-`undefined` optional is rejected at the *caller's* site,
		// so `...d` only ever carries defined values or absent keys — the two
		// required fields are explicitly defaulted after the spread.
		decayExponential<T>(mem, ingest, {
			...d,
			halfLifeNs: d.halfLifeNs ?? DEFAULT_DECAY_HALF_LIFE_NS,
			periodMs: d.periodMs ?? DEFAULT_DECAY_PERIOD_MS,
		});
	}

	const remember = (id: FactId, payload: T, ro?: RememberOptions): void => {
		// Q5: minimal input → full MemoryFragment. `t_ns` MUST `BigInt`-wrap
		// `monotonicNs()` (it returns `number`; the wrap is load-bearing per
		// the clock-return-type rule + the `MemoryFragment.t_ns` contract).
		const fragment: MemoryFragment<T> = {
			id,
			payload,
			t_ns: BigInt(monotonicNs()),
			confidence: ro?.confidence ?? 1,
			tags: ro?.tags ?? [],
			sources: ro?.sources ?? [],
			...(ro?.validTo !== undefined ? { validTo: ro.validTo } : {}),
			...(ro?.validFrom !== undefined ? { validFrom: ro.validFrom } : {}),
			...(ro?.provenance !== undefined ? { provenance: ro.provenance } : {}),
		};
		ingest.emit(fragment);
	};

	// Augment the constructed graph in place (it IS the returned product;
	// `remember` is the only addition over the wrapped factory's surface).
	const out = mem as ReactiveFactStoreGraph<T> & {
		remember: SimpleFactStoreGraph<T>["remember"];
	};
	out.remember = remember;
	return out;
}
