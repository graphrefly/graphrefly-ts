import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { node } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("QA fixes", () => {
	it("EC1: rejects bare/undefined DATA payload (R-data-payload)", () => {
		const s = node<number>([], null, { initial: 1 });
		collect(s);
		expect(() => s.down([["DATA", undefined as unknown as number]])).toThrow(/non-SENTINEL/);
	});

	it("EC2: rejects DATA + RESOLVED in one wave (R-equals tier-3 exclusivity)", () => {
		const s = node<number>([], null, { initial: 1 });
		collect(s);
		expect(() => s.down([["DATA", 2], ["RESOLVED"]])).toThrow(/tier-3 exclusivity/);
	});

	it("EC3: dep INVALIDATE after DIRTY (before any DATA) un-wedges downstream", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null); // uncached -> first-run gate holds d forever
		const d = node<number>([a, b], (ctx: Ctx) => ctx.down([["DATA", 1]]));
		const { msgs } = collect(d);
		expect(d.cache).toBeUndefined(); // gate held (b never settled)
		msgs.length = 0;

		a.down([["DIRTY"]]); // d goes dirty, broadcasts DIRTY (pending=1)
		expect(types(msgs)).toEqual(["DIRTY"]);

		a.down([["INVALIDATE"]]); // a had data -> emits INVALIDATE to d -> d un-wedges
		expect(types(msgs)).toEqual(["DIRTY", "RESOLVED"]); // downstream un-dirtied, not stuck
		expect(d.status).toBe("sentinel");
	});

	it("BH3: terminal while paused discards the buffer (no post-terminal DATA on resume)", () => {
		const s = node<number>([], null, { initial: 0, pausable: "resumeAll" });
		const { msgs } = collect(s);
		msgs.length = 0;
		const L = Symbol("L");
		s.up([["PAUSE", L]]);
		s.down([["DATA", 1]]); // buffered (resumeAll)
		s.down([["COMPLETE"]]); // terminal bypasses buffer + discards it
		expect(types(msgs)).toContain("COMPLETE");
		s.up([["RESUME", L]]); // resume -> terminal guard -> no drain
		expect(types(msgs)).not.toContain("DATA"); // buffered DATA never delivered post-terminal
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
});
