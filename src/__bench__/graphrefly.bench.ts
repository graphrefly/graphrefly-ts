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
import { type Node, node } from "../core/node.js";

const push = (n: { down: (m: Messages) => void }, v: number) => {
	n.down([[DIRTY], [DATA, v]]);
};
const read = (n: { cache: unknown }) => n.cache;

// ─── Primitives (state analogue) ───────────────────────────

describe("state: read", () => {
	const s = node<number>([], { initial: 0 });
	bench("state.cache", () => {
		read(s);
	});
});

describe("state: write (no subscribers)", () => {
	const s = node<number>([], { initial: 0 });
	let i = 0;
	bench("state.set()", () => {
		push(s, i++);
	});
});

describe("state: write (with subscriber)", () => {
	const s = node<number>([], { initial: 0 });
	const unsub = s.subscribe(() => undefined);
	let i = 0;
	bench("state.set() + subscriber", () => {
		push(s, i++);
	});
	afterAll(() => unsub());
});

// ─── Derived ───────────────────────────────────────────────

describe("derived: single-dep (P0 fast path)", () => {
	const a = node<number>([], { initial: 0 });
	const d = node(
		[a],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) * 2);
		},
		{ describeKind: "derived" },
	);
	const unsub = d.subscribe(() => undefined);
	let i = 0;
	bench("set + get", () => {
		push(a, i++);
		read(d);
	});
	afterAll(() => unsub());
});

describe("derived: multi-dep", () => {
	const a = node<number>([], { initial: 0 });
	const b = node<number>([], { initial: 0 });
	const d = node(
		[a, b],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + (data[1] as number));
		},
		{ describeKind: "derived" },
	);
	const unsub = d.subscribe(() => undefined);
	let i = 0;
	bench("set one dep + get", () => {
		push(a, i++);
		read(d);
	});
	afterAll(() => unsub());
});

describe("derived: cached read (unchanged deps)", () => {
	const a = node<number>([], { initial: 5 });
	const d = node(
		[a],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) * 2);
		},
		{ describeKind: "derived" },
	);
	const unsub = d.subscribe(() => undefined);
	bench("get (cached)", () => {
		read(d);
	});
	afterAll(() => unsub());
});

// ─── Diamond ───────────────────────────────────────────────

describe("diamond: A → B,C → D", () => {
	const a = node<number>([], { initial: 0 });
	const b = node(
		[a],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + 1);
		},
		{ describeKind: "derived" },
	);
	const c = node(
		[a],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) * 2);
		},
		{ describeKind: "derived" },
	);
	const d = node(
		[b, c],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + (data[1] as number));
		},
		{ describeKind: "derived" },
	);
	const unsub = d.subscribe(() => undefined);
	let i = 0;
	bench("set root + get leaf", () => {
		push(a, i++);
		read(d);
	});
	afterAll(() => unsub());
});

describe("diamond: deep (5 levels)", () => {
	const root = node<number>([], { initial: 0 });
	const l1a = node(
		[root],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + 1);
		},
		{ describeKind: "derived" },
	);
	const l1b = node(
		[root],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) * 2);
		},
		{ describeKind: "derived" },
	);
	const l2a = node(
		[l1a, l1b],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + (data[1] as number));
		},
		{ describeKind: "derived" },
	);
	const l2b = node(
		[l1a, l1b],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) * (data[1] as number));
		},
		{ describeKind: "derived" },
	);
	const leaf = node(
		[l2a, l2b],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + (data[1] as number));
		},
		{ describeKind: "derived" },
	);
	const unsub = leaf.subscribe(() => undefined);
	let i = 0;
	bench("set root + get leaf", () => {
		push(root, i++);
		read(leaf);
	});
	afterAll(() => unsub());
});

