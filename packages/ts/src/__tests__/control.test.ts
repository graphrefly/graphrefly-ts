import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { depLatest, node } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("async pool (R-sync-core async label, R8 late-emit pairing)", () => {
	it("a late ctx.down from an async fn pairs PENDING+DATA downstream", () => {
		const a = node<number>([], null, { initial: 3 });
		let resolve: (() => void) | null = null;
		const dbl = node<number>(
			[a],
			(ctx: Ctx) => {
				const v = depLatest(ctx, 0) as number;
				resolve = () => ctx.down([["DATA", v * 2]]);
			},
			{ pool: "async" },
		);
		const { msgs } = collect(dbl);
		// fn ran synchronously (set resolve) but emitted nothing yet.
		expect(dbl.cache).toBeUndefined();
		expect(types(msgs)).toEqual(["START"]);

		resolve?.();
		expect(dbl.cache).toBe(6);
		expect(types(msgs)).toEqual(["START", "PENDING", "DATA"]);
	});
});

describe("replayBuffer (R-replay-buffer)", () => {
	it("late subscriber receives the last N DATA after START", () => {
		const s = node<number>([], null, { replayBuffer: 3 });
		collect(s);
		s.down([["DATA", 1]]);
		s.down([["DATA", 2]]);
		s.down([["DATA", 3]]);
		s.down([["DATA", 4]]);

		const { msgs } = collect(s);
		expect(types(msgs)).toEqual(["START", "DATA", "DATA", "DATA"]);
		expect(msgs.slice(1).map((m) => m[1])).toEqual([2, 3, 4]);
	});
});
