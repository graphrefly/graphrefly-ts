import type { Ctx, NodeFn } from "../ctx/types.js";
import type { Message, Wave } from "../protocol/messages.js";
import { isTerminal } from "../protocol/messages.js";
import { validateNodeOutput } from "./protocol-guards.js";

/**
 * Internal: a node function whose run sends its values as one array (R-subscription@3: values a
 * node sends at once belong in one array, which a first subscriber receives as the snapshot).
 * The run's ctx.down calls are collected and sent when the function returns; an INVALIDATE
 * closes the array before it, nothing is collected after a terminal, a throw drops what was
 * collected (R-failure), and a ctx.down after the run goes out as it is.
 */
export function oneArrayPerRun(fn: NodeFn): NodeFn {
	return (ctx: Ctx) => {
		const arrays: Message[][] = [];
		let current: Message[] = [];
		let ended = false;
		let running = true;
		const down = (msgs: Wave): void => {
			if (!running) {
				ctx.down(msgs);
				return;
			}
			validateNodeOutput(msgs);
			for (const m of msgs) {
				if (ended) return;
				if (m[0] === "INVALIDATE") {
					if (current.length > 0) arrays.push(current);
					arrays.push([m]);
					current = [];
					continue;
				}
				current.push(m);
				if (isTerminal(m[0])) ended = true;
			}
		};
		const runCtx = Object.create(ctx, { down: { value: down } }) as Ctx;
		try {
			fn(runCtx);
		} finally {
			running = false;
		}
		if (current.length > 0) arrays.push(current);
		for (const array of arrays) ctx.down(array);
	};
}