describe("diamond: wide (10 intermediates)", () => {
	const root = node<number>([], { initial: 0 });
	const intermediates = Array.from({ length: 10 }, (_, j) =>
		node(
			[root],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + j);
			},
			{ describeKind: "derived" },
		),
	);
	const leaf = node(
		intermediates,
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(data.reduce((sum: number, v) => sum + (v as number), 0));
		},
		{ describeKind: "derived" },
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
	const trigger = node<number>([], { initial: 0 });
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
	const a = node<number>([], { initial: 0 });
	const b = node(
		[a],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + 1);
		},
		{ describeKind: "derived" },
	);
	const c = node(
		[a],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) * 2);
		},
		{ describeKind: "derived" },
	);
	const eff = node(
		[b, c],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + (data[1] as number));
		},
		{ describeKind: "derived" },
	);
	const unsub = eff.subscribe(() => undefined);
	let i = 0;
	bench("set root, effect runs once", () => {
		push(a, i++);
	});
	afterAll(() => unsub());
});

// ─── Fan-out ───────────────────────────────────────────────

describe("fan-out: 10 subscribers", () => {
	const src = node<number>([], { initial: 0 });
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
	const src = node<number>([], { initial: 0 });
	const unsubs = Array.from({ length: 100 }, () => src.subscribe(() => undefined));
	let i = 0;
	bench("set with 100 subscribers", () => {
		push(src, i++);
	});
	afterAll(() => {
		for (const u of unsubs) u();
	});
});

// B18 — extended fan-out scaling to validate the sink-notification cost trend.
describe("fan-out: 1000 subscribers", () => {
	const src = node<number>([], { initial: 0 });
	const unsubs = Array.from({ length: 1000 }, () => src.subscribe(() => undefined));
	let i = 0;
	bench("set with 1000 subscribers", () => {
		push(src, i++);
	});
	afterAll(() => {
		for (const u of unsubs) u();
	});
});

// ─── B7 — passthrough-heavy chains (measure `_emit([msg])` wrapper cost) ─────
//
// Fn-less nodes (`node([dep])` without a `fn`) forward DATA/RESOLVED via the
// passthrough branch at `_onDepMessage`, which calls `this._emit([msg])` per
// forwarded message — one fresh single-element wrapper allocation per node
// per message. A 5-level chain runs the path 5× per source write; a 10-level
// chain runs it 10×. Baseline for the single-message `_emit` overload
// decision in B7.

describe("passthrough: 5-level fn-less chain", () => {
	const head = node<number>([], { initial: 0 });
	let cur: Node<number> = head;
	for (let j = 0; j < 5; j++) cur = node<number>([cur]);
	const tail = cur;
	const unsub = tail.subscribe(() => undefined);
	let i = 0;
	bench("set head + propagate through 5 fn-less passthroughs", () => {
		push(head, i++);
	});
	afterAll(() => unsub());
});

describe("passthrough: 10-level fn-less chain", () => {
	const head = node<number>([], { initial: 0 });
	let cur: Node<number> = head;
	for (let j = 0; j < 10; j++) cur = node<number>([cur]);
	const tail = cur;
	const unsub = tail.subscribe(() => undefined);
	let i = 0;
	bench("set head + propagate through 10 fn-less passthroughs", () => {
		push(head, i++);
	});
	afterAll(() => unsub());
});

describe("passthrough: 20-level fn-less chain", () => {
	const head = node<number>([], { initial: 0 });
	let cur: Node<number> = head;
	for (let j = 0; j < 20; j++) cur = node<number>([cur]);
	const tail = cur;
	const unsub = tail.subscribe(() => undefined);
	let i = 0;
	bench("set head + propagate through 20 fn-less passthroughs", () => {
		push(head, i++);
	});
	afterAll(() => unsub());
});

// ─── Batching ──────────────────────────────────────────────

