import { type Ctx, depBatch, depLatest } from "../ctx/types.js";
import type { Node } from "../node/node.js";
import { errorPayload } from "../protocol/messages.js";
import { hasKvVersioned, type KvGeneration, type KvStorageTier } from "../storage/kv.js";
import {
	type ReadThroughLookupFact,
	type ReadThroughLookupTier,
	type TieredReadThroughResult,
	tieredReadThrough,
} from "../storage/read-through.js";
import type { Graph, SugarOpts } from "./graph.js";

/** Dynamic read-through policy for {@link reactiveCascadingCache}. */
export interface CascadingCachePolicy {
	readonly promoteTo?: readonly number[] | false;
}

export type CascadingCacheStatus<K> =
	| { readonly kind: "idle" }
	| { readonly kind: "loading"; readonly key: K; readonly requestSeq: number }
	| {
			readonly kind: "hit";
			readonly key: K;
			readonly requestSeq: number;
			readonly tier?: ReadThroughLookupTier;
	  }
	| { readonly kind: "miss"; readonly key: K; readonly requestSeq: number }
	| {
			readonly kind: "error";
			readonly key: K;
			readonly requestSeq: number;
			readonly error: unknown;
	  };

export type CascadingCacheEvent<K, V> =
	| { readonly kind: "request"; readonly key: K; readonly requestSeq: number }
	| { readonly kind: "invalidate"; readonly key: K; readonly requestSeq: number }
	| {
			readonly kind: "lookup";
			readonly key: K;
			readonly requestSeq: number;
			readonly outcome: "hit" | "miss" | "error";
			readonly tier: ReadThroughLookupTier;
			readonly value?: V;
			readonly error?: unknown;
	  }
	| {
			readonly kind: "promotion";
			readonly key: K;
			readonly requestSeq: number;
			readonly tier: ReadThroughLookupTier;
			readonly ok: boolean;
			readonly error?: unknown;
	  }
	| {
			readonly kind: "fill";
			readonly key: K;
			readonly requestSeq: number;
			readonly status: "hit" | "miss" | "error";
			readonly value?: V;
			readonly tier?: ReadThroughLookupTier;
			readonly error?: unknown;
	  }
	| {
			readonly kind: "error";
			readonly key: K;
			readonly requestSeq: number;
			readonly stage: "lookup" | "promotion";
			readonly tier?: ReadThroughLookupTier;
			readonly error: unknown;
	  };

export interface ReactiveCascadingCacheOptions<K extends string, V> {
	readonly graph: Graph;
	readonly request: Node<K>;
	readonly policy?: Node<CascadingCachePolicy>;
	readonly invalidate?: Node<K>;
	readonly tiers: readonly KvStorageTier<V>[];
	readonly load?: (key: K) => Promise<V | undefined> | V | undefined;
	readonly tierNames?: readonly string[];
	/**
	 * Storage promotion is explicit for the graph-layer factory. `requestSeq` guards visible graph
	 * value/status updates; without a generation/CAS storage contract, passive tier writes are
	 * best-effort and cannot be made stale-proof once an async `set` has started.
	 *
	 * @default false
	 */
	readonly promoteTo?: readonly number[] | false;
	readonly name?: string;
	readonly meta?: Record<string, unknown>;
}

export interface ReactiveCascadingCache<K, V> {
	readonly value: Node<V | undefined>;
	readonly status: Node<CascadingCacheStatus<K>>;
	readonly events: Node<CascadingCacheEvent<K, V>>;
}

interface DriverState<K> {
	seq: number;
	active: boolean;
	dropBeforeSeq: number;
	latestKey?: K;
}

interface SeqState {
	seq: number;
}

