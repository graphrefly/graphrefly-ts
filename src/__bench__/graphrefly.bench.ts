/**
 * Core benchmarks aligned with callbag-recharge `src/__bench__/compare.bench.ts` shapes.
 * Omitted (not in GraphReFly core yet): producer, operator, pipe / pipeRaw, Inspector.
 *
 * `describe` bodies run at file load (like callbag); do not use `beforeAll` for graph setup —
 * Vitest benchmark mode does not run `beforeAll` before Tinybench.
 */
import { afterAll, bench, describe } from "vitest";
import { batch } from "../core/batch.js";
import { DATA, DIRTY, type Messages } from "../core/messages.js";
import { derived, state } from "../core/sugar.js";

const push = (n: { down: (m: Messages) => void }, v: number) => {
	n.down([[DIRTY], [DATA, v]]);
};
const read = (n: { cache: unknown }) => n.cache;

// ─── Primitives (state analogue) ───────────────────────────

describe("state: read", () => {
	const s = state<number>(0);
	bench("state.cache", () => {
		read(s);
	});
});

describe("state: write (no subscribers)", () => {
	const s = state<number>(0);
	let i = 0;
	bench("state.set()", () => {
		push(s, i++);
	});
});

describe("state: write (with subscriber)", () => {
	const s = state<number>(0);
	const unsub = s.subscribe(() => undefined);
	let i = 0;
	bench("state.set() + subscriber", () => {
		push(s, i++);
	});
	afterAll(() => unsub());
});

// ─── Derived ───────────────────────────────────────────────

describe("derived: single-dep (P0 fast path)", () => {
	const a = state<number>(0);
	const d = derived([a], ([v]) => (v as number) * 2);
	const unsub = d.subscribe(() => undefined);
	let i = 0;
	bench("set + get", () => {
		push(a, i++);
		read(d);
	});
	afterAll(() => unsub());
});

describe("derived: multi-dep", () => {
	const a = state<number>(0);
	const b = state<number>(0);
	const d = derived([a, b], ([x, y]) => (x as number) + (y as number));
	const unsub = d.subscribe(() => undefined);
	let i = 0;
	bench("set one dep + get", () => {
		push(a, i++);
		read(d);
	});
	afterAll(() => unsub());
});

describe("derived: cached read (unchanged deps)", () => {
	const a = state<number>(5);
	const d = derived([a], ([v]) => (v as number) * 2);
	const unsub = d.subscribe(() => undefined);
	bench("get (cached)", () => {
		read(d);
	});
	afterAll(() => unsub());
});

// ─── Diamond ───────────────────────────────────────────────

describe("diamond: A → B,C → D", () => {
	const a = state<number>(0);
	const b = derived([a], ([v]) => (v as number) + 1);
	const c = derived([a], ([v]) => (v as number) * 2);
	const d = derived([b, c], ([bv, cv]) => (bv as number) + (cv as number));
	const unsub = d.subscribe(() => undefined);
	let i = 0;
	bench("set root + get leaf", () => {
		push(a, i++);
		read(d);
	});
	afterAll(() => unsub());
});

describe("diamond: deep (5 levels)", () => {
	const root = state<number>(0);
	const l1a = derived([root], ([v]) => (v as number) + 1);
	const l1b = derived([root], ([v]) => (v as number) * 2);
	const l2a = derived([l1a, l1b], ([x, y]) => (x as number) + (y as number));
	const l2b = derived([l1a, l1b], ([x, y]) => (x as number) * (y as number));
	const leaf = derived([l2a, l2b], ([x, y]) => (x as number) + (y as number));
	const unsub = leaf.subscribe(() => undefined);
	let i = 0;
	bench("set root + get leaf", () => {
		push(root, i++);
		read(leaf);
	});
	afterAll(() => unsub());
});

describe("diamond: wide (10 intermediates)", () => {
	const root = state<number>(0);
	const intermediates = Array.from({ length: 10 }, (_, j) =>
		derived([root], ([rv]) => (rv as number) + j),
	);
	const leaf = derived(intermediates, (deps) =>
		deps.reduce((sum: number, v) => sum + (v as number), 0),
	);
	const unsub = leaf.subscribe(() => undefined);
	let i = 0;
	bench("set root + get leaf", () => {
		push(root, i++);
		read(leaf);
	});
	afterAll(() => unsub());
});

// ─── Effect (subscriber / derived re-run) ─────────────────

