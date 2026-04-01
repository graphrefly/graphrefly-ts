/**
 * Composite data patterns (roadmap §3.2b).
 *
 * These helpers compose existing primitives (`node`, `switchMap`, `reactiveMap`,
 * `dynamicNode`, `fromAny`) without introducing new protocol semantics.
 */

import { batch } from "../core/batch.js";
import { dynamicNode } from "../core/dynamic-node.js";
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
		typeof (value as Node<T>).get === "function" &&
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
		const verifyStream = switchMap(triggerNode, () => verifyFn(sourceNode.get() as T));
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
	mapOptions?: ReactiveMapOptions;
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
	if (
		typeof snapshot === "object" &&
		snapshot !== null &&
		"value" in snapshot &&
		typeof (snapshot as { value?: unknown }).value === "object" &&
		(snapshot as { value?: unknown }).value !== null &&
		"map" in ((snapshot as { value?: unknown }).value as object)
	) {
		return ((snapshot as { value: { map: ReadonlyMap<string, TMem> } }).value.map ??
			new Map<string, TMem>()) as ReadonlyMap<string, TMem>;
	}
	return new Map<string, TMem>();
}

function asReadonlyMap<TMem>(store: ReactiveMapBundle<string, TMem>): ReadonlyMap<string, TMem> {
	return mapFromSnapshot<TMem>(store.node.get());
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

	const extractionStream = switchMap(sourceNode, (raw) => extractFn(raw, asReadonlyMap(store)));
	forEach(extractionStream, (extraction) => {
		applyExtraction(store, extraction);
	});

	if (opts.evict) {
		const evictionKeys = dynamicNode((get) => {
			const out: string[] = [];
			const snapshot = mapFromSnapshot<TMem>(get(store.node));
			for (const [key, mem] of snapshot) {
				const verdict = opts.evict!(key, mem);
				if (isNodeLike<boolean>(verdict)) {
					if (get(verdict) === true) out.push(key);
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
			opts.consolidate!(asReadonlyMap(store)),
		);
		forEach(consolidationStream, (extraction) => {
			applyExtraction(store, extraction);
		});
	}

	const compact = derived([store.node, contextNode], ([snapshot, context]) => {
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

	const size = derived([store.node], ([snapshot]) => mapFromSnapshot<TMem>(snapshot).size);
	keepalive(compact);
	keepalive(size);

	return { store, compact, size };
}
