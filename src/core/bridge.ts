/**
 * bridge — graph-visible message forwarding between two nodes.
 *
 * Replaces ad-hoc `subscribe()` bridges that bypass graph topology.
 * The returned node is an effect that intercepts messages from `from`
 * and forwards them to `to.down()`. Register it with `graph.add()` to
 * make the bridge visible in `describe()` and `snapshot()`.
 *
 * **Upstream path:** The bridge node has `from` as its dep, so anything
 * downstream of the bridge that calls `up()` naturally reaches `from`.
 * If `to` is used as a dep by other nodes and those nodes send `up()`,
 * the messages reach `to`'s deps (not `from`). For full upstream relay
 * across the bridge boundary, wire the bridge as a dep of `to`'s
 * consumers or use `graph.connect()`.
 *
 * **ABAC / guards:** `to.down()` is called without `NodeTransportOptions`,
 * so any ABAC guard on `to` receives `actor = undefined`. Upstream (`up()`)
 * messages propagate through the dep chain the same way — no actor is
 * injected on either path. Both paths are intentionally unguarded; if `to`
 * requires a specific actor, provide a guarded wrapper node and bridge to
 * that instead.
 *
 * **Default forwarding:** All standard message types are forwarded by
 * default, including TEARDOWN, PAUSE, RESUME, and INVALIDATE. Use the
 * `down` option to restrict which types are forwarded. Callers that need
 * to exclude TEARDOWN (e.g. inter-stage wiring in `funnel()`) pass an
 * explicit `down` array without TEARDOWN.
 *
 * @module
 */

import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Message,
	PAUSE,
	RESOLVED,
	RESUME,
	TEARDOWN,
} from "./messages.js";
import { type Node, type NodeActions, node, type OnMessageHandler } from "./node.js";

/** Options for {@link bridge}. */
export type BridgeOptions = {
	/** Node name (for graph registration / describe). */
	name?: string;
	/**
	 * Standard message types to forward downstream. Default: all standard
	 * types. Unknown (non-standard) types always forward per spec §1.3.6
	 * regardless of this option.
	 */
	down?: readonly symbol[];
};

/** All standard types forwarded by default. Export for callers that
 *  need to customize (e.g. exclude TEARDOWN). */
export const DEFAULT_DOWN: readonly symbol[] = [
	DATA,
	DIRTY,
	RESOLVED,
	COMPLETE,
	ERROR,
	TEARDOWN,
	PAUSE,
	RESUME,
	INVALIDATE,
];

/**
 * All standard message types the bridge understands. Types outside this set
 * are "unknown" and must always be forwarded (spec §1.3.6).
 */
const STANDARD_TYPES = new Set<symbol>([
	DATA,
	DIRTY,
	RESOLVED,
	COMPLETE,
	ERROR,
	TEARDOWN,
	PAUSE,
	RESUME,
	INVALIDATE,
]);

/**
 * Create a graph-visible bridge node that forwards messages from `from` to `to`.
 *
 * The bridge is a real node (effect) — it shows up in `describe()`, participates
 * in two-phase push, and cleans up on TEARDOWN. Register it via `graph.add()`
 * to make it part of the graph topology.
 *
 * **Unknown message types** (custom domain signals not in the standard protocol
 * set) are always forwarded to `to`, regardless of the `down` option. This
 * satisfies spec §1.3.6 ("unknown types forward unchanged").
 *
 * **COMPLETE / ERROR**: when forwarded, the bridge also transitions to terminal
 * state so graph-wide completion detection works correctly.
 *
 * @param from - Source node to observe.
 * @param to - Target node to forward messages to via `to.down()`.
 * @param opts - Optional configuration.
 * @returns A bridge effect node. Add it to a graph with `graph.add(name, bridge(...))`.
 *
 * @example
 * ```ts
 * import { bridge, state } from "@graphrefly/graphrefly-ts";
 *
 * const a = state(0);
 * const b = state(0);
 * const br = bridge(a, b, { name: "__bridge_a_b" });
 * graph.add("__bridge_a_b", br);
 * // Now a's messages flow to b, visible in describe()
 * ```
 *
 * @category core
 */
export function bridge<T = unknown>(from: Node<T>, to: Node, opts?: BridgeOptions): Node<unknown> {
	const allowedDown = new Set(opts?.down ?? DEFAULT_DOWN);

	const onMessage: OnMessageHandler = (
		msg: Message,
		_depIndex: number,
		_actions: NodeActions,
	): boolean => {
		const type = msg[0];

		// Unknown types (custom domain signals) always forward — spec §1.3.6.
		if (!STANDARD_TYPES.has(type)) {
			to.down([msg]);
			return true;
		}

		// Terminal types: always transition the bridge to terminal state
		// (return false → default dispatch). Only forward to `to` if allowed.
		if (type === COMPLETE || type === ERROR) {
			if (allowedDown.has(type)) {
				to.down([msg]);
			}
			return false;
		}

		// Known type, not in allowedDown — consume without forwarding.
		if (!allowedDown.has(type)) {
			return true;
		}

		// Forward the message to the target.
		to.down([msg]);
		return true;
	};

	return node([from as Node], undefined, {
		name: opts?.name,
		describeKind: "effect",
		onMessage,
	});
}
