import type { Dispatcher, Handle } from "../dispatcher/index.js";
import type { NodeCore, NodeId } from "./core.js";
import type { Node } from "./node.js";

/** D161: explicit per-construction material; never a global current transaction. */
export interface NodeAcquisition {
	readonly name: string;
	dispatcher?: Dispatcher;
	handle?: Handle;
	core?: NodeCore;
	slot?: NodeId;
	node?: Node<unknown>;
	registered?: boolean;
}

// Keyed by the exact private options object, consumed once by the constructor.
export const constructionAcquisitions = new WeakMap<object, NodeAcquisition>();

/** Package-private subscription acquisition, used only while activating an owned root. */
export interface SubscriptionAcquisition {
	record(unsubscribe: () => void): void;
}

/** Private residual-resource diagnostics; errors are not protocol DATA or retry authority. */
export interface RuntimeReleaseFailure {
	readonly resource: "subscription" | "deactivation" | "handle" | "slot";
	readonly cause: unknown;
	readonly handle?: Handle;
	readonly dispatcher?: Dispatcher;
	readonly core?: NodeCore;
	readonly slot?: NodeId;
}
export const runtimeReleaseFailures = new WeakMap<
	Node<unknown>,
	readonly RuntimeReleaseFailure[]
>();
