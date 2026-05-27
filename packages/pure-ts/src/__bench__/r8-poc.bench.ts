/**
 * R8 PoC end-to-end bench — apples-to-apples comparison of fn-on-node
 * (baseline) vs fn-in-dispatcher-pool (R8) using the SAME protocol code.
 *
 * Workloads mirror `graphrefly.bench.ts` hot paths:
 *   - state.set() with subscriber
 *   - derived: single-dep, multi-dep
 *   - diamond: A → B,C → D
 *   - fan-out: 10 / 100 / 1000 subscribers
 *   - chain: 10-deep linear
 *
 * What this bench answers:
 *   Does moving `fn` from a Node member field into an external dispatcher
 *   pool measurably regress per-wave perf on real graph shapes?
 *
 * R6 target #2 (refined under R8): R8 within 1.5× of baseline on every
 * workload. Microbench (r8-dispatch-overhead.bench.ts) already showed
 * single-call indirection is ~0 ns; this bench confirms the end-to-end
 * graph protocol does not amplify it.
 */

import { afterAll, bench, describe } from "vitest";
import { baselineNode } from "../__experiments__/r8-poc/baseline.js";
import type { Actions, Ctx, TinyNode } from "../__experiments__/r8-poc/protocol.js";
import { r8Node } from "../__experiments__/r8-poc/r8.js";

type Make = typeof baselineNode | typeof r8Node;

// Helper to extract "fresh DATA this wave, else prev" — same shape as
// graphrefly.bench.ts.
const lastOrPrev =
	(idx: number) =>
	(batchData: ReadonlyArray<unknown[] | null>, ctx: Ctx): number => {
		const b = batchData[idx];
		return (b != null && b.length > 0 ? b.at(-1) : ctx.prevData[idx]) as number;
	};

// ─── state.set with subscriber ────────────────────────────────────

function setupStateWithSubscriber(make: Make) {
	const s = make<number>([], undefined, 0);
	const unsub = s.subscribe(() => undefined);
	return { s, unsub };
}

describe("baseline / state.set() + subscriber", () => {
	const { s, unsub } = setupStateWithSubscriber(baselineNode);
	let i = 0;
	bench("baseline_state_set_sub", () => {
		s.pushExternal(i++);
	});
	afterAll(() => unsub());
});

describe("r8 / state.set() + subscriber", () => {
	const { s, unsub } = setupStateWithSubscriber(r8Node);
	let i = 0;
	bench("r8_state_set_sub", () => {
		s.pushExternal(i++);
	});
	afterAll(() => unsub());
});

// ─── derived: single-dep ──────────────────────────────────────────

function setupDerivedSingle(make: Make) {
	const a = make<number>([], undefined, 0);
	const d = make<number>([a], (batchData, actions, ctx) => {
		const v = lastOrPrev(0)(batchData, ctx);
		(actions as Actions<number>).emit(v * 2);
	});
	const unsub = d.subscribe(() => undefined);
	return { a, d, unsub };
}

describe("baseline / derived single-dep", () => {
	const { a, unsub } = setupDerivedSingle(baselineNode);
	let i = 0;
	bench("baseline_derived_1dep", () => {
		a.pushExternal(i++);
	});
	afterAll(() => unsub());
});

describe("r8 / derived single-dep", () => {
	const { a, unsub } = setupDerivedSingle(r8Node);
	let i = 0;
	bench("r8_derived_1dep", () => {
		a.pushExternal(i++);
	});
	afterAll(() => unsub());
});

// ─── derived: multi-dep (2) ───────────────────────────────────────

function setupDerivedMulti(make: Make) {
	const a = make<number>([], undefined, 0);
	const b = make<number>([], undefined, 0);
	const d = make<number>(
		[a as TinyNode<unknown>, b as TinyNode<unknown>],
		(batchData, actions, ctx) => {
			const x = lastOrPrev(0)(batchData, ctx);
			const y = lastOrPrev(1)(batchData, ctx);
			(actions as Actions<number>).emit(x + y);
		},
	);
	const unsub = d.subscribe(() => undefined);
	return { a, b, d, unsub };
}

