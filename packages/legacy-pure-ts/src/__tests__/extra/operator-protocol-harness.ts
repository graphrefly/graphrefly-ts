/**
 * Helpers for operator tests that assert GRAPHREFLY-SPEC §1 message ordering and lifecycle.
 */
import type { Message, Messages } from "../../core/messages.js";
import { DATA, DIRTY, RESOLVED, START } from "../../core/messages.js";
import { defaultConfig, type Node } from "../../core/node.js";

export type ProtocolCapture = {
	readonly batches: Messages[];
	unsub(): void;
	/** All messages in subscription order (flattened batches). */
	flat(): Message[];
};

/**
 * Records each `subscribe` callback invocation as one batch.
 *
 * The §2.2 handshake (`[[START]]`, and the cached-value `[[DATA, v]]` that
 * immediately follows when the node has a cached value) is filtered out —
 * it carries no wave-state content and would pollute ordering assertions.
 * Messages from the first-subscriber activation cascade (fn runs, operator
 * emissions, terminal signals) are captured normally.
 */
export function subscribeProtocol(node: Node<unknown>): ProtocolCapture {
	const batches: Messages[] = [];
	let expectHandshakeData = false;
	const unsub = node.subscribe((msgs) => {
		// --- Handshake filtering (handles both split and combined batches) ---
		// Split case (inside batch): [[START]] then [[DATA, v]] as separate callbacks.
		// Combined case (outside batch): [[START], [DATA, v]] in one callback.
		if (msgs[0][0] === START) {
			// Strip START and any paired handshake DATA from the batch.
			const rest = msgs.filter((m) => defaultConfig.messageTier(m[0]) > 0);
			if (rest.length === 0) {
				// Pure [[START]] — flag so a follow-up [[DATA, v]] is also dropped.
				expectHandshakeData = true;
				return;
			}
			if (rest.length === 1 && rest[0][0] === DATA) {
				// Combined [[START], [DATA, v]] — drop the handshake DATA.
				return;
			}
			// START mixed with non-handshake messages — keep the rest.
			batches.push([...rest] as unknown as Messages);
			return;
		}
		// Handshake cached-value DATA — drop when it immediately follows
		// a split START. Any other sequence is a real post-handshake message.
		if (expectHandshakeData) {
			expectHandshakeData = false;
			if (msgs.length === 1 && msgs[0][0] === DATA) return;
		}
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
