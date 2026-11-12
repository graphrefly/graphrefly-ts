import type { Ctx } from "../ctx/types.js";
import type { Message } from "../protocol/messages.js";
import { SENTINEL } from "../protocol/messages.js";

/**
 * Internal: walk dependency `dep`'s input arrays of this run and send one output array per input
 * array (R-wave). Values a source sends together stay together, which is what a first subscriber
 * sees as the snapshot (R-subscription). `onValue` pushes output for a value and returns false to
 * stop; the array built so far still goes out.
 *
 * @returns true when `onValue` stopped the walk.
 */
export function eachInputArray<V>(
	ctx: Ctx,
	dep: number,
	// biome-ignore lint/suspicious/noConfusingVoidType: a value callback returns false to stop, or nothing.
	onValue: (value: V, out: Message[]) => boolean | void,
): boolean {
	for (const wave of ctx.deps[dep]?.waves ?? []) {
		const out: Message[] = [];
		let stopped = false;
		for (const value of wave) {
			if (value === SENTINEL) continue;
			if (onValue(value as V, out) === false) {
				stopped = true;
				break;
			}
		}
		if (out.length > 0) ctx.down(out);
		if (stopped) return true;
	}
	return false;
}