/**
 * Free-standing graph-layer cascading cache factory (D104/D105/D107).
 *
 * Passive tiers stay in `tieredReadThrough`; this factory wraps lookup work at an async pool
 * boundary and exposes every request, invalidation, lookup, promotion, fill, status, and value
 * change through declared graph nodes. `requestSeq` is the stale-fill guard for visible graph
 * nodes: older async fills may still be observable as events, but downstream value/status nodes
 * ignore them. Storage promotion defaults to `false` here because passive tier writes have no
 * generation/CAS contract; callers may opt in with `promoteTo` when best-effort promotion is
 * acceptable.
 */
export function reactiveCascadingCache<K extends string, V>(
	opts: ReactiveCascadingCacheOptions<K, V>,
): ReactiveCascadingCache<K, V> {
	const {
		graph: g,
		request,
		policy,
		invalidate,
		tiers,
		tierNames,
		promoteTo,
		load,
		name,
		meta,
	} = opts;
	const eventDeps: Node<unknown>[] = [request];
	const policyIndex = policy === undefined ? -1 : eventDeps.push(policy) - 1;
	const invalidateIndex = invalidate === undefined ? -1 : eventDeps.push(invalidate) - 1;
	const baseName = name ?? "reactiveCascadingCache";
	const eventOpts: SugarOpts<CascadingCacheEvent<K, V>> = {
		name: `${baseName}.events`,
		meta,
		partial: true,
		pool: "async",
	};
	const events = g.node<CascadingCacheEvent<K, V>>(
		eventDeps,
		(ctx) => {
			const st = ctx.state.get<DriverState<K>>() ?? {
				seq: 0,
				active: true,
				dropBeforeSeq: 0,
			};
			st.active = true;
			ctx.onDeactivation(() => {
				st.active = false;
				st.seq += 1;
				st.dropBeforeSeq = st.seq;
			});
			const requestBatch = depBatch(ctx, 0) as readonly K[] | null;
			const invalidateBatch =
				invalidateIndex === -1 ? null : (depBatch(ctx, invalidateIndex) as readonly K[] | null);
			const policyBatch =
				policyIndex === -1
					? null
					: (depBatch(ctx, policyIndex) as readonly CascadingCachePolicy[] | null);
			const currentPolicy =
				policyIndex === -1
					? undefined
					: (depLatest(ctx, policyIndex) as CascadingCachePolicy | undefined);

			if (requestBatch !== null) {
				for (const key of requestBatch) {
					startLookup(ctx, st, {
						kind: "request",
						key,
						tiers,
						tierNames,
						load,
						promoteTo: currentPolicy?.promoteTo ?? promoteTo ?? false,
					});
				}
			}

			if (invalidateBatch !== null) {
				for (const key of invalidateBatch) {
					startLookup(ctx, st, {
						kind: "invalidate",
						key,
						tiers,
						tierNames,
						load,
						promoteTo: currentPolicy?.promoteTo ?? promoteTo ?? false,
					});
				}
			}

			if (requestBatch === null && invalidateBatch === null && policyBatch !== null) {
				const key = st.latestKey;
				if (key !== undefined) {
					startLookup(ctx, st, {
						kind: "request",
						key,
						tiers,
						tierNames,
						load,
						promoteTo: currentPolicy?.promoteTo ?? promoteTo ?? false,
					});
				}
			}

			ctx.state.set(st);
		},
		eventOpts,
	);

	const status = g.node<CascadingCacheStatus<K>>(
		[events],
		(ctx) => {
			const st = ctx.state.get<SeqState>() ?? { seq: 0 };
			const batch = depBatch(ctx, 0) as readonly CascadingCacheEvent<K, V>[] | null;
			if (batch === null) return;
			for (const event of batch) {
				if (event.kind === "request" || event.kind === "invalidate") {
					st.seq = event.requestSeq;
					ctx.down([["DATA", { kind: "loading", key: event.key, requestSeq: event.requestSeq }]]);
					continue;
				}
				if (event.requestSeq !== st.seq) continue;
				if (event.kind === "fill") {
					if (event.status === "hit") {
						ctx.down([
							[
								"DATA",
								{
									kind: "hit",
									key: event.key,
									requestSeq: event.requestSeq,
									tier: event.tier,
								},
							],
						]);
					} else if (event.status === "miss") {
						ctx.down([["DATA", { kind: "miss", key: event.key, requestSeq: event.requestSeq }]]);
					} else {
						ctx.down([
							[
								"DATA",
								{
									kind: "error",
									key: event.key,
									requestSeq: event.requestSeq,
									error: event.error,
								},
							],
						]);
					}
				} else if (event.kind === "error") {
					ctx.down([
						[
							"DATA",
							{
								kind: "error",
								key: event.key,
								requestSeq: event.requestSeq,
								error: event.error,
							},
						],
					]);
				}
			}
			ctx.state.set(st);
		},
		{
			name: `${baseName}.status`,
			initial: { kind: "idle" },
			meta,
			partial: true,
		},
	);

	const value = g.node<V | undefined>(
		[events],
		(ctx) => {
			const st = ctx.state.get<SeqState>() ?? { seq: 0 };
			const batch = depBatch(ctx, 0) as readonly CascadingCacheEvent<K, V>[] | null;
			if (batch === null) return;
			for (const event of batch) {
				if (event.kind === "request") {
					st.seq = event.requestSeq;
					continue;
				}
				if (event.kind === "invalidate") {
					st.seq = event.requestSeq;
					ctx.down([["INVALIDATE"]]);
					continue;
				}
				if (event.kind !== "fill" || event.requestSeq !== st.seq) continue;
				if (event.status === "hit" && event.value !== undefined) {
					ctx.down([["DATA", event.value]]);
				} else {
					ctx.down([["INVALIDATE"]]);
				}
			}
			ctx.state.set(st);
		},
		{
			name: `${baseName}.value`,
			meta,
			partial: true,
		},
	);

	return { value, status, events };
}

