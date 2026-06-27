import { hasKvVersioned, type KvGeneration, type KvStorageTier } from "./kv.js";

/** Result tier for read-through output facts. */
export interface ReadThroughLookupTier {
	/** Tier index in the ordered lookup list. `-1` = optional loader fallback. */
	readonly index: number;
	/** Optional human-facing tier name. */
	readonly name?: string;
}

/** Ordered lookup result from a single tier or loader attempt. */
type ReadThroughOutcome = "hit" | "miss" | "error";

/** Fact for one lookup attempt (one tier or the optional loader fallback). */
export interface ReadThroughLookupFact<T> {
	readonly kind: ReadThroughOutcome;
	readonly key: string;
	readonly tier: ReadThroughLookupTier;
	readonly value?: T;
	readonly generation?: KvGeneration;
	readonly error?: unknown;
}

/** Result of one promotion write attempt to an earlier tier. */
export interface ReadThroughPromotionFact {
	readonly tier: ReadThroughLookupTier;
	readonly ok: boolean;
	readonly error?: unknown;
}

/** Final read-through outcome, with explicit lookup facts and promotion facts. */
export interface TieredReadThroughResult<T> {
	readonly status: "hit" | "miss" | "error";
	readonly key: string;
	readonly value?: T;
	readonly hitTier?: ReadThroughLookupTier;
	readonly facts: readonly ReadThroughLookupFact<T>[];
	readonly promotions: readonly ReadThroughPromotionFact[];
}

/** Optional hook/context for lookup misses. */
export interface ReadThroughMissContext {
	readonly key: string;
	readonly tier: ReadThroughLookupTier;
}

/** Optional hook/context for get/load/promotion errors. */
export interface ReadThroughErrorContext {
	readonly key: string;
	readonly tier: ReadThroughLookupTier;
	readonly stage: "lookup" | "promotion";
	readonly error: unknown;
}

/** Configuration for `tieredReadThrough`. */
export interface TieredReadThroughOptions<T> {
	/** Lookup key for all tiers. */
	readonly key: string;
	/** Ordered lookup tiers, index 0 = hottest/fastest. */
	readonly tiers: readonly KvStorageTier<T>[];
	/** Optional friendly tier names, matched by index. */
	readonly tierNames?: readonly string[];
	/**
	 * Optional loader fallback for cache-miss. If provided and no tier hits, this runs
	 * after all tiers are checked and may write-through by promotion logic.
	 */
	readonly load?: (key: string) => Promise<T | undefined> | T | undefined;
	/**
	 * Optional promotion policy: set hit values to earlier (lower-index) tiers.
	 * `false` disables promotion; default promotes to all earlier tiers on any hit.
	 * Explicit indices can narrow promotion targets.
	 */
	readonly promoteTo?: readonly number[] | false;
	/** Optional callbacks for control-plane observability. */
	readonly onMiss?: (context: ReadThroughMissContext) => void;
	/** Called for lookup/load errors and promotion failures by default. */
	readonly onError?: (context: ReadThroughErrorContext) => void;
}

function defer<T>(fn: () => T | PromiseLike<T>): Promise<T> {
	return Promise.resolve().then(fn);
}

/** Alias for callers that prefer loader-oriented naming. */
export function readThroughKv<T>(
	opts: TieredReadThroughOptions<T>,
): Promise<TieredReadThroughResult<T>> {
	return tieredReadThrough(opts);
}

/**
 * Build explicit lookup facts across tiers plus optional loader fallback (D104 layer 1).
 *
 * This is a passive storage/domain helper: it creates no graph nodes, performs no hydration or
 * restore, and treats promotion writes as facts rather than a graph commit barrier.
 */
