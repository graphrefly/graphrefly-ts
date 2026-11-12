/**
 * Test-only: a function that sends its first dependency's latest value of each run, the node the
 * removed passthrough wire (dependencies, no function) used to be. R-node gives every computed
 * node a function.
 */
import type { Ctx } from "../../ctx/types.js";

export function relayFirst(ctx: Ctx): void {
	const values = ctx.deps[0].waves.flat();
	if (values.length > 0) ctx.down([["DATA", values[values.length - 1]]]);
}
