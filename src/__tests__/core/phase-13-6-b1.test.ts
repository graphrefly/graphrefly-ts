/**
 * Phase 13.6.B Batch 1 — verification tests for B1 locks.
 *
 * Sources:
 * - Lock 2.A field — `cfg.equalsThrowPolicy: "rethrow" | "log-and-continue"`
 * - Lock 2.F′ — `cfg.maxFnRerunDepth` + `cfg.maxBatchDrainIterations`
 * - Lock 6.A field — `cfg.pauseBufferMax`
 * - Lock 6.C′ — `dynamicNode` and `autoTrackNode` default `partial: true`
 * - Lock 6.H — INVALIDATE transitions emitting node to "sentinel" (regression
 *   coverage; behavior already landed via DS-13.5.A)
 *
 * Lock-side wiring (read-from-config) is staged for B4/B5; this file only
 * verifies the field surface and the default-flip behavior shipped in B1.
 */

import { describe, expect, it } from "vitest";
import { GraphReFlyConfig } from "../../core/config.js";
import { DATA, DIRTY, INVALIDATE } from "../../core/messages.js";
import { node } from "../../core/node.js";
import { autoTrackNode, dynamicNode } from "../../core/sugar.js";

describe("Phase 13.6.B B1 — config field additions (Locks 2.A, 2.F′, 6.A)", () => {
	it("GraphReFlyConfig exposes maxFnRerunDepth with default 100", () => {
		const cfg = new GraphReFlyConfig({
			onMessage: () => undefined,
			onSubscribe: () => undefined,
		});
		expect(cfg.maxFnRerunDepth).toBe(100);
		cfg.maxFnRerunDepth = 250;
		expect(cfg.maxFnRerunDepth).toBe(250);
	});

	it("GraphReFlyConfig exposes maxBatchDrainIterations with default 1000", () => {
		const cfg = new GraphReFlyConfig({
			onMessage: () => undefined,
			onSubscribe: () => undefined,
		});
		expect(cfg.maxBatchDrainIterations).toBe(1000);
		cfg.maxBatchDrainIterations = 2500;
		expect(cfg.maxBatchDrainIterations).toBe(2500);
	});

	it("GraphReFlyConfig exposes pauseBufferMax with default 10_000", () => {
		const cfg = new GraphReFlyConfig({
			onMessage: () => undefined,
			onSubscribe: () => undefined,
		});
		expect(cfg.pauseBufferMax).toBe(10_000);
		cfg.pauseBufferMax = 500;
		expect(cfg.pauseBufferMax).toBe(500);
	});

	it("GraphReFlyConfig exposes equalsThrowPolicy as 'rethrow' | 'log-and-continue'", () => {
		const cfg = new GraphReFlyConfig({
			onMessage: () => undefined,
			onSubscribe: () => undefined,
		});
		// Default depends on NODE_ENV. Either is valid; only the surface matters
		// for B1. Behavior wiring (Lock 2.A′) is staged for B5.
		expect(["rethrow", "log-and-continue"]).toContain(cfg.equalsThrowPolicy);
		cfg.equalsThrowPolicy = "rethrow";
		expect(cfg.equalsThrowPolicy).toBe("rethrow");
		cfg.equalsThrowPolicy = "log-and-continue";
		expect(cfg.equalsThrowPolicy).toBe("log-and-continue");
	});

	it("config-field setters do NOT trigger freeze (operational, not protocol-shaping)", () => {
		const cfg = new GraphReFlyConfig({
			onMessage: () => undefined,
			onSubscribe: () => undefined,
		});
		// Touch all four operational fields, then assert the registry is still mutable.
		cfg.maxFnRerunDepth = 50;
		cfg.maxBatchDrainIterations = 500;
		cfg.pauseBufferMax = 100;
		cfg.equalsThrowPolicy = "log-and-continue";
		expect(cfg._isFrozen()).toBe(false);
	});
});

describe("Phase 13.6.B B1 — Lock 6.C′ partial:true default flip", () => {
	it("dynamicNode runs fn before all deps have delivered (partial:true default)", () => {
		// Two source deps; only `a` emits before the dynamic fn runs. With
		// partial:true (default), fn fires and `track(b)` returns undefined
		// rather than waiting for b.
		const a = node<number>([], { initial: 1 });
		const b = node<number>([]); // sentinel — never emits DATA in this test
		const seen: Array<{ av: unknown; bv: unknown }> = [];
		const dyn = dynamicNode<{ av: unknown; bv: unknown }>([a, b], (track) => {
			const av = track(a);
			const bv = track(b);
			return { av, bv };
		});
		const unsub = dyn.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as { av: unknown; bv: unknown });
			}
		});
		// First run should have fired despite `b` being sentinel.
		expect(seen.length).toBeGreaterThanOrEqual(1);
		expect(seen[0]?.av).toBe(1);
		expect(seen[0]?.bv).toBeUndefined();
		unsub();
	});

	it("dynamicNode partial:false opt-in still gates on all deps", () => {
		const a = node<number>([], { initial: 1 });
		const b = node<number>([]); // sentinel
		const seen: Array<unknown> = [];
		const dyn = dynamicNode<number>(
			[a, b],
			(track) => (track(a) as number) + ((track(b) as number) ?? 0),
			{ partial: false },
		);
		const unsub = dyn.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1]);
			}
		});
		// fn must NOT have run — `b` never delivered DATA.
		expect(seen.length).toBe(0);
		unsub();
	});

	it("autoTrackNode discovers deps without first-run-gate stall (partial:true default)", () => {
		const a = node<number>([], { initial: 7 });
		const b = node<number>([], { initial: 5 });
		const seen: number[] = [];
		const at = autoTrackNode<number>((track) => (track(a) as number) + (track(b) as number));
		const unsub = at.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as number);
			}
		});
		// After discovery convergence, fn should produce 12.
		expect(seen).toContain(12);
		unsub();
	});
});

describe("Phase 13.6.B B1 — Lock 6.H regression: INVALIDATE leaves emitter in 'sentinel'", () => {
	it("INVALIDATE on a node with cache resets status to 'sentinel', not 'dirty'", () => {
		const s = node<number>([], { initial: 42 });
		expect(s.cache).toBe(42);
		expect(s.status).toBe("settled");
		// Keepalive subscriber so the node stays mounted across INVALIDATE.
		const unsub = s.subscribe(() => undefined);
		s.down([[INVALIDATE]]);
		expect(s.cache).toBeUndefined();
		expect(s.status).toBe("sentinel");
		unsub();
	});

	it("late subscribers after INVALIDATE see [START] (no phantom DIRTY)", () => {
		const s = node<number>([], { initial: 42 });
		const keepalive = s.subscribe(() => undefined);
		s.down([[INVALIDATE]]);
		// Status is "sentinel" + cache undefined → push-on-subscribe must NOT
		// emit DIRTY (that's the regression Lock 6.H guards against).
		const lateSeen: symbol[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) lateSeen.push(m[0] as symbol);
		});
		expect(lateSeen).not.toContain(DIRTY);
		lateUnsub();
		keepalive();
	});
});