function startLookup<K extends string, V>(
	ctx: Ctx,
	st: DriverState<K>,
	opts: {
		readonly kind: "request" | "invalidate";
		readonly key: K;
		readonly tiers: readonly KvStorageTier<V>[];
		readonly tierNames?: readonly string[];
		readonly load?: (key: K) => Promise<V | undefined> | V | undefined;
		readonly promoteTo?: readonly number[] | false;
	},
): void {
	const requestSeq = st.seq + 1;
	st.seq = requestSeq;
	st.latestKey = opts.key;
	ctx.down([["DATA", { kind: opts.kind, key: opts.key, requestSeq }]]);
	tieredReadThrough<V>({
		key: opts.key,
		tiers: opts.tiers,
		tierNames: opts.tierNames,
		load: opts.load === undefined ? undefined : (key) => opts.load?.(key as K),
		promoteTo: false,
	}).then(
		(result) => {
			promoteFresh(ctx, st, requestSeq, {
				key: opts.key,
				tiers: opts.tiers,
				tierNames: opts.tierNames,
				promoteTo: opts.promoteTo,
				result,
			});
		},
		(error) => {
			if (!isLiveRequest(st, requestSeq)) return;
			ctx.down([
				[
					"DATA",
					{
						kind: "error",
						key: opts.key,
						requestSeq,
						stage: "lookup",
						error: errorPayload(error),
					},
				],
			]);
		},
	);
}

