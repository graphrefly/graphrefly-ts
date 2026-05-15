/**
 * Re-export of the substrate topology-diff implementation from pure-ts.
 *
 * `topologyDiff` is substrate (only depends on core/graph types); its canonical
 * source is now `packages/pure-ts/src/extra/composition/topology-diff.ts`.
 * This re-export keeps any existing presentation-layer imports working.
 *
 * Presentation callers should import from `@graphrefly/pure-ts/extra` or from
 * this module directly.
 */
export {
	type DescribeChangeset,
	type DescribeEvent,
	type Meta,
	type Meta as DescribeNodeMeta,
	topologyDiff,
} from "@graphrefly/pure-ts/extra/composition/topology-diff.js";
