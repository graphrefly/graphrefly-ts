/**
 * Composition barrel — graph-level composition helpers (verifiable, distill,
 * stratify, externalProducer/Bundle, toObservable, pubsub, backpressure,
 * topologyDiff).
 *
 * Per the consolidation plan §2, this folder gathers the existing
 * top-level composition files for category-level discoverability. Most
 * physical files remain at `src/extra/<name>.ts` (deferred move).
 *
 * `topology-diff.ts` already lives inside this folder from wave 1; the
 * sibling `composite.ts` / `external-register.ts` / `stratify.ts` /
 * `observable.ts` / `pubsub.ts` / `backpressure.ts` are barrel-only re-exports.
 */

export * from "./audited-success-tracker.js";
export * from "./backpressure.js";
export * from "./composite.js";
export * from "./external-register.js";
export * from "./observable.js";
export * from "./pubsub.js";
export * from "./stratify.js";
export type {
	DescribeChangeset,
	DescribeEvent,
	Meta as DescribeNodeMeta,
} from "./topology-diff.js";
export { topologyDiff } from "./topology-diff.js";
