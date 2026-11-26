import type { Dispatcher, Handle } from "../dispatcher/index.js";
import type { Kernel } from "./kernel.js";
import type { Node } from "./node.js";
import { releaseRuntimeOfNode, runtimeReleaseFailuresOfNode } from "./runtime-accessors.js";

/** D161: explicit per-construction material; never a global current transaction. */
export interface NodeAcquisition {
	readonly name: string;
	dispatcher?: Dispatcher;
	handle?: Handle;
	core?: Kernel;
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
	readonly resource: "subscription" | "deactivation" | "handle" | "slot" | "runtime";
	readonly cause: unknown;
	readonly handle?: Handle;
	readonly dispatcher?: Dispatcher;
	readonly core?: Kernel;
}

/** D167: fixed cleanup of resources this cold acquisition actually owns. Never retry residuals. */
export function cleanupNodeAcquisition(a: NodeAcquisition): readonly RuntimeReleaseFailure[] {
	if (a.registered) return [];
	if (a.node !== undefined) {
		// Supplied handles are borrowed until successful construction/publication.
		// Graph factory paths only create a new fn handle or a null handle.
		try {
			releaseRuntimeOfNode(a.node);
		} catch (cause) {
			return (
				runtimeReleaseFailuresOfNode(a.node) ?? [
					{
						resource: "runtime",
						cause,
						core: a.core,
						dispatcher: a.dispatcher,
						handle: a.handle,
					},
				]
			);
		}
		return runtimeReleaseFailuresOfNode(a.node) ?? [];
	}
	const failures: RuntimeReleaseFailure[] = [];
	if (a.handle !== undefined) {
		try {
			a.dispatcher!.unregister(a.handle);
		} catch (cause) {
			failures.push({ resource: "handle", cause, handle: a.handle, dispatcher: a.dispatcher });
		}
	}
	return failures;
}
export function failNodeAcquisition(a: NodeAcquisition, cause: unknown): never {
	const failures = cleanupNodeAcquisition(a);
	if (failures.length === 0) throw cause;
	throw new ColdNodeAcquisitionError(cause, failures);
}
export class ColdNodeAcquisitionError extends Error {
	readonly cleanupErrors: readonly RuntimeReleaseFailure[];
	constructor(cause: unknown, failures: readonly RuntimeReleaseFailure[]) {
		super("node: construction failed with residual resources", { cause });
		this.name = "ColdNodeAcquisitionError";
		this.cleanupErrors = Object.freeze([...failures]);
	}
}
