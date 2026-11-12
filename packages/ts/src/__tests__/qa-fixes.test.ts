import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { graph } from "../index.js";
import type { Subscribable } from "./helpers/collect.js";

function collect(n: Subscribable) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((incoming) => {
		for (const m of incoming) {
			msgs.push(m);
		}
	});
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("QA fixes", () => {
	it("EC1: rejects bare/undefined DATA payload (R-data-payload)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		collect(s);
		expect(() => s.set(undefined as unknown as number)).toThrow(/non-SENTINEL/);
	});

	it("EC2: rejects RESOLVED in node output; only the kernel sends it (R-wave@2)", () => {
		const g = graph();
		const t = g.node<number>([], null, { initial: 1 });
		let rejected: unknown;
		const s = g.node<number>([t], (ctx) => {
			try {
				ctx.down([["DATA", 2], ["RESOLVED"]]);
			} catch (error) {
				rejected = error;
			}
		});
		collect(s);
		expect(String(rejected)).toMatch(/kernel/);
	});

	it("BH6: INVALIDATE clears the retained value (no stale push-on-subscribe)", () => {
		// The node's retained value is the only thing a late subscriber is sent (R-push-subscribe);
		// there is no separate replay buffer.
		const g = graph();
		const s = g.node<number>([], null);
		collect(s);
		s.set(1);
		s.set(2);
		expect(collect(s).msgs).toEqual([["START"], ["DATA", 2]]); // retained before INVALIDATE
		s.invalidate();
		expect(s.cache).toBeUndefined();
		const { msgs } = collect(s); // late subscriber
		expect(types(msgs)).toEqual(["START"]); // no stale DATA sent
	});

	it("WEDGE: a passthrough over a RESOLVED-only dep balances its PENDING (R-resolved-undirty / D49)", () => {
		const g = graph();
		// Regression for the D49-widened wedge: a passthrough wire (deps, no fn) that broadcast
		// PENDING then receives an undirty RESOLVED from its dep (no DATA in the batch) must emit a
		// balancing RESOLVED, not leave a dangling PENDING. Under D49 a dep emits a bare RESOLVED on
		// every filter-reject / distinctUntilChanged-dup / no-emit fn, so this fires constantly.
		const src = g.node<number>([], null, { initial: 0 });
		// dep sends nothing for an odd value, so the kernel settles it with RESOLVED.
		const dep = g.node<number>([src], (ctx: Ctx) => {
			const v = ctx.deps[0].value as number;
			if (v % 2 === 0) ctx.down([["DATA", v]]);
		});
		const pass = g.node<number>([dep], null); // passthrough wire (_handle === null)
		const { msgs } = collect(pass);
		msgs.length = 0;
		src.set(1); // dep settles with no value → PENDING then RESOLVED to the passthrough
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]); // balanced, not a dangling ["PENDING"]
		expect(pass.status.cache).not.toBe("stale"); // un-wedged
	});
});