export function tieredReadThrough<T>(
	opts: TieredReadThroughOptions<T>,
): Promise<TieredReadThroughResult<T>> {
	const { key, tiers, tierNames = [], load, promoteTo, onMiss, onError } = opts;

	const lookupFacts: ReadThroughLookupFact<T>[] = [];
	const promotions: ReadThroughPromotionFact[] = [];
	let hitTier: ReadThroughLookupTier | undefined;
	let value: T | undefined;

	const safeOnMiss = (tier: ReadThroughLookupTier): void => {
		if (!onMiss) return;
		try {
			onMiss({ key, tier });
		} catch {
			/* no-op */
		}
	};

	const safeOnError = (context: ReadThroughErrorContext): void => {
		if (!onError) return;
		try {
			onError(context);
		} catch {
			/* no-op */
		}
	};

	const addFact = (fact: ReadThroughLookupFact<T>): void => {
		lookupFacts.push(fact);
	};

	const lookupTier = (index: number): ReadThroughLookupTier => ({
		index,
		name: tierNames[index],
	});

	const lookupNext = (index: number): Promise<void> => {
		if (hitTier !== undefined || index >= tiers.length) return defer(() => undefined);
		const tier = tiers[index]!;
		const info = lookupTier(index);
		const read = hasKvVersioned(tier)
			? defer(() => tier.getVersioned(key)).then((result) => {
					if (result.kind === "miss") {
						return { found: undefined, generation: result.generation } as const;
					}
					return { found: result.value, generation: result.generation } as const;
				})
			: defer(() => tier.get(key)).then((found) => ({ found, generation: undefined }) as const);
		return read
			.then(({ found, generation }) => {
				if (found === undefined) {
					addFact({ kind: "miss", key, tier: info, generation });
					safeOnMiss(info);
					return lookupNext(index + 1);
				}
				addFact({ kind: "hit", key, tier: info, value: found, generation });
				hitTier = info;
				value = found;
			})
			.catch((error) => {
				addFact({ kind: "error", key, tier: info, error });
				safeOnError({ key, tier: info, stage: "lookup", error });
				return lookupNext(index + 1);
			});
	};

	const runLoader = (): Promise<void> => {
		if (hitTier !== undefined || typeof load !== "function") return defer(() => undefined);
		const loaderTier: ReadThroughLookupTier = { index: -1, name: "load" };
		return defer(() => load(key))
			.then((loaded) => {
				if (loaded === undefined) {
					addFact({ kind: "miss", key, tier: loaderTier });
					safeOnMiss(loaderTier);
					return;
				}
				addFact({ kind: "hit", key, tier: loaderTier, value: loaded });
				hitTier = loaderTier;
				value = loaded;
			})
			.catch((error) => {
				addFact({ kind: "error", key, tier: loaderTier, error });
				safeOnError({ key, tier: loaderTier, stage: "lookup", error });
			});
	};

	const promoteNext = (targets: readonly number[], offset: number): Promise<void> => {
		if (offset >= targets.length || value === undefined) return defer(() => undefined);
		const index = targets[offset]!;
		const info = { index, name: tierNames[index] };
		const tier = tiers[index]!;
		const generation = generationForTier(lookupFacts, index);
		const write = hasKvVersioned(tier)
			? generation === undefined
				? defer<boolean>(() => {
						throw new Error(
							"tieredReadThrough: versioned promotion target was not observed with a generation",
						);
					})
				: defer(() => tier.setIfMatch(key, value as T, generation))
			: defer(() => tier.set(key, value as T)).then(() => true);
		return write
			.then((ok) => {
				promotions.push({ tier: info, ok });
			})
			.catch((error) => {
				promotions.push({ tier: info, ok: false, error });
				safeOnError({ key, tier: info, stage: "promotion", error });
			})
			.then(() => promoteNext(targets, offset + 1));
	};

	const promote = (): Promise<void> => {
		if (hitTier === undefined || value === undefined) return defer(() => undefined);
		const sourceIndex = hitTier.index === -1 ? tiers.length : hitTier.index;
		const targets = buildPromotionTargets(tiers.length, sourceIndex, promoteTo);
		return promoteNext(targets, 0);
	};

	const result = (): TieredReadThroughResult<T> => {
		const status: TieredReadThroughResult<T>["status"] = (() => {
			if (hitTier !== undefined && hitTier.index >= -1 && value !== undefined) return "hit";
			if (lookupFacts.some((fact) => fact.kind === "error")) return "error";
			return "miss";
		})();

		return {
			status,
			key,
			value,
			hitTier,
			facts: lookupFacts,
			promotions,
		};
	};

	return lookupNext(0).then(runLoader).then(promote).then(result);
}

function generationForTier<T>(
	facts: readonly ReadThroughLookupFact<T>[],
	index: number,
): KvGeneration | undefined {
	return facts.find((fact) => fact.tier.index === index)?.generation;
}

function buildPromotionTargets(
	tierCount: number,
	hitIndex: number,
	promoteTo?: readonly number[] | false,
): number[] {
	if (promoteTo === false || tierCount <= 0) return [];
	const maxPromote = Math.max(0, Math.min(hitIndex, tierCount));
	if (promoteTo === undefined) {
		return [...Array(maxPromote).keys()];
	}
	const normalized: number[] = [];
	const seen = new Set<number>();
	for (const index of promoteTo) {
		if (!Number.isSafeInteger(index) || index < 0 || index >= tierCount || index >= maxPromote) {
			continue;
		}
		if (!seen.has(index)) {
			seen.add(index);
			normalized.push(index);
		}
	}
	return normalized;
}
