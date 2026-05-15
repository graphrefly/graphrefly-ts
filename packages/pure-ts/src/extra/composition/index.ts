/**
 * Composition barrel — substrate-only composition helpers (cleave A2, 2026-05-14).
 *
 * After the cleave, only substrate composition helpers remain here:
 * - stratify (reactive branch routing)
 * - topology-diff (pure structural diff over GraphDescribeOutput)
 *
 * Presentation helpers (verifiable, distill, pubsub, backpressure, composite,
 * externalProducer, materialize, observable, audited-success-tracker) moved to
 * root src/base/composition/.
 */

export * from "./pubsub.js";
export * from "./stratify.js";
export type {
	DescribeChangeset,
	DescribeEvent,
	Meta as DescribeNodeMeta,
} from "./topology-diff.js";
export { topologyDiff } from "./topology-diff.js";
