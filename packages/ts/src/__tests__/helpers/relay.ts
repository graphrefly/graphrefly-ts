/**
 * Test-only: sends the first dependency's latest value from each run.
 * R-node gives every computed node a function.
 */
import type { Ctx } from "../../ctx/types.js";

export function relayFirst(ctx: Ctx): void {
	const values = ctx.deps[0].waves.flat();
	if (values.length > 0) ctx.down([["DATA", values[values.length - 1]]]);
}
