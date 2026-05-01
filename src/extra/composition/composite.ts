/**
 * Composite data patterns (roadmap §3.2b).
 *
 * These helpers compose existing primitives (`node`, `switchMap`, `reactiveMap`,
 * `dynamicNode`, `fromAny`) without introducing new protocol semantics.
 */

import { batch } from "../../core/batch.js";
import { DATA } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import { merge, switchMap, withLatestFrom } from "../operators.js";
import { type ReactiveMapBundle, type ReactiveMapOptions, reactiveMap } from "../reactive-map.js";
import { forEach, fromAny, type NodeInput } from "../sources.js";

function isNodeLike<T>(value: unknown): value is Node<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		"cache" in (value as Node<T>) &&
		typeof (value as Node<T>).subscribe === "function"
	);
}

/**
 * Verification payload shape is intentionally user-defined.
 */
export type VerifyValue = unknown;

export type VerifiableOptions<TVerify = VerifyValue> = Omit<
	NodeOptions,
	"describeKind" | "initial"
> & {
	/** Reactive re-verification trigger. */
	trigger?: NodeInput<unknown>;
	/** Re-run verification whenever `source` settles. */
	autoVerify?: boolean;
	/** Initial verification companion value. */
	initialVerified?: TVerify | null;
};

export type VerifiableBundle<T, TVerify = VerifyValue> = {
	/** Coerced source node. */
	node: Node<T>;
	/** Latest verification result (`null` before first verification). */
	verified: Node<TVerify | null>;
	/** Effective trigger node used for verification, if any. */
	trigger: Node<unknown> | null;
};

/**
 * Composes a value node with a reactive verification companion.
 *
 * Uses `switchMap` so newer triggers cancel stale in-flight verification work.
 */
export function verifiable<T, TVerify = VerifyValue>(
	source: NodeInput<T>,
	verifyFn: (value: T) => NodeInput<TVerify>,
	opts?: VerifiableOptions<TVerify>,
): VerifiableBundle<T, TVerify> {
	const sourceNode = fromAny(source);
	const hasSourceVersioning = sourceNode.v != null;
	const verified = node<TVerify | null>([], {
		initial: opts?.initialVerified ?? null,
		meta: {
			...factoryTag("verifiable"),
			...(hasSourceVersioning ? { sourceVersion: null } : {}),
		},
	});
	const hasTrigger = opts?.trigger !== undefined && opts.trigger !== null;

	let triggerNode: Node<unknown> | null = null;
	if (hasTrigger && opts?.autoVerify) {
		triggerNode = merge(fromAny(opts.trigger) as Node<unknown>, sourceNode as Node<unknown>);
	} else if (hasTrigger) {
		triggerNode = fromAny(opts.trigger);
	} else if (opts?.autoVerify) {
		triggerNode = sourceNode as Node<unknown>;
	}

	if (triggerNode !== null) {
		// Two patterns depending on trigger shape:
		//  - autoVerify-only (triggerNode === sourceNode): the projected
		//    switchMap value IS the source DATA, pass it directly.
		//  - explicit trigger: `withLatestFrom(trigger, source)` pairs each
		//    trigger emission with the latest source value. Phase 10.5
		//    (`withLatestFrom` flipped to `partial: false`) fixed the W1
		//    initial-pair drop — both deps settle before fn fires, so the
		//    first trigger correctly pairs with the seeded source cache.
		//    Replaces the §28 closure-mirror that was canonical pre-10.5.
		let verifyStream: Node<TVerify>;
		if (triggerNode === (sourceNode as Node<unknown>)) {
			verifyStream = switchMap(sourceNode, (src) => verifyFn(src as T));
		} else {
			const paired = withLatestFrom(triggerNode, sourceNode);
			verifyStream = switchMap(paired, ([, source]) => verifyFn(source as T));
		}
		forEach(verifyStream, (value) => {
			batch(() => {
				verified.down([[DATA, value]]);
				// V0 backfill: stamp which source version was verified (§6.0b).
				if (hasSourceVersioning) {
					const sv = sourceNode.v;
					if (sv != null) {
						verified.meta.sourceVersion.down([[DATA, { id: sv.id, version: sv.version }]]);
					}
				}
			});
		});
	}

	return { node: sourceNode, verified, trigger: triggerNode };
}