describe("baseline / derived multi-dep", () => {
	const { a, unsub } = setupDerivedMulti(baselineNode);
	let i = 0;
	bench("baseline_derived_2dep", () => {
		a.pushExternal(i++);
	});
	afterAll(() => unsub());
});

describe("r8 / derived multi-dep", () => {
	const { a, unsub } = setupDerivedMulti(r8Node);
	let i = 0;
	bench("r8_derived_2dep", () => {
		a.pushExternal(i++);
	});
	afterAll(() => unsub());
});

// ─── diamond: A → B, C → D ────────────────────────────────────────

function setupDiamond(make: Make) {
	const a = make<number>([], undefined, 0);
	const b = make<number>([a], (batchData, actions, ctx) => {
		const v = lastOrPrev(0)(batchData, ctx);
		(actions as Actions<number>).emit(v + 1);
	});
	const c = make<number>([a], (batchData, actions, ctx) => {
		const v = lastOrPrev(0)(batchData, ctx);
		(actions as Actions<number>).emit(v * 2);
	});
	const d = make<number>(
		[b as TinyNode<unknown>, c as TinyNode<unknown>],
		(batchData, actions, ctx) => {
			const x = lastOrPrev(0)(batchData, ctx);
			const y = lastOrPrev(1)(batchData, ctx);
			(actions as Actions<number>).emit(x + y);
		},
	);
	const unsub = d.subscribe(() => undefined);
	return { a, unsub };
}

describe("baseline / diamond", () => {
	const { a, unsub } = setupDiamond(baselineNode);
	let i = 0;
	bench("baseline_diamond", () => {
		a.pushExternal(i++);
	});
	afterAll(() => unsub());
});

describe("r8 / diamond", () => {
	const { a, unsub } = setupDiamond(r8Node);
	let i = 0;
	bench("r8_diamond", () => {
		a.pushExternal(i++);
	});
	afterAll(() => unsub());
});

// ─── fan-out: N subscribers ───────────────────────────────────────

function setupFanOut(make: Make, n: number) {
	const s = make<number>([], undefined, 0);
	const unsubs = Array.from({ length: n }, () => s.subscribe(() => undefined));
	return { s, unsubs };
}

for (const n of [10, 100, 1000] as const) {
	describe(`baseline / fan-out ${n}`, () => {
		const { s, unsubs } = setupFanOut(baselineNode, n);
		let i = 0;
		bench(`baseline_fanout_${n}`, () => {
			s.pushExternal(i++);
		});
		afterAll(() => {
			for (const u of unsubs) u();
		});
	});

	describe(`r8 / fan-out ${n}`, () => {
		const { s, unsubs } = setupFanOut(r8Node, n);
		let i = 0;
		bench(`r8_fanout_${n}`, () => {
			s.pushExternal(i++);
		});
		afterAll(() => {
			for (const u of unsubs) u();
		});
	});
}

// ─── chain: 10-deep linear ─────────────────────────────────────────

function setupChain(make: Make, length: number) {
	const head = make<number>([], undefined, 0);
	let cur: TinyNode<number> = head;
	for (let j = 0; j < length; j++) {
		const prev = cur;
		cur = make<number>([prev], (batchData, actions, ctx) => {
			const v = lastOrPrev(0)(batchData, ctx);
			(actions as Actions<number>).emit(v + 1);
		});
	}
	const tail = cur;
	const unsub = tail.subscribe(() => undefined);
	return { head, unsub };
}

for (const len of [5, 10, 20] as const) {
	describe(`baseline / chain ${len}`, () => {
		const { head, unsub } = setupChain(baselineNode, len);
		let i = 0;
		bench(`baseline_chain_${len}`, () => {
			head.pushExternal(i++);
		});
		afterAll(() => unsub());
	});

	describe(`r8 / chain ${len}`, () => {
		const { head, unsub } = setupChain(r8Node, len);
		let i = 0;
		bench(`r8_chain_${len}`, () => {
			head.pushExternal(i++);
		});
		afterAll(() => unsub());
	});
}
