import { describe, expect, it } from "vitest";
import { DATA, DIRTY, RESOLVED } from "../../core/messages.js";
import { describeNode } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { pipe } from "../../core/sugar.js";

describe("sugar constructors", () => {
	it("node([], { initial }) is a manual source with initial value", () => {
		const s = node([], { initial: 10 });
		expect(s.cache).toBe(10);
		const seen: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		s.down([[DIRTY], [DATA, 11]]);
		unsub();
		expect(s.cache).toBe(11);
		expect(seen).toContain(DIRTY);
		expect(seen).toContain(DATA);
	});

	it("node([]) (zero-arg overload) starts in sentinel status with no cached DATA", () => {
		// qa D2: zero-arg `node([])` is the canonical raw form for "no value yet".
		const s = node<number>([]);
		expect(s.cache).toBeUndefined();
		expect(s.status).toBe("sentinel");
		const seen: Array<[symbol, unknown]> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		// Subscribe-with-sentinel: NO DATA arrives push-on-subscribe
		// (status="sentinel" means no cached value to replay).
		expect(seen.find(([t]) => t === DATA)).toBeUndefined();
		// First emit transitions to "settled" status with a real value.
		s.emit(42);
		expect(s.cache).toBe(42);
		expect(s.status).toBe("settled");
		expect(seen.find(([t]) => t === DATA)?.[1]).toBe(42);
		unsub();
	});

	it("node([], { initial: null }) caches null as a valid DATA value (distinct from sentinel)", () => {
		// Spec §2.2: `T | null` is the valid DATA domain; only `undefined`
		// is the SENTINEL. Confirm `node([], { initial: null })` differs from `node([])`:
		// the null cache puts the node in `"settled"` status with an
		// observable null DATA on subscribe.
		const s = node<number | null>([], { initial: null });
		expect(s.cache).toBeNull();
		expect(s.status).toBe("settled");
		const seen: unknown[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1]);
			}
		});
		expect(seen).toEqual([null]);
		unsub();
	});

	it("node producer runs on subscribe and can emit", () => {
		const p = node<number>(
			[],
			(_data, actions) => {
				actions.emit(1);
			},
			{ describeKind: "producer" },
		);
		const seen: number[] = [];
		const unsub = p.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as number);
			}
		});
		expect(p.cache).toBe(1);
		// Producer emits 1 during _startProducer → single delivery.
		expect(seen).toEqual([1]);
		unsub();
	});

	it("node derived is deps + value-returning fn", () => {
		const src = node([], { initial: 2 });
		const d = node(
			[src],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 3);
			},
			{ describeKind: "derived" },
		);
		const seen: symbol[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		src.down([[DATA, 3]]);
		expect(d.cache).toBe(9);
		expect(seen).toContain(DATA);
		unsub();
	});

	it("effect and producer set describe kind for describe()", () => {
		const e = node(
			[node([], { initial: 0 })],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				void data;
			},
			{ describeKind: "effect" },
		);
		expect(describeNode(e).type).toBe("effect");
		const p = node<number>(
			[],
			(_data, actions) => {
				actions.emit(1);
			},
			{ describeKind: "producer" },
		);
		expect(describeNode(p).type).toBe("producer");
	});

	it("effect runs without auto-emit from return value", () => {
		const src = node([], { initial: 0 });
		let runs = 0;
		const e = node(
			[src],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				void data;
				runs += 1;
				return undefined;
			},
			{ describeKind: "effect" },
		);
		const unsub = e.subscribe(() => undefined);
		src.down([[DIRTY], [DATA, 1]]);
		unsub();
		// Initial connect runs once; dep update runs again.
		expect(runs).toBe(2);
		expect(e.cache).toBeUndefined();
	});

	it("node derived propagates dep value types into the callback (no extra casts needed)", () => {
		const a = node([], { initial: 2 });
		const b = node([], { initial: "hi" as string });
		const out = node(
			[a, b],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const sum = data[0] as number;
				const label = data[1] as string;
				actions.emit(`${label}:${sum * 2}`);
			},
			{ describeKind: "derived" },
		);
		const unsub = out.subscribe(() => undefined);
		expect(out.cache).toBe("hi:4");
		a.down([[DATA, 5]]);
		expect(out.cache).toBe("hi:10");
		unsub();
	});

	it("node effect receives typed deps and runs without auto-emit", () => {
		const src = node([], { initial: 7 });
		const flag = node([], { initial: false });
		let lastSeen: [number, boolean] | undefined;
		const e = node(
			[src, flag],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const n = data[0] as number;
				const f = data[1] as boolean;
				lastSeen = [n, f];
			},
			{ describeKind: "effect" },
		);
		const unsub = e.subscribe(() => undefined);
		expect(lastSeen).toEqual([7, false]);
		flag.down([[DATA, true]]);
		expect(lastSeen).toEqual([7, true]);
		unsub();
	});

	it("pipe chains unary node transforms", () => {
		const src = node([], { initial: 1 });
		const doubled = (n: Node) =>
			node(
				[n],
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit((data[0] as number) * 2);
				},
				{ describeKind: "derived" },
			);
		const out = pipe(src, doubled, doubled);
		const unsub = out.subscribe(() => undefined);
		expect(out.cache).toBe(4);
		unsub();
	});

	it("pipe with no ops returns source", () => {
		const src = node([], { initial: "x" as string });
		expect(pipe(src)).toBe(src);
	});

	it("raw node with explicit actions.down() does not emit DATA", () => {
		const src = node([], { initial: 0 });
		const d = node([src], (_data, actions) => {
			actions.down([[DIRTY], [RESOLVED]]);
		});
		const vals: unknown[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) vals.push(m[1]);
			}
		});
		src.down([[DIRTY], [DATA, 1]]);
		unsub();
		expect(vals.length).toBe(0);
	});
});
