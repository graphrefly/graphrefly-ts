import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { node } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}

const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("state node (manual source)", () => {
	it("push-on-subscribe delivers START then cached DATA (R-push-subscribe, R-initial)", () => {
		const s = node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"], ["DATA", 5]]);
		expect(s.cache).toBe(5);
		expect(s.status).toBe("settled");
	});

	it("uncached subscribe delivers only START", () => {
		const s = node<number>([], null);
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"]]);
		expect(s.cache).toBeUndefined();
		expect(s.status).toBe("sentinel");
	});

	it("external down emits DIRTY before DATA (R-dirty-before-data, two-phase)", () => {
		const s = node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["DATA", 2]]);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(msgs[1]).toEqual(["DATA", 2]);
		expect(s.cache).toBe(2);
	});

	it("null is a valid DATA value (R-data-payload)", () => {
		const s = node<number | null>([], null, { initial: null });
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"], ["DATA", null]]);
		expect(s.cache).toBeNull();
	});
});

describe("occurrences stay DATA (R-resolved-undirty / D49, supersedes R-equals)", () => {
	it("re-emitting the same value yields DATA, not RESOLVED (no equals-substitution)", () => {
		const s = node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["DATA", 5]]); // same value is still a distinct occurrence
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(s.cache).toBe(5);
	});

	it("a changed value yields DATA", () => {
		const s = node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["DATA", 6]]);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(s.cache).toBe(6);
	});

	it("a multi-DATA wave passes every occurrence as DATA", () => {
		const s = node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([
			["DATA", 5],
			["DATA", 5],
		]);
		expect(types(msgs)).toEqual(["DIRTY", "DATA", "DATA"]);
	});
});

describe("compute node (derived)", () => {
	it("computes from a dep and recomputes on change", () => {
		const count = node<number>([], null, { initial: 2 });
		const doubled = node<number>([count], (ctx: Ctx) => {
			ctx.down([["DATA", (ctx.depRecords[0].latest as number) * 2]]);
		});
		const { msgs } = collect(doubled);
		expect(doubled.cache).toBe(4);
		expect(msgs).toContainEqual(["DATA", 4]);

		msgs.length = 0;
		count.down([["DATA", 10]]);
		expect(doubled.cache).toBe(20);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(msgs[1]).toEqual(["DATA", 20]);
	});
});

describe("diamond (R-diamond, glitch-free join)", () => {
	it("join node computes exactly once per upstream change, after both deps settle", () => {
		let fireCount = 0;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (ctx.depRecords[0].latest as number) + 10]]),
		);
		const c = node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (ctx.depRecords[0].latest as number) + 20]]),
		);
		const d = node<number>([b, c], (ctx: Ctx) => {
			fireCount++;
			ctx.down([
				["DATA", (ctx.depRecords[0].latest as number) + (ctx.depRecords[1].latest as number)],
			]);
		});

		collect(d);
		expect(d.cache).toBe(32); // (1+10) + (1+20)
		expect(fireCount).toBe(1); // joined once, not once per leg

		fireCount = 0;
		a.down([["DATA", 2]]);
		expect(d.cache).toBe(34); // (2+10) + (2+20)
		expect(fireCount).toBe(1); // recomputed exactly once
	});
});

describe("first-run gate (R-first-run-gate)", () => {
	it("partial:false holds fn until every dep has settled", () => {
		let fired = false;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null); // uncached — never settles
		node<number>([a, b], () => {
			fired = true;
		});
		collect(node<number>([a, b], () => {})); // force-activate a separate gate path

		// Build the gated node explicitly and activate it:
		fired = false;
		const gated = node<number>([a, b], () => {
			fired = true;
		});
		gated.subscribe(() => {});
		expect(fired).toBe(false); // b never delivered real DATA -> gate holds
		b.down([["DATA", 9]]);
		expect(fired).toBe(true); // now both settled -> fires once
	});

	it("partial:true fires without waiting for all deps", () => {
		let fired = false;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null); // uncached
		const g = node<number>(
			[a, b],
			(ctx: Ctx) => {
				fired = true;
				// fn body guards SENTINEL per dep (R-first-run-gate partial contract)
				const bv = ctx.depRecords[1].latest;
				ctx.down([["DATA", bv === undefined ? -1 : (bv as number)]]);
			},
			{ partial: true },
		);
		g.subscribe(() => {});
		expect(fired).toBe(true);
		expect(g.cache).toBe(-1);
	});
});

describe("ctx.up direction guard (R-ctx-up)", () => {
	it("throws on a down-only tier", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx: Ctx) => ctx.down([["DATA", 1]]));
		d.subscribe(() => {});
		expect(() => d.up([["DATA", 5]])).toThrow(/down-only/);
		expect(() => d.up([["COMPLETE"]])).toThrow(/down-only/);
		expect(() => d.up([["INVALIDATE"]])).not.toThrow();
	});
});

describe("B49 core-slot migration", () => {
	it("stores wave bookkeeping behind the Node view, without old direct-field shims", () => {
		const s = node<number>([], null, { initial: 1, factory: "probe" });
		const view = s as unknown as Record<string, unknown>;

		expect(Object.hasOwn(view, "_core")).toBe(true);
		expect(Object.hasOwn(view, "_id")).toBe(true);
		expect(Object.hasOwn(view, "_slot")).toBe(true);
		for (const oldField of [
			"_deps",
			"_depBatch",
			"_depPrev",
			"_depDirty",
			"_pending",
			"_cache",
			"_status",
			"_subscribers",
			"_pauseLockset",
			"_depRecords",
		]) {
			expect(Object.hasOwn(view, oldField), oldField).toBe(false);
		}

		expect(s.cache).toBe(1);
		expect(s.status).toBe("settled");
		expect(s.factory).toBe("probe");
	});
});
