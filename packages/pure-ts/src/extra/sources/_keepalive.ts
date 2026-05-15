/**
 * keepalive — empty subscription to keep derived nodes wired.
 *
 * Substrate primitive (pure-ts). Presentation-layer wrapper lives in
 * root src/base/meta/keepalive.ts; this module is the substrate copy so
 * graph.ts (substrate) can depend on it without a cross-layer import.
 */

import type { Node } from "../../core/node.js";

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