describe("batch: 10 sets + derived reader", () => {
	const items = Array.from({ length: 10 }, (_, k) => node<number>([], { initial: k }));
	const agg = node(
		items,
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(data.reduce((s, v) => (s as number) + (v as number), 0));
		},
		{ describeKind: "derived" },
	);
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
	const a1 = node<number>([], { initial: 0 });
	const b1 = node(
		[a1],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) >= 5 ? 1 : 0);
		},
		{ describeKind: "derived" },
	);
	const c1 = node(
		[a1],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) * 2);
		},
		{ describeKind: "derived" },
	);
	const e1 = node(
		[b1, c1],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + (data[1] as number));
		},
		{ describeKind: "derived" },
	);
	const u1 = e1.subscribe(() => undefined);
	let k1 = 0;

	const a2 = node<number>([], { initial: 0 });
	const b2 = node(
		[a2],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) >= 5 ? 1 : 0);
		},
		{ describeKind: "derived", equals: (x, y) => x === y },
	);
	const c2 = node(
		[a2],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) * 2);
		},
		{ describeKind: "derived" },
	);
	const e2 = node(
		[b2, c2],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + (data[1] as number));
		},
		{ describeKind: "derived" },
	);
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
	const head = node<number>([], { initial: 0 });
	let cur: Node<number> = head;
	for (let j = 0; j < 9; j++) {
		const prev = cur;
		cur = node(
			[prev],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived" },
		);
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
	const x = node<number>([], { initial: 0 });
	const y = node<number>([], { initial: 0 });
	const sum = node(
		[x, y],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as number) + (data[1] as number));
		},
		{ describeKind: "derived" },
	);
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
	const a1 = node<number>([], { initial: 0, equals: alwaysDiffer });
	let cur1: Node<number> = node(
		[a1],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(heavyTransform(data[0] as number));
		},
		{ describeKind: "derived", equals: alwaysDiffer },
	);
	for (let j = 0; j < 4; j++) {
		const prev = cur1;
		cur1 = node(
			[prev],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(heavyTransform(data[0] as number));
			},
			{ describeKind: "derived", equals: alwaysDiffer },
		);
	}
	const tail1 = cur1;
	const u1 = tail1.subscribe(() => undefined);
	let k1 = 0;

	// Optimized: default `equals` (Object.is) everywhere. Source collapses
	// duplicate writes to RESOLVED via §3.5.1 substitution, downstream
	// levels pre-fn skip (`!_waveHasNewData`) so the leaf fn only runs on
	// actual transitions (half the time for the noop pattern).
	const a2 = node<number>([], { initial: 0 });
	let cur2: Node<number> = node(
		[a2],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(heavyTransform(data[0] as number));
		},
		{ describeKind: "derived" },
	);
	for (let j = 0; j < 4; j++) {
		const prev = cur2;
		cur2 = node(
			[prev],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(heavyTransform(data[0] as number));
			},
			{ describeKind: "derived" },
		);
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
	const src1 = node<number>([], { initial: 0, equals: alwaysDiffer });
	const l1 = node(
		[src1],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(heavyTransform(data[0] as number));
		},
		{ describeKind: "derived", equals: alwaysDiffer },
	);
	const r1 = node(
		[src1],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(heavyTransform(data[0] as number) + 1);
		},
		{ describeKind: "derived", equals: alwaysDiffer },
	);
	const j1 = node(
		[l1, r1],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(heavyTransform((data[0] as number) + (data[1] as number)));
		},
		{ describeKind: "derived", equals: alwaysDiffer },
	);
	const u1 = j1.subscribe(() => undefined);
	let k1 = 0;

	const src2 = node<number>([], { initial: 0 });
	const l2 = node(
		[src2],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(heavyTransform(data[0] as number));
		},
		{ describeKind: "derived" },
	);
	const r2 = node(
		[src2],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(heavyTransform(data[0] as number) + 1);
		},
		{ describeKind: "derived" },
	);
	const j2 = node(
		[l2, r2],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(heavyTransform((data[0] as number) + (data[1] as number)));
		},
		{ describeKind: "derived" },
	);
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
