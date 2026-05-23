/**
 * Attach-edge meta — a "soft forward edge" declaration for nodes that
 * imperatively publish into a target node via subscribe-and-emit
 * (sanctioned per spec §5.9, but invisible to the dep-graph walker).
 *
 * Visible to:
 *
 * - **`Graph.describe()`** — resolves the {@link Node} ref to its qualified
 *   path string at snapshot time, the same way dep-list entries are
 *   resolved. After `describe()`, `meta.attachTarget` is a path string,
 *   not a Node ref.
 * - **{@link explainPath}** — treats the resolved path as a "soft forward
 *   edge" so the causal chain walks past imperative-attach hops (e.g.,
 *   `topicBridge.attach → dst::events`) that have no declared dep.
 *
 * Wave propagation does NOT follow soft forward edges — the protocol-level
 * dep graph is unchanged. Soft edges are an **explainability concern only**.
 * If the wave needs to see the edge, declare a normal `dep`; if a human
 * (or `explain()`) needs to see the edge but the protocol doesn't, this is
 * the right tool.
 *
 * @example
 * ```ts
 * // Inside a factory whose body does `source.subscribe(... target.publish(v))`:
 * this.attach = this.effect(
 *   "attach",
 *   ["output"],
 *   () => {
 *     for (const v of outputRef.cache) targetTopic.publish(v);
 *   },
 *   {
 *     meta: {
 *       ...messagingMeta("topic_bridge_attach"),
 *       ...attachEdgeMeta(targetTopic.events),
 *     },
 *   },
 * );
 * ```
 *
 * **Single-target only.** If a factory forwards into multiple targets,
 * mount one `attach` effect per target. A future `attachTargets: Node[]`
 * shape may land when a real consumer surfaces — single target covers
 * topicBridge / worker-bridge / single-sink relay today.
 *
 * @module
 */

import type { Node } from "@graphrefly/pure-ts/core";

/**
 * Build a meta fragment declaring a soft forward edge into `target`.
 * Composes with `domainMeta` / `messagingMeta` / etc. via spread.
 *
 * The returned object has a single key, `attachTarget`, carrying the Node
 * reference at construction time. {@link Graph.describe} replaces the Node
 * ref with the target's qualified path string at snapshot time.
 *
 * @param target - The Node this factory imperatively publishes into.
 */
export function attachEdgeMeta(target: Node<unknown>): { attachTarget: Node<unknown> } {
	return { attachTarget: target };
}
