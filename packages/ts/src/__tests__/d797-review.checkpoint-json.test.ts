/**
 * R-checkpoint@1: a graph whose effect has run can be checkpointed; an effect's latest cleanup is
 * not private state (the recipe survey of the D797 review round).
 */

import { describe, expect, it } from "vitest";
import { graph } from "../index.js";

describe("checkpoint JSON (D797 review)", () => {
	it("an effect that ran and returned a cleanup leaves the graph checkpointable", () => {
		const g = graph();
		const s = g.state(1, { name: "s" });
		let cleaned = 0;
		const e = g.effect([s], () => () => {
			cleaned += 1;
		});
		const stop = e.subscribe(() => {});
		s.set(2);
		expect(() => g.checkpoint()).not.toThrow();
		expect(cleaned).toBe(0); // a rerun replaces the cleanup without running it
		stop();
		expect(cleaned).toBe(1); // the lifetime's close runs the latest one once
	});
});
