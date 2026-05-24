/**
 * R3.1.2 — `g.tagFactory(factory, factoryArgs?)` provenance for
 * `describe({ detail: "spec" })`, snapshot replay, debugging.
 *
 * E-iv.4 (D283, cross-track-ledger §1 row): parity scenarios authored
 * FIRST per D196 ("parity scenarios are the consumer pressure signal").
 * D287 (2026-05-24): runIf gates DROPPED — the paired D285 substrate +
 * D286 napi `/porting-to-rs` slice landed `Graph::tag_factory` on the
 * Rust arm + `BenchGraph::tag_factory` napi + wrapper exposure, lifting
 * D004's R3.1.2 deferral in `graphrefly-rs/docs/porting-deferred.md`.
 *
 * Spec text: `docs/implementation-plan-13.6-canonical-spec.md:768` (R3.1.2 is
 * defined in the post-Phase-13.6.A consolidated canonical-spec document, NOT
 * in the legacy multi-file `~/src/graphrefly/GRAPHREFLY-SPEC.md`).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";
import type { ReactiveDescribeHandle } from "../../impls/types.js";

describe.each(impls)("R3.1.2 tagFactory parity — $name", (impl) => {
	test("tagFactory(factory, args) surfaces factory + factoryArgs at the top of describe()", async () => {
		const g = new impl.Graph("root");
		await g.state<number>("a", 1);
		await g.tagFactory("rateLimiter", { maxBuffer: 10, mode: "shrink" });

		// Static describe() — D267-widened to `T | Promise<T>`; `await`
		// is identity on the pure-ts sync return. Per
		// `packages/pure-ts/src/graph/graph.ts:3508-3509`, `tagFactory`
		// surfaces at the TOP-LEVEL of the describe output as
		// `desc.factory` + `desc.factoryArgs` (NOT under `desc.meta`,
		// which is per-node metadata).
		const desc = (await g.describe()) as { factory?: string; factoryArgs?: unknown };
		expect(desc.factory).toBe("rateLimiter");
		expect(desc.factoryArgs).toEqual({ maxBuffer: 10, mode: "shrink" });

		await g.destroy();
	});

	test("second tagFactory call WITHOUT args clears stale args (QA F8 invariant)", async () => {
		const g = new impl.Graph("root");
		await g.state<number>("a", 1);

		// First call: factory + args
		await g.tagFactory("rateLimiter", { x: 1 });
		let desc = (await g.describe()) as { factory?: string; factoryArgs?: unknown };
		expect(desc.factory).toBe("rateLimiter");
		expect(desc.factoryArgs).toEqual({ x: 1 });

		// Second call: only factory name — args MUST be cleared, not
		// carried over from the first call (otherwise provenance is
		// mismatched: "rateLimiter" paired with `circuitBreaker` args).
		await g.tagFactory("circuitBreaker");
		desc = (await g.describe()) as { factory?: string; factoryArgs?: unknown };
		expect(desc.factory).toBe("circuitBreaker");
		// QA-A2: pin the spread-conditional KEY omission at
		// `graph.ts:3509`, not just the value. `toBeUndefined()` would
		// false-pass if a regression wrote `factoryArgs: undefined`
		// explicitly; `in` check pins the actual omission semantic.
		expect("factoryArgs" in desc).toBe(false);

		await g.destroy();
	});

	test("tagFactory(factory) without factoryArgs does not populate the factoryArgs key", async () => {
		const g = new impl.Graph("root");
		await g.state<number>("a", 1);

		// Cold call (no prior tagFactory) with no args — `factoryArgs`
		// must be omitted entirely, not stored as `undefined`.
		await g.tagFactory("compileSpec");
		const desc = (await g.describe()) as { factory?: string; factoryArgs?: unknown };
		expect(desc.factory).toBe("compileSpec");
		// Spread-conditional on `_factoryArgs !== undefined` at
		// `graph.ts:3509` means the key is omitted entirely (not
		// present with value `undefined`) when no args were passed.
		expect("factoryArgs" in desc).toBe(false);

		await g.destroy();
	});

	test("factory tag persists across describe({reactive:true}) snapshots triggered by other mutations", async () => {
		// PREMISE NOTE: `tagFactory` bumps `_topologyVersion` for SPEC-
		// PERSISTENCE bookkeeping (DS-14.5.A Q1 at `graph.ts:1690-1692`)
		// but explicitly emits NO `TopologyEvent` (see the inline
		// comment at `graph.ts:5868`). The reactive describe handle
		// subscribes to `topology` *events*, not `_topologyVersion`, so
		// `tagFactory` alone does NOT auto-fire a fresh reactive
		// snapshot. The test below verifies what actually IS
		// invariant: a subsequent topology-event (here: adding a
		// state node) triggers a re-snapshot that REFLECTS the prior
		// `tagFactory` tag — i.e. the tag is read fresh from
		// `this._factory` on every describe call, not cached.
		const g = new impl.Graph("root");
		await g.state<number>("a", 1);

		const handle = (await g.describe({ reactive: true })) as ReactiveDescribeHandle;
		const snapshots: Array<{ factory?: string; factoryArgs?: unknown }> = [];
		const unsub = handle.subscribe((s) => {
			snapshots.push(s as { factory?: string; factoryArgs?: unknown });
		});

		// Push-on-subscribe baseline (R3.6.1). No factory yet.
		const initialCount = snapshots.length;
		expect(initialCount).toBeGreaterThanOrEqual(1);
		expect(snapshots[initialCount - 1]!.factory).toBeUndefined();

		// tagFactory alone doesn't trigger reactive describe (no
		// TopologyEvent), but a subsequent state-add will, and that
		// snapshot must carry the factory.
		await g.tagFactory("myFactory", { v: 1 });
		await g.state<number>("b", 2);
		await new Promise((r) => setTimeout(r, 0)); // microtask drain

		expect(snapshots.length).toBeGreaterThan(initialCount);
		const latest = snapshots[snapshots.length - 1]!;
		expect(latest.factory).toBe("myFactory");
		expect(latest.factoryArgs).toEqual({ v: 1 });

		unsub();
		await handle.dispose();
		await g.destroy();
	});
});
