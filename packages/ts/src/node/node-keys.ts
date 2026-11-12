/**
 * @internal The keys of the kernel state a Node holds (review §5.7). The node is its state: the
 * node-*-runtime modules read and write these members directly, with no forwarding layer. Node
 * declares them `private`, so the published declarations list them without their types; a kernel
 * module reaches them by element access (`node[SLOT]`), which only a module importing the key can
 * write. This module imports nothing, so a key exists before any class that uses it is defined.
 */
export const CORE: unique symbol = Symbol("graphrefly.node.core");
export const ID: unique symbol = Symbol("graphrefly.node.id");
export const SLOT: unique symbol = Symbol("graphrefly.node.slot");
export const DEP: unique symbol = Symbol("graphrefly.node.dep");
export const VALUE: unique symbol = Symbol("graphrefly.node.value");
export const WAVE: unique symbol = Symbol("graphrefly.node.wave");
export const LIFECYCLE: unique symbol = Symbol("graphrefly.node.lifecycle");
export const PRIVATE_STATE: unique symbol = Symbol("graphrefly.node.privateState");
export const LIFETIME: unique symbol = Symbol("graphrefly.node.lifetime");
/** The ctx reused run after run in one lifetime (`.value`; null until the next run builds one). */
/** R-subscription@3: the seed's note, until the seeded instance's first run takes it. */
export const SEED_NOTE: unique symbol = Symbol("graphrefly.node.seedNote");
export const RELEASED: unique symbol = Symbol("graphrefly.node.released");
