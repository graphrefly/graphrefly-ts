/**
 * R3.6.3 — `g.resourceProfile(opts?) → GraphProfileResult` snapshot-based
 * runtime profile (per-node stats, top-N hotspots, orphan detection).
 *
 * E-iv.4 (D283, cross-track-ledger §1 row): parity scenarios authored
 * FIRST per D196 ("parity scenarios are the consumer pressure signal").
 * The native arm's `Graph` Proxy traps `resourceProfile` to throw loudly
 * per `wrapNativeGraph` in `impls/rust.ts`; every test here is
 * `test.runIf(runIfPureTs)`-gated until `@graphrefly/native`
 * ships a `resource_profile` napi binding (lifts D004's R3.6.3 deferral
 * in `graphrefly-rs/docs/porting-deferred.md:1678`).
 *
 * Spec text: `docs/implementation-plan-13.6-canonical-spec.md:984` (R3.6.3 is
 * defined in the post-Phase-13.6.A consolidated canonical-spec document, NOT
 * in the legacy multi-file `~/src/graphrefly/GRAPHREFLY-SPEC.md`).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.6.3 resourceProfile parity — $name", (impl) => {
	// E-iv.4 (D283) — match the D282 `batch-throw-rollback.test.ts:55-58` DRY
	// pattern: factor the gate condition once instead of inlining 4 times.
	const runIfPureTs = impl.name === "pure-ts";

	test.runIf(runIfPureTs)(
		"resourceProfile() reports nodeCount + edgeCount + subgraphCount matching topology",
		async () => {
			const g = new impl.Graph("root");
			const a = await g.state<number>("a", 1);
			const b = await g.state<number>("b", 2);
			// One derived node creates two edges (a→sum, b→sum).
			await g.derived<number>("sum", [a, b], ([aBatch, bBatch]) => {
				const av = (aBatch[aBatch.length - 1] as number) ?? 0;
				const bv = (bBatch[bBatch.length - 1] as number) ?? 0;
				return [av + bv];
			});
			await g.mount("child");

			const profile = await g.resourceProfile();
			expect(profile.nodeCount).toBe(3); // a, b, sum
			expect(profile.edgeCount).toBe(2); // a→sum, b→sum
			expect(profile.subgraphCount).toBe(1); // one mount

			await g.destroy();
		},
	);

	test.runIf(runIfPureTs)(
		"per-node subscriberCount reflects active subscriptions (incl. unsub recovery)",
		async () => {
			const g = new impl.Graph("root");
			const a = await g.state<number>("a", 1);

			// Baseline: no external subscribers.
			let profile = await g.resourceProfile();
			const aBefore = profile.nodes.find((n) => n.path === "a");
			expect(aBefore?.subscriberCount).toBe(0);

			// Attach one sink → count goes up.
			const unsub = await a.subscribe(() => {});
			profile = await g.resourceProfile();
			const aDuring = profile.nodes.find((n) => n.path === "a");
			expect(aDuring?.subscriberCount).toBeGreaterThanOrEqual(1);

			// Unsubscribe → count recovers.
			await unsub();
			profile = await g.resourceProfile();
			const aAfter = profile.nodes.find((n) => n.path === "a");
			expect(aAfter?.subscriberCount).toBe(0);

			await g.destroy();
		},
	);

	test.runIf(runIfPureTs)(
		"orphan detection categorizes idle-derived / idle-producer / orphan-effect",
		async () => {
			const g = new impl.Graph("root");
			const a = await g.state<number>("source", 0);
			// Derived with no external subscribers → idle-derived
			await g.derived<number>("idle_d", [a], ([batch]) => {
				const v = (batch[batch.length - 1] as number) ?? 0;
				return [v + 1];
			});
			// Same — derived with no subscribers
			await g.derived<number>("idle_d2", [a], ([batch]) => {
				const v = (batch[batch.length - 1] as number) ?? 0;
				return [v * 2];
			});

			const profile = await g.resourceProfile();

			// Both derived-without-subscribers should appear as orphans
			// with kind="idle-derived".
			const orphanPaths = new Set(profile.orphans.map((o) => o.path));
			expect(orphanPaths.has("idle_d")).toBe(true);
			expect(orphanPaths.has("idle_d2")).toBe(true);

			const idleD = profile.orphans.find((o) => o.path === "idle_d");
			expect(idleD?.orphanKind).toBe("idle-derived");
			expect(idleD?.isOrphanEffect).toBe(false); // not an effect — derived

			// QA-A3: `source` is a STATE node, and `profile.ts:129-138` only
			// categorizes effect/derived/producer types as orphans by kind
			// (state is excluded by construction — it has no fn to be idle
			// about). Additionally, R2.2.6 lazy-activation means the two
			// idle derived nodes don't actually subscribe to `source` until
			// an external sink attaches downstream — so source's
			// subscriberCount is 0, but it's still NOT an orphan because of
			// the type-based exclusion above. Pin both invariants:
			expect(orphanPaths.has("source")).toBe(false);
			const source = profile.nodes.find((n) => n.path === "source");
			expect(source?.type).toBe("state");
			expect(source?.subscriberCount).toBe(0); // R2.2.6 lazy activation
			expect(source?.orphanKind).toBeNull(); // state is never categorized

			await g.destroy();
		},
	);

	test.runIf(runIfPureTs)("hotspots sorted descending; capped by topN", async () => {
		const g = new impl.Graph("root");
		// Create 5 state nodes; pile up subscribers on one to make a
		// clear winner in bySubscriberCount.
		const nodes = await Promise.all([
			g.state<number>("n0", 0),
			g.state<number>("n1", 1),
			g.state<number>("n2", 2),
			g.state<number>("n3", 3),
			g.state<number>("n4", 4),
		]);
		// n0 gets 3 subscribers; n1 gets 2; rest get 0.
		const unsubs: Array<() => Promise<void>> = [];
		for (let i = 0; i < 3; i++) unsubs.push(await nodes[0]!.subscribe(() => {}));
		for (let i = 0; i < 2; i++) unsubs.push(await nodes[1]!.subscribe(() => {}));

		const profile = await g.resourceProfile({ topN: 2 });

		// topN cap honored
		expect(profile.hotspots.bySubscriberCount.length).toBeLessThanOrEqual(2);
		// Sorted descending (subscriberCount)
		const top = profile.hotspots.bySubscriberCount;
		expect(top[0]!.subscriberCount).toBeGreaterThanOrEqual(top[1]!.subscriberCount);
		// n0 should be #1 (has the most subscribers — 3).
		expect(top[0]!.path).toBe("n0");

		for (const u of unsubs) await u();
		await g.destroy();
	});
});