export type Extraction<TMem> = {
	upsert: Array<{ key: string; value: TMem }>;
	remove?: string[];
};

export type DistillOptions<TMem> = {
	score: (mem: TMem, context: unknown) => number;
	cost: (mem: TMem) => number;
	budget?: number;
	evict?: (key: string, mem: TMem) => boolean | Node<boolean>;
	consolidate?: (entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>;
	consolidateTrigger?: NodeInput<unknown>;
	context?: NodeInput<unknown>;
	mapOptions?: ReactiveMapOptions<string, TMem>;
};

export type DistillBundle<TMem> = {
	store: ReactiveMapBundle<string, TMem>;
	compact: Node<Array<{ key: string; value: TMem; score: number }>>;
	size: Node<number>;
};

function keepalive(node: Node): void {
	node.subscribe(() => undefined);
}

/**
 * Defensive snapshot → ReadonlyMap coercion (D2 /qa lock, Tier 9.1).
 *
 * `ReactiveMapBundle.entries` always emits a real `Map` on the live emit
 * path. The non-Map case happens on snapshot **restore**: the default
 * `JsonGraphCodec` serializes a `Map` to `null`/`{}`/`[]` depending on the
 * codec configuration, and `Graph.restore` writes that decoded value back
 * to the cache. A naive `(snapshot as ReadonlyMap) ?? new Map()` would
 * pass a plain object through and then `.entries()` / `.size` access would
 * silently yield wrong results (or throw). The runtime `instanceof Map`
 * check below restores the safety net the previous `mapFromSnapshot` helper
 * provided before its initial deletion in Tier 10.1.
 */
function mapFromSnapshot<TMem>(snapshot: unknown): ReadonlyMap<string, TMem> {
	if (snapshot instanceof Map) return snapshot as ReadonlyMap<string, TMem>;
	return new Map<string, TMem>();
}

function applyExtraction<TMem>(
	store: ReactiveMapBundle<string, TMem>,
	extraction: Extraction<TMem>,
): void {
	if (!Array.isArray(extraction.upsert)) {
		throw new TypeError("distill extraction requires upsert: Array<{ key, value }>");
	}
	batch(() => {
		for (const { key, value } of extraction.upsert) {
			store.set(key, value);
		}
		for (const key of extraction.remove ?? []) {
			store.delete(key);
		}
	});
}

/**
 * Budget-constrained reactive memory composition.
 *
 * **Tier 1.5.4 (Session A.5 lock, 2026-04-27):** `extractFn` receives the
 * source and existing-store as `Node`s. Distill calls `extractFn` ONCE at
 * wiring time and consumes the returned stream of extractions. The user
 * controls reactive composition — wrap with `switchMap` for cancel-on-new-input,
 * `mergeMap` for parallel, `derived` for sync transforms. See COMPOSITION-GUIDE
 * §40 for the recipe.
 */
export function distill<TRaw, TMem>(
	source: NodeInput<TRaw>,
	extractFn: (
		raw: Node<TRaw>,
		existing: Node<ReadonlyMap<string, TMem>>,
	) => NodeInput<Extraction<TMem>>,
	opts: DistillOptions<TMem>,
): DistillBundle<TMem> {
	const sourceNode = fromAny(source);
	const store = reactiveMap<string, TMem>(opts.mapOptions ?? {});
	const budget = opts.budget ?? 2000;
	const hasContext = opts.context !== undefined && opts.context !== null;
	const contextNode = hasContext ? fromAny(opts.context) : node<unknown>([], { initial: null });

	// `latestStore` (formerly a §28 closure-mirror) is no longer needed —
	// Phase 10.5 (`withLatestFrom` flipped to `partial: false`) fixed the
	// W1 initial-pair drop. `consolidate` now uses
	// `withLatestFrom(trigger, store.entries)` below to pair each trigger
	// with the latest store snapshot via a real reactive edge (visible in
	// `describe()`). The `mapFromSnapshot` transform runs inside the
	// switchMap fn body.

	// Tier 1.5.4: one-shot wire. User's `extractFn` returns the reactive
	// extraction stream — distill just `forEach`s and applies. No internal
	// switchMap; user picks the cancellation / queueing semantics.
	const extractionStream = fromAny(
		extractFn(sourceNode, store.entries as Node<ReadonlyMap<string, TMem>>),
	);
	forEach(extractionStream, (extraction) => {
		applyExtraction(store, extraction);
	});

	if (opts.evict) {
		// Track active verdict-node subscriptions so we can react to Node<boolean> changes.
		const verdictUnsubs = new Map<string, () => void>();

		const evictionKeys = node<string[]>(
			[store.entries],
			(batchData, actions, ctx) => {
				const batch0 = batchData[0];
				const snapshot = batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0];
				const out: string[] = [];
				const entries = mapFromSnapshot<TMem>(snapshot);
				// Clean up verdict subscriptions for removed keys.
				for (const key of verdictUnsubs.keys()) {
					if (!entries.has(key)) {
						verdictUnsubs.get(key)!();
						verdictUnsubs.delete(key);
					}
				}
				for (const [key, mem] of entries) {
					const verdict = opts.evict!(key, mem);
					if (isNodeLike<boolean>(verdict)) {
						// Subscribe if not already — push-on-subscribe fires with
						// the verdict's current value on first subscribe, so an
						// already-true verdict deletes via the callback without
						// needing a `verdict.cache` read (closes P3 audit #3).
						// Future transitions to `true` flow through the same path.
						if (!verdictUnsubs.has(key)) {
							const unsub = forEach(verdict, (val) => {
								if (val === true && store.has(key)) {
									store.delete(key);
								}
							});
							verdictUnsubs.set(key, unsub);
						}
						continue;
					}
					if (typeof verdict === "boolean") {
						if (verdict) out.push(key);
						continue;
					}
					throw new TypeError("distill evict() must return boolean or Node<boolean>");
				}
				actions.emit(out);
			},
			{ describeKind: "derived" },
		);
		forEach(evictionKeys, (keys) => {
			for (const key of keys) store.delete(key);
		});
	}

	const hasConsolidateTrigger =
		opts.consolidateTrigger !== undefined && opts.consolidateTrigger !== null;
	if (opts.consolidate && hasConsolidateTrigger) {
		const consolidateTriggerNode = fromAny(opts.consolidateTrigger);
		const consolidatePaired = withLatestFrom(
			consolidateTriggerNode,
			store.entries as Node<unknown>,
		);
		const consolidationStream = switchMap(consolidatePaired, ([, entries]) =>
			opts.consolidate!(mapFromSnapshot<TMem>(entries)),
		);
		forEach(consolidationStream, (extraction) => {
			applyExtraction(store, extraction);
		});
	}

	const compact = node<Array<{ key: string; value: TMem; score: number }>>(
		[store.entries, contextNode],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const snapshot = data[0];
			const context = data[1];
			const map = mapFromSnapshot<TMem>(snapshot);
			const entries = [...map.entries()].map(([key, value]) => ({
				key,
				value,
				score: opts.score(value, context),
				cost: opts.cost(value),
			}));
			entries.sort((a, b) => b.score - a.score);

			const packed: Array<{ key: string; value: TMem; score: number }> = [];
			let remaining = budget;
			for (const item of entries) {
				if (item.cost <= remaining) {
					packed.push({ key: item.key, value: item.value, score: item.score });
					remaining -= item.cost;
				}
			}
			actions.emit(packed);
		},
		{ describeKind: "derived", meta: { ...factoryTag("distill", { budget }) } },
	);

	const size = node<number>(
		[store.entries],
		(batchData, actions, ctx) => {
			const batch0 = batchData[0];
			const snapshot = batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0];
			actions.emit(mapFromSnapshot<TMem>(snapshot).size);
		},
		{ describeKind: "derived" },
	);
	keepalive(compact);
	keepalive(size);

	return { store, compact, size };
}
