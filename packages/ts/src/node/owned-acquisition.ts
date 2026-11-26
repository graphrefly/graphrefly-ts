import type { Kernel } from "./kernel.js";
import type { Node } from "./node.js";
import { releaseRuntimeOfNode, runtimeReleaseFailuresOfNode } from "./runtime-accessors.js";

/**
 * D161: explicit per-construction material; never a global current transaction. A kernel holds no
 * function table or slot (graphrefly-ts:D193), so what a cold construction acquires is its node.
 */
export interface NodeAcquisition {
	readonly name: string;
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
	readonly resource: "subscription" | "deactivation" | "runtime";
	readonly cause: unknown;
	readonly core?: Kernel;
}

/** D167: fixed cleanup of resources this cold acquisition actually owns. Never retry residuals. */
export function cleanupNodeAcquisition(a: NodeAcquisition): readonly RuntimeReleaseFailure[] {
	if (a.registered || a.node === undefined) return [];
	try {
		releaseRuntimeOfNode(a.node);
	} catch (cause) {
		return runtimeReleaseFailuresOfNode(a.node) ?? [{ resource: "runtime", cause, core: a.core }];
	}
	return runtimeReleaseFailuresOfNode(a.node) ?? [];
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
