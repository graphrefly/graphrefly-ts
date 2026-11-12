import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { graph } from "../index.js";
import type { Wave } from "../protocol/messages.js";

function collect(n: { subscribe(s: (m: Wave) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((incoming) => {
		for (const m of incoming) {
			msgs.push(m);
		}
	});
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("a late ctx.down is a later wave (R-wave@2, R8 late-emit pairing)", () => {
	it("a late ctx.down from a function that kept its ctx pairs PENDING+DATA downstream", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 3 });
		let resolve = null as (() => void) | null;
		const dbl = g.node<number>([a], (ctx: Ctx) => {
			const v = ctx.deps[0].value as number;
			resolve = () => ctx.down([["DATA", v * 2]]);
		});
		const { msgs } = collect(dbl);
		// fn ran synchronously (set resolve) but emitted nothing yet.
		expect(dbl.cache).toBeUndefined();
		expect(types(msgs)).toEqual(["START"]);

		resolve?.();
		expect(dbl.cache).toBe(6);
		expect(types(msgs)).toEqual(["START", "PENDING", "DATA"]);
	});
});
