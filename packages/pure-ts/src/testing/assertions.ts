/**
 * Lock 3.B (Phase 13.6.B B9) — DIRTY-precedes-terminal-DATA assertion helper.
 *
 * Replaces ad-hoc test assertions like "DIRTY precedes any DATA globally,"
 * which fail for accumulating operators where the initial activation
 * `[RESOLVED]` has no preceding DIRTY (P.25). Encoding the rule in a helper
 * means tests can't accidentally write the wrong predicate.
 *
 * Helper checks: for every **terminal-emission DATA** (the last DATA in a
 * wave settling the operator's value), there exists a `[DIRTY]` earlier
 * in the message sequence within that wave's preamble. Initial-activation
 * `[RESOLVED]` (P.25 ceremony) is skipped.
 */

import { DATA, DIRTY, type Message, type Messages, RESOLVED, START } from "../core/messages.js";

/**
 * Assertion helper: every settling DATA in the message stream is preceded by
 * a `[DIRTY]` in the same wave preamble.
 *
 * - Walks the message sequence linearly. Maintains `pending` = `DIRTY count
 *   − settlement count`, where settlements include DATA and RESOLVED.
 * - **Push-on-subscribe handshake carve-out** (extends P.25). When the
 *   stream starts with `[START]`, every immediately-following DATA /
 *   RESOLVED is treated as part of the handshake until the first
 *   non-handshake message (typically `[DIRTY]`) opens the post-handshake
 *   window. This admits both:
 *   - the legacy P.25 shape `[START, RESOLVED]` (initial-activation
 *     ceremony with no value to advertise);
 *   - the Lock 6.G `replayBuffer: N` shape `[START, DATA, …, DATA,
 *     DIRTY?]` (late subscriber receiving N replayed values plus an
 *     optional trailing DIRTY when the node's status is `"dirty"` at
 *     subscribe time).
 *   When the stream lacks a leading `[START]`, only a single leading
 *   `[RESOLVED]` is admitted (legacy P.25 shape preserved for callers
 *   that strip START before passing the messages in).
 * - Throws `Error` with a descriptive message on the first violation.
 *
 * ```ts
 * import { assertDirtyPrecedesTerminalData } from "@graphrefly/graphrefly/testing";
 *
 * const messages: Messages = collect(node, { flat: true }).messages;
 * assertDirtyPrecedesTerminalData(messages);
 * ```
 *
 * @param messages - Flattened message sequence captured from a node's
 *   subscribe callback. May begin with `[START]`.
 *
 * @throws {Error} when a settlement (DATA or non-handshake RESOLVED) arrives
 *   without an outstanding DIRTY ahead of it in the same wave.
 */
export function assertDirtyPrecedesTerminalData(messages: Messages): void {
	let pending = 0;
	let inLeadingHandshake = false;
	let firstMessage = true;
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		const t = m[0];
		if (t === START) {
			// Push-on-subscribe handshake opens; subsequent DATA/RESOLVED
			// are part of the handshake (cache push and/or Lock 6.G
			// replay buffer) until the first non-DATA/RESOLVED message.
			inLeadingHandshake = true;
			firstMessage = false;
			continue;
		}
		if (firstMessage && t === RESOLVED) {
			// Legacy P.25 carve-out for callers that strip START before
			// passing messages in: single leading RESOLVED is the
			// initial-activation ceremony and admits without DIRTY.
			firstMessage = false;
			continue;
		}
		firstMessage = false;
		if (inLeadingHandshake && (t === DATA || t === RESOLVED)) {
			// Inside the handshake window — these are buffered DATAs
			// (replayBuffer) and/or the cache-DATA push, neither of
			// which carries a preceding DIRTY by spec.
			continue;
		}
		// First non-handshake message ends the leading window.
		inLeadingHandshake = false;
		if (t === DIRTY) {
			pending += 1;
			continue;
		}
		if (t === DATA || t === RESOLVED) {
			if (pending <= 0) {
				const ctx = describeMessageWindow(messages, i);
				throw new Error(
					`assertDirtyPrecedesTerminalData: settlement at index ${i} (` +
						`${describeType(t)}) arrived without an outstanding DIRTY in the ` +
						`same wave preamble (P.25 protocol §1.3 violation). ` +
						`Window: ${ctx}`,
				);
			}
			pending -= 1;
		}
		// Other message types (ERROR / COMPLETE / INVALIDATE / PAUSE /
		// RESUME / TEARDOWN) don't affect the DIRTY/settlement balance.
	}
}

function describeMessageWindow(messages: Messages, around: number): string {
	const start = Math.max(0, around - 3);
	const end = Math.min(messages.length, around + 4);
	const slice: Message[] = messages.slice(start, end) as Message[];
	const parts = slice.map((m, j) => `${start + j === around ? "→ " : "  "}[${describeType(m[0])}]`);
	return parts.join(", ");
}

function describeType(t: symbol): string {
	const desc = t.description ?? "";
	const slash = desc.lastIndexOf("/");
	return slash >= 0 ? desc.slice(slash + 1) : desc;
}
