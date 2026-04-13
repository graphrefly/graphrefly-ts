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

// ─── Equals subtree skip — workload-driven bench variants (B3) ─────────────

/**
 * The 2026-04-11 baseline's `equals: with (subtree skip)` bench showed ~1% win
 * because the source value incremented monotonically every iteration and
 * `equals` (default `Object.is`) was never seeing the same value twice.
 *
 * These variants drive two orthogonal levers to expose the real subtree-skip
 * benefit:
 *
 * 1. **Inputs actually repeat** — `push(a, k % 2)` toggles the source
 *    between 0 and 1, so every other write is a no-op that the first-level
 *    equals substitution absorbs into RESOLVED.
 *
 * 2. **`equals: () => false` as the "unmemoized" baseline** — NOT just
 *    omitting `equals`. Omitting equals uses default `Object.is`, which
 *    *already* does subtree-skip on same-value writes; that was the
 *    original bench's bug. `alwaysDiffer` forces every DATA to propagate
 *    regardless, simulating a naive reactive system with no memoization.
 *
 * 3. **Heavier fn body** — a trivial `(v) => v + 1` body is too cheap for
 *    the saved fn-run to outweigh the equals comparison cost. We use a
 *    small fixed-work loop inside fn so the fn-skip actually dominates.
 */

const alwaysDiffer = () => false;

// Synthetic "non-trivial fn" — adds a small fixed cost so that skipping
// the fn actually dominates the wire framing overhead.
function heavyTransform(v: number): number {
	let acc = v;
	for (let i = 0; i < 50; i++) acc = (acc * 31 + 7) >>> 0;
	return acc >>> 0;
}

// Pattern generator: produces `[0, 0, 1, 1, 0, 0, 1, 1, ...]` — every
// other write is a true duplicate of the previous, so equals substitution
// has something to collapse. A simple `k % 2` toggle produces NO duplicates
// (every write alternates 0/1), which is why the 2026-04-13 first attempt
// still measured no difference. Half the writes are genuine no-ops here.
const noopPattern = (k: number): number => Math.floor(k / 2) % 2;

describe("equals: 5-level linear chain, 50% no-op writes (heavy fn)", () => {
	// Baseline: source + all levels use `alwaysDiffer`. Every source write
	// fully propagates through the chain — the source never collapses
	// duplicates, downstream levels never pre-fn skip. Represents a naive
	// reactive system with no memoization anywhere.
	const a1 = state<number>(0, { equals: alwaysDiffer });
	let cur1: ReturnType<typeof state<number>> = derived([a1], ([v]) => heavyTransform(v as number), {
		equals: alwaysDiffer,
	});
	for (let j = 0; j < 4; j++) {
		const prev = cur1;
		cur1 = derived([prev], ([v]) => heavyTransform(v as number), { equals: alwaysDiffer });
	}
	const tail1 = cur1;
	const u1 = tail1.subscribe(() => undefined);
	let k1 = 0;

	// Optimized: default `equals` (Object.is) everywhere. Source collapses
	// duplicate writes to RESOLVED via §3.5.1 substitution, downstream
	// levels pre-fn skip (`!_waveHasNewData`) so the leaf fn only runs on
	// actual transitions (half the time for the noop pattern).
	const a2 = state<number>(0);
	let cur2: ReturnType<typeof state<number>> = derived([a2], ([v]) => heavyTransform(v as number));
	for (let j = 0; j < 4; j++) {
		const prev = cur2;
		cur2 = derived([prev], ([v]) => heavyTransform(v as number));
	}
	const tail2 = cur2;
	const u2 = tail2.subscribe(() => undefined);
	let k2 = 0;

	bench("baseline (alwaysDiffer — no subtree skip)", () => {
		push(a1, noopPattern(k1));
		k1++;
	});
	bench("with equals subtree skip (default Object.is)", () => {
		push(a2, noopPattern(k2));
		k2++;
	});
	afterAll(() => {
		u1();
		u2();
	});
});

describe("equals: diamond with 50% no-op inputs (heavy fn)", () => {
	// Diamond: both legs share the same source. When the source value
	// doesn't change, both legs emit RESOLVED at the first node and the
	// join's pre-fn skip fires. Baseline uses `alwaysDiffer` on every
	// node including the source so nothing collapses.
	const src1 = state<number>(0, { equals: alwaysDiffer });
	const l1 = derived([src1], ([v]) => heavyTransform(v as number), { equals: alwaysDiffer });
	const r1 = derived([src1], ([v]) => heavyTransform(v as number) + 1, { equals: alwaysDiffer });
	const j1 = derived([l1, r1], ([l, r]) => heavyTransform((l as number) + (r as number)), {
		equals: alwaysDiffer,
	});
	const u1 = j1.subscribe(() => undefined);
	let k1 = 0;

	const src2 = state<number>(0);
	const l2 = derived([src2], ([v]) => heavyTransform(v as number));
	const r2 = derived([src2], ([v]) => heavyTransform(v as number) + 1);
	const j2 = derived([l2, r2], ([l, r]) => heavyTransform((l as number) + (r as number)));
	const u2 = j2.subscribe(() => undefined);
	let k2 = 0;

	bench("baseline (alwaysDiffer — no diamond skip)", () => {
		push(src1, noopPattern(k1));
		k1++;
	});
	bench("with equals subtree skip (default Object.is)", () => {
		push(src2, noopPattern(k2));
		k2++;
	});
	afterAll(() => {
		u1();
		u2();
	});
});
