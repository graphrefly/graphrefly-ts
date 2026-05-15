/**
 * Composite data patterns (roadmap §3.2b).
 *
 * These helpers compose existing primitives (`node`, `switchMap`, `reactiveMap`,
 * `dynamicNode`, `fromAny`) without introducing new protocol semantics.
 */

import {
	batch,
	DATA,
	factoryTag,
	type Node,
	type NodeOptions,
	node,
} from "@graphrefly/pure-ts/core";
import {
	fromAny,
	merge,
	type NodeInput,
	switchMap,
	withLatestFrom,
} from "@graphrefly/pure-ts/extra";
import { forEach } from "../sources/async.js";

// Re-export distill from its canonical module (co-located here pre-split;
// moved to distill.ts to avoid duplicate-export conflict at the barrel level).
export {
	type DistillBundle,
	type DistillOptions,
	distill,
	type Extraction,
} from "./distill.js";

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