function promoteFresh<K, V>(
	ctx: Ctx,
	st: DriverState<K>,
	requestSeq: number,
	opts: {
		readonly key: K;
		readonly tiers: readonly KvStorageTier<V>[];
		readonly tierNames?: readonly string[];
		readonly promoteTo?: readonly number[] | false;
		readonly result: TieredReadThroughResult<V>;
	},
	promotions: Array<{ tier: ReadThroughLookupTier; ok: boolean; error?: unknown }> = [],
	offset = 0,
): void {
	if (!isLiveRequest(st, requestSeq)) return;
	const { result } = opts;
	const sourceIndex = result.hitTier?.index === -1 ? opts.tiers.length : result.hitTier?.index;
	const targets =
		result.value === undefined || sourceIndex === undefined
			? []
			: buildPromotionTargets(opts.tiers.length, sourceIndex, opts.promoteTo);
	if (st.seq !== requestSeq || offset >= targets.length) {
		const messages = eventsFromResult(opts.key, requestSeq, result, promotions);
		if (messages.length > 0) ctx.down(messages);
		return;
	}
	const index = targets[offset] as number;
	const tier = { index, name: opts.tierNames?.[index] };
	try {
		const target = opts.tiers[index]!;
		const generation = generationForTier(result.facts, index);
		const write =
			hasKvVersioned(target) && generation !== undefined
				? target.setIfMatch(opts.key as string, result.value as V, generation)
				: target.set(opts.key as string, result.value as V).then(() => true);
		write.then(
			(ok) => {
				promotions.push({ tier, ok });
				promoteFresh(ctx, st, requestSeq, opts, promotions, offset + 1);
			},
			(error) => {
				promotions.push({ tier, ok: false, error });
				promoteFresh(ctx, st, requestSeq, opts, promotions, offset + 1);
			},
		);
	} catch (error) {
		promotions.push({ tier, ok: false, error });
		promoteFresh(ctx, st, requestSeq, opts, promotions, offset + 1);
	}
}

function generationForTier<V>(
	facts: readonly ReadThroughLookupFact<V>[],
	index: number,
): KvGeneration | undefined {
	return facts.find((fact) => fact.tier.index === index)?.generation;
}

function isLiveRequest<K>(st: DriverState<K>, requestSeq: number): boolean {
	return st.active && requestSeq >= st.dropBeforeSeq;
}

function buildPromotionTargets(
	tierCount: number,
	hitIndex: number,
	promoteTo?: readonly number[] | false,
): number[] {
	if (promoteTo === false || tierCount <= 0) return [];
	const maxPromote = Math.max(0, Math.min(hitIndex, tierCount));
	if (promoteTo === undefined) return [...Array(maxPromote).keys()];
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

function eventsFromResult<K, V>(
	key: K,
	requestSeq: number,
	result: TieredReadThroughResult<V>,
	promotions = result.promotions,
): Array<["DATA", CascadingCacheEvent<K, V>]> {
	const out: Array<["DATA", CascadingCacheEvent<K, V>]> = [];
	let firstError: unknown;
	for (const fact of result.facts) {
		const lookupEvent: CascadingCacheEvent<K, V> = {
			kind: "lookup",
			key,
			requestSeq,
			outcome: fact.kind,
			tier: fact.tier,
			value: fact.value,
			error: fact.error,
		};
		out.push(["DATA", lookupEvent]);
		if (fact.kind === "error") {
			firstError ??= fact.error;
			out.push([
				"DATA",
				{
					kind: "error",
					key,
					requestSeq,
					stage: "lookup",
					tier: fact.tier,
					error: fact.error,
				},
			]);
		}
	}
	for (const promotion of promotions) {
		out.push([
			"DATA",
			{
				kind: "promotion",
				key,
				requestSeq,
				tier: promotion.tier,
				ok: promotion.ok,
				error: promotion.error,
			},
		]);
		if (!promotion.ok) {
			firstError ??= promotion.error;
			if (promotion.error !== undefined) {
				out.push([
					"DATA",
					{
						kind: "error",
						key,
						requestSeq,
						stage: "promotion",
						tier: promotion.tier,
						error: promotion.error,
					},
				]);
			}
		}
	}
	out.push([
		"DATA",
		{
			kind: "fill",
			key,
			requestSeq,
			status: result.status,
			value: result.value,
			tier: result.hitTier,
			error: firstError,
		},
	]);
	return out;
}
