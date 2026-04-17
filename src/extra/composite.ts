/**
 * Composite data patterns (roadmap §3.2b).
 *
 * These helpers compose existing primitives (`node`, `switchMap`, `reactiveMap`,
 * `dynamicNode`, `fromAny`) without introducing new protocol semantics.
 */

import { batch } from "../core/batch.js";
import { DATA } from "../core/messages.js";
import type { Node, NodeOptions } from "../core/node.js";
import { derived, state } from "../core/sugar.js";
import { merge, switchMap } from "./operators.js";
import { type ReactiveMapBundle, type ReactiveMapOptions, reactiveMap } from "./reactive-map.js";
import { forEach, fromAny, type NodeInput } from "./sources.js";

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
	const verified = state<TVerify | null>(opts?.initialVerified ?? null, {
		...(hasSourceVersioning ? { meta: { sourceVersion: null } } : {}),
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
		// Closes P3 audit #2. Two patterns used depending on trigger shape:
		//  - autoVerify-only (triggerNode === sourceNode): the projected
		//    switchMap value IS the source DATA, pass it directly.
		//  - explicit trigger: capture the source value into a closure
		//    (`latestSource`) seeded from `sourceNode.cache` at wiring time
		//    (§3.6 boundary read) and kept current via a subscribe handler.
		//    The switchMap fn reads the closure, never `sourceNode.cache`
		//    from a reactive context.
		let verifyStream: Node<TVerify>;
		if (triggerNode === (sourceNode as Node<unknown>)) {
			verifyStream = switchMap(sourceNode, (src) => verifyFn(src as T));
		} else {
			let latestSource: T | undefined = sourceNode.cache as T | undefined;
			sourceNode.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) latestSource = m[1] as T;
				}
			});
			verifyStream = switchMap(triggerNode, () => verifyFn(latestSource as T));
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
 */
export function distill<TRaw, TMem>(
	source: NodeInput<TRaw>,
	extractFn: (raw: TRaw, existing: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>,
	opts: DistillOptions<TMem>,
): DistillBundle<TMem> {
	const sourceNode = fromAny(source);
	const store = reactiveMap<string, TMem>(opts.mapOptions ?? {});
	const budget = opts.budget ?? 2000;
	const hasContext = opts.context !== undefined && opts.context !== null;
	const contextNode = hasContext ? fromAny(opts.context) : state<unknown>(null);

	// Closes P3 audit #7. `latestStore` is seeded at wiring time (§3.6
	// boundary read) and kept current via a subscribe handler. `extractFn`
	// and `consolidate` read the closure, never `store.entries.cache` from
	// inside a reactive callback. `withLatestFrom` would swallow the initial
	// source emission because primary's push-on-subscribe fires before
	// secondary subscribes — same reason stratify/budgetGate use this pattern.
	let latestStore: ReadonlyMap<string, TMem> = mapFromSnapshot<TMem>(store.entries.cache);
	store.entries.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA) latestStore = mapFromSnapshot<TMem>(m[1]);
		}
	});

	const extractionStream = switchMap(sourceNode, (raw) => extractFn(raw as TRaw, latestStore));
	forEach(extractionStream, (extraction) => {
		applyExtraction(store, extraction);
	});

	if (opts.evict) {
		// Track active verdict-node subscriptions so we can react to Node<boolean> changes.
		const verdictUnsubs = new Map<string, () => void>();

		const evictionKeys = derived([store.entries], ([snapshot]) => {
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
			return out;
		});
		forEach(evictionKeys, (keys) => {
			for (const key of keys) store.delete(key);
		});
	}

	const hasConsolidateTrigger =
		opts.consolidateTrigger !== undefined && opts.consolidateTrigger !== null;
	if (opts.consolidate && hasConsolidateTrigger) {
		const consolidateTriggerNode = fromAny(opts.consolidateTrigger);
		const consolidationStream = switchMap(consolidateTriggerNode, () =>
			opts.consolidate!(latestStore),
		);
		forEach(consolidationStream, (extraction) => {
			applyExtraction(store, extraction);
		});
	}

	const compact = derived([store.entries, contextNode], ([snapshot, context]) => {
		const entries = [...mapFromSnapshot<TMem>(snapshot).entries()].map(([key, value]) => ({
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
		return packed;
	});

	const size = derived([store.entries], ([snapshot]) => mapFromSnapshot<TMem>(snapshot).size);
	keepalive(compact);
	keepalive(size);

	return { store, compact, size };
}
