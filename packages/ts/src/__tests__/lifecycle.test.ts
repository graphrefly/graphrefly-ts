import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { depLatest, graph } from "../index.js";
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

describe("terminal (R-terminal, R-deps-terminal)", () => {
	it("auto-COMPLETE when ALL deps complete", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const d = g.node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + 1]]),
		);
		const { msgs } = collect(d);
		msgs.length = 0;
		a.complete();
		// graphrefly:D806 (1): under auto COMPLETE the run that sees the last terminal calls the
		// function, also when the terminal is its only input; this function sends on every run, so
		// it sends once more before the COMPLETE. Each array carries the kernel's PENDING.
		expect(types(msgs)).toEqual(["PENDING", "DATA", "PENDING", "COMPLETE"]);
		expect(d.status.output).toBe("completed");
	});

	it("requires ALL deps complete, not ANY", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([], null, { initial: 2 });
		const d = g.node<number>([a, b], (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + (depLatest(ctx, 1) as number)]]),
		);
		const { msgs } = collect(d);
		msgs.length = 0;
		a.complete();
		expect(types(msgs)).not.toContain("COMPLETE"); // only one dep complete
		b.complete();
		expect(types(msgs)).toContain("COMPLETE"); // now all complete
		expect(d.status.output).toBe("completed");
	});

	it("auto-ERROR when any dep errors (errorWhenDepsError)", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const d = g.node<number>([a], (ctx: Ctx) => ctx.down([["DATA", 1]]));
		const { msgs } = collect(d);
		msgs.length = 0;
		const err = new Error("boom");
		a.error(err);
		expect(msgs).toContainEqual(["ERROR", err]);
		expect(d.status.output).toBe("errored");
	});

	it("ERROR with undefined or boolean payload is rejected (R-data-payload)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		collect(s);
		expect(() => s.error(undefined)).toThrow(/non-SENTINEL/);
		expect(() => s.error(false)).toThrow(/non-boolean/);
		expect(() => s.error(true)).toThrow(/non-boolean/);
	});

	it("an ended node can be subscribed; its START snapshot carries its terminal (R-terminals)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		collect(s);
		s.complete();
		const late: unknown[] = [];
		s.subscribe((msgs) => late.push(msgs));
		expect(late).toEqual([[["START"], ["DATA", 1], ["COMPLETE"]]]);
		expect(s.status.output).toBe("completed");
	});

	it("host input to an ended node is refused and changes nothing (R-terminals)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		s.complete();
		expect(s.status.output).toBe("completed");
		msgs.length = 0;

		expect(() => s.set(42)).toThrow(/ended/);
		expect(msgs).toEqual([]);
		expect(s.cache).toBe(1);
		expect(s.status.output).toBe("completed");

		const e = g.node<number>([], null, { initial: 7 });
		const ce = collect(e);
		e.error(new Error("boom"));
		ce.msgs.length = 0;
		expect(() => e.set(99)).toThrow(/ended/);
		expect(() => e.invalidate()).toThrow(/ended/);
		expect(ce.msgs).toEqual([]);
		expect(e.cache).toBe(7);
		expect(e.status.output).toBe("errored");
	});
});

describe("INVALIDATE (R-invalidation)", () => {
	it("under the manual policy the function flushes and sends the INVALIDATE; idempotent", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 5 });
		let flushed = 0;
		const d = g.node<number>(
			[a],
			(ctx: Ctx) => {
				if (ctx.invalidated[0]) {
					flushed++;
					ctx.down([["INVALIDATE"]]);
					return;
				}
				ctx.down([["DATA", (depLatest(ctx, 0) as number) * 2]]);
			},
			{ invalidate: "manual" },
		);
		const { msgs } = collect(d);
		expect(d.cache).toBe(10);
		msgs.length = 0;

		a.invalidate();
		expect(flushed).toBe(1);
		expect(d.cache).toBeUndefined();
		expect(types(msgs)).toContain("INVALIDATE");

		// second INVALIDATE: cache already reset -> no-op (no second flush/cascade)
		msgs.length = 0;
		a.invalidate();
		expect(flushed).toBe(1);
		expect(types(msgs)).not.toContain("INVALIDATE");
	});

	it("never-populated INVALIDATE is a no-op", () => {
		const g = graph();
		const s = g.node<number>([], null); // no cache
		const { msgs } = collect(s);
		msgs.length = 0;
		s.invalidate();
		expect(msgs).toEqual([]);
	});
});

describe("same-wave merge (R-same-wave-merge)", () => {
	it("an array is split at its last INVALIDATE; what came before it is dropped (R-wave)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		g.batch(() => {
			s.set(9);
			s.invalidate();
		});
		expect(types(msgs)).toEqual(["PENDING", "INVALIDATE"]);
		expect(s.cache).toBeUndefined();
	});

	it("INVALIDATE + INVALIDATE collapse to one (Q9)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		g.batch(() => {
			s.invalidate();
			s.invalidate();
		});
		expect(types(msgs)).toEqual(["PENDING", "INVALIDATE"]);
	});
});

describe("ROM/RAM + cleanup (R-rom-ram, R-cleanup-hooks)", () => {
	it("compute node clears cache on deactivation and runs its setup's cleanup", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		let cleaned = 0;
		const d = g.node<number>([a], (ctx: Ctx) => ctx.down([["DATA", 1]]), {
			setup: () => () => {
				cleaned++;
			},
		});
		const { unsub } = collect(d);
		expect(d.cache).toBe(1);
		unsub();
		expect(cleaned).toBe(1);
		expect(d.cache).toBeUndefined(); // RAM
		expect(d.status.cache).toBe("empty");
	});

	it("state node retains cache across disconnect (ROM)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 7 });
		const { unsub } = collect(s);
		unsub();
		expect(s.cache).toBe(7);
	});
});
