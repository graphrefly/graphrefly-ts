/**
 * Helpers for operator tests that assert GRAPHREFLY-SPEC §1 message ordering and lifecycle.
 */
import type { Message, Messages } from "../../core/messages.js";
import { DATA, DIRTY, RESOLVED } from "../../core/messages.js";
import type { Node } from "../../core/node.js";

export type ProtocolCapture = {
	readonly batches: Messages[];
	unsub(): void;
	/** All messages in subscription order (flattened batches). */
	flat(): Message[];
};

/** Records each `subscribe` callback invocation as one batch. */
export function subscribeProtocol(node: Node<unknown>): ProtocolCapture {
	const batches: Messages[] = [];
	const unsub = node.subscribe((msgs) => {
		batches.push([...msgs] as unknown as Messages);
	});
	return {
		batches,
		unsub,
		flat() {
			return batches.flat() as Message[];
		},
	};
}

/** True if some batch lists DIRTY before the first DATA in that same batch. */
export function batchHasDirtyBeforeData(batches: readonly Messages[]): boolean {
	for (const batch of batches) {
		const types = batch.map((m) => m[0]);
		const dirtyIdx = types.indexOf(DIRTY);
		const dataIdx = types.indexOf(DATA);
		if (dirtyIdx >= 0 && dataIdx >= 0 && dirtyIdx < dataIdx) return true;
	}
	return false;
}

/**
 * True if the first `DIRTY` appears before the first `DATA` or `RESOLVED` when flattening
 * all subscription callbacks in order (two-phase often splits across batches).
 */
export function globalDirtyBeforePhase2(flat: readonly Message[]): boolean {
	const types = flat.map((m) => m[0]);
	const dirtyIdx = types.indexOf(DIRTY);
	const phase2Idx = types.findIndex((t) => t === DATA || t === RESOLVED);
	return dirtyIdx >= 0 && phase2Idx >= 0 && dirtyIdx < phase2Idx;
}

/** True if any recorded message is RESOLVED. */
export function sawResolved(batches: readonly Messages[]): boolean {
	return batches.some((b) => b.some((m) => m[0] === RESOLVED));
}
