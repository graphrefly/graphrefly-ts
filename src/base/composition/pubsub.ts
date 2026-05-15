/**
 * Re-export of the substrate pubsub implementation from pure-ts.
 *
 * `pubsub` is substrate (only depends on core primitives); its canonical
 * source is `packages/pure-ts/src/extra/composition/pubsub.ts`.
 * This re-export keeps presentation-layer imports working.
 */
export * from "@graphrefly/pure-ts/extra/composition/pubsub.js";
