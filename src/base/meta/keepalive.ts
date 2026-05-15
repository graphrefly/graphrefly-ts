/**
 * keepalive — empty subscription to keep derived nodes wired.
 *
 * Extracted from extra/sources/settled.ts during cleave A2.
 */

import type { Node } from "@graphrefly/pure-ts/core";

// ---------------------------------------------------------------------------
// keepalive
// ---------------------------------------------------------------------------

/**
 * Activate a compute node's upstream wiring without a real sink.
 *
 * Derived/effect nodes are lazy — they don't compute until at least one
 * subscriber exists (COMPOSITION-GUIDE §5). `keepalive` subscribes with an
 * empty sink so the node stays wired for `.cache` and upstream propagation.
 *
 * Returns the unsubscribe handle. Common usage:
 * `graph.addDisposer(keepalive(node))`.
 *
 * @category extra
 */
export function keepalive(n: Node<unknown>): () => void {
	return n.subscribe(() => {});
}
