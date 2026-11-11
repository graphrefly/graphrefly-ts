import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { depLatest, node } from "../index.js";
import { eachMessage } from "../node/each-message.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe(eachMessage((m) => msgs.push(m)));
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("QA fixes", () => {
	it("EC1: rejects bare/undefined DATA payload (R-data-payload)", () => {
		const s = node<number>([], null, { initial: 1 });
		collect(s);
		expect(() => s.down([["DATA", undefined as unknown as number]])).toThrow(/non-SENTINEL/);
	});

	it("EC2: rejects RESOLVED in node output; only the kernel sends it (R-wave@2)", () => {
		const s = node<number>([], null, { initial: 1 });
		collect(s);
		expect(() => s.down([["DATA", 2], ["RESOLVED"]])).toThrow(/kernel/);
	});

	it("BH6: INVALIDATE clears the replay buffer (no stale replay)", () => {
		const s = node<number>([], null, { replayBuffer: 3 });
		collect(s);
		s.down([["DATA", 1]]);
		s.down([["DATA", 2]]);
		s.down([["INVALIDATE"]]);
		const { msgs } = collect(s); // late subscriber
		expect(types(msgs)).toEqual(["START"]); // no stale DATA replayed
	});

	it("WEDGE: a passthrough over a RESOLVED-only dep balances its PENDING (R-resolved-undirty / D49)", () => {
		// Regression for the D49-widened wedge: a passthrough wire (deps, no fn) that broadcast
		// PENDING then receives an undirty RESOLVED from its dep (no DATA in the batch) must emit a
		// balancing RESOLVED, not leave a dangling PENDING. Under D49 a dep emits a bare RESOLVED on
		// every filter-reject / distinctUntilChanged-dup / no-emit fn, so this fires constantly.
		const src = node<number>([], null, { initial: 0 });
		// dep sends nothing for an odd value, so the kernel settles it with RESOLVED.
		const dep = node<number>([src], (ctx: Ctx) => {
			const v = depLatest(ctx, 0) as number;
			if (v % 2 === 0) ctx.down([["DATA", v]]);
		});
		const pass = node<number>([dep], null); // passthrough wire (_handle === null)
		const { msgs } = collect(pass);
		msgs.length = 0;
		src.down([["DATA", 1]]); // dep settles with no value → PENDING then RESOLVED to the passthrough
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]); // balanced, not a dangling ["PENDING"]
		expect(pass.status.cache).not.toBe("stale"); // un-wedged
	});
});
