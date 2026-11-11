import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { depLatest, graph } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((incoming) => {
		for (const m of incoming) {
			msgs.push(m);
		}
	});
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("async pool (R-sync-core async label, R8 late-emit pairing)", () => {
	it("a late ctx.down from an async fn pairs PENDING+DATA downstream", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 3 });
		let resolve: (() => void) | null = null;
		const dbl = g.node<number>(
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