describe("effect: single dep re-run", () => {
	const trigger = state<number>(0);
	const unsub = trigger.subscribe(() => {
		read(trigger);
	});
	let i = 0;
	bench("state.set() triggers effect", () => {
		push(trigger, i++);
	});
	afterAll(() => unsub());
});

describe("effect: multi-dep (diamond + effect)", () => {
	const a = state<number>(0);
	const b = derived([a], ([v]) => (v as number) + 1);
	const c = derived([a], ([v]) => (v as number) * 2);
	const eff = derived([b, c], ([bv, cv]) => (bv as number) + (cv as number));
	const unsub = eff.subscribe(() => undefined);
	let i = 0;
	bench("set root, effect runs once", () => {
		push(a, i++);
	});
	afterAll(() => unsub());
});

// ─── Fan-out ───────────────────────────────────────────────

describe("fan-out: 10 subscribers", () => {
	const src = state<number>(0);
	const unsubs = Array.from({ length: 10 }, () => src.subscribe(() => undefined));
	let i = 0;
	bench("set with 10 subscribers", () => {
		push(src, i++);
	});
	afterAll(() => {
		for (const u of unsubs) u();
	});
});

describe("fan-out: 100 subscribers", () => {
	const src = state<number>(0);
	const unsubs = Array.from({ length: 100 }, () => src.subscribe(() => undefined));
	let i = 0;
	bench("set with 100 subscribers", () => {
		push(src, i++);
	});
	afterAll(() => {
		for (const u of unsubs) u();
	});
});

// ─── Batching ──────────────────────────────────────────────

describe("batch: 10 sets + derived reader", () => {
	const items = Array.from({ length: 10 }, (_, k) => state<number>(k));
	const agg = derived(items, (deps) => deps.reduce((s, v) => (s as number) + (v as number), 0));
	const unsub = agg.subscribe(() => undefined);
	let k = 0;
	let k2 = 0;
	bench("unbatched (10 sets)", () => {
		for (const s of items) push(s, k++);
	});
	bench("batched (10 sets)", () => {
		batch(() => {
			for (const s of items) push(s, k2++);
		});
	});
	afterAll(() => unsub());
});

// ─── Equals (push-phase memoization) ───────────────────────

describe("equals: diamond with memoization", () => {
	const a1 = state<number>(0);
	const b1 = derived([a1], ([v]) => ((v as number) >= 5 ? 1 : 0));
	const c1 = derived([a1], ([v]) => (v as number) * 2);
	const e1 = derived([b1, c1], ([bv, cv]) => (bv as number) + (cv as number));
	const u1 = e1.subscribe(() => undefined);
	let k1 = 0;

	const a2 = state<number>(0);
	const b2 = derived([a2], ([v]) => ((v as number) >= 5 ? 1 : 0), {
		equals: (x, y) => x === y,
	});
	const c2 = derived([a2], ([v]) => (v as number) * 2);
	const e2 = derived([b2, c2], ([bv, cv]) => (bv as number) + (cv as number));
	const u2 = e2.subscribe(() => undefined);
	let k2 = 0;

	bench("without equals", () => {
		push(a1, k1++);
	});
	bench("with equals (subtree skip)", () => {
		push(a2, k2++);
	});
	afterAll(() => {
		u1();
		u2();
	});
});

// ─── GraphReFly protocol extras (not in callbag compare) ───

describe("graphrefly: linear 10-node chain", () => {
	const head = state<number>(0);
	let cur: ReturnType<typeof state<number>> = head;
	for (let j = 0; j < 9; j++) {
		const prev = cur;
		cur = derived([prev], ([v]) => (v as number) + 1);
	}
	const tail = cur;
	const unsub = tail.subscribe(() => undefined);
	let i = 0;
	bench("linear 10-node chain: DIRTY+DATA", () => {
		push(head, i++);
	});
	afterAll(() => unsub());
});

describe("graphrefly: fan-in batch", () => {
	const x = state<number>(0);
	const y = state<number>(0);
	const sum = derived([x, y], ([a, b]) => (a as number) + (b as number));
	const unsub = sum.subscribe(() => undefined);
	let i = 0;
	bench("fan-in: batched DIRTY+DATA on two sources", () => {
		const n = i++;
		batch(() => {
			push(x, n);
			push(y, n + 1);
		});
	});
	afterAll(() => unsub());
});
