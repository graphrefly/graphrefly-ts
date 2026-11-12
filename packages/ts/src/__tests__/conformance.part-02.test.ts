/**
 * Behavioral conformance — TS arm of ~/src/graphrefly/spec/conformance.jsonl (D24).
 *
 * Each test is the TS adapter for a language-agnostic scenario: it builds the scenario's
 * topology, drives its input wave sequence, and asserts the expected OBSERVABLE wave output.
 *
 * C-1 (cross-graph diamond) is NOT here — it requires the wire bridge (backlog B2). The
 * in-process diamond core it leans on is green in core.test.ts (R-diamond/R-two-phase).
 */

import { describe, expect, it } from "vitest";
import type { NodeFn } from "../index.js";
import { depBatch, depCount, graph } from "../index.js";
import { collect } from "./helpers/collect.js";

const _flush = () => new Promise((r) => setTimeout(r, 0));

// C-15 (R-terminal-settles-dirty / B35): a dep's terminal (COMPLETE/ERROR) releases its
// outstanding in-wave PENDING contribution — the exactly-one-settle invariant — exactly as
// DATA/RESOLVED/INVALIDATE do, so a PENDING-then-terminal-without-DATA dep never strands the
// join node's pending and wedges it. The terminal analogue of the INVALIDATE wedge-guard.

// C-16 (R-pull / R-up-routing / D269): a pull-mode node (NodeOptions.pullId:<Symbol>) is QUIET by
// default — ABSORBS an upstream PENDING without relaying it (the wedge fix), no push-on-subscribe (START
// only). A DEMAND = a cone-routed PULL({pullId, params?}) (demand-if-holder-else-forward-up;
// no node reference): fires EXACTLY ONE delivery (PENDING-before-DATA) then re-quiets (1:1);
// content = pausable mode (true→latest / resumeAll→backlog). A SELF-demand defers via ctx.upNext
// (R-rewire-deferred); an immediate in-fn demand whose delivery loops back is the D37 feedback cycle.
// pullId disambiguates siblings; pullId+pausable:false is rejected.

// C-17 (R-deps-terminal / B42): an ABSORBED error (errorWhenDepsError:false) counts as TERMINAL for
// the completeWhenDepsComplete auto-COMPLETE cascade — order-independent (whichever terminal lands
// last fires it). The COMPLETION analogue of C-15's PENDING-release. NOT hit by the landed catalog
// (rescue/race/sample use completeWhenDepsComplete:false) — a pure latent-wedge fix.
describe("C-17 — absorbed-error dep counts as terminal for auto-COMPLETE (B42 / R-deps-terminal)", () => {
	const fwd: NodeFn = (ctx) => {
		for (let i = 0; i < depCount(ctx); i++) {
			const b = depBatch(ctx, i);
			if (b) for (const v of b) ctx.down([["DATA", v]]);
		}
	};

	it("(a) error-then-complete: C errors (absorbed), then B completes → D auto-COMPLETEs", () => {
		const g = graph();
		const b = g.node<number>([], null); // manual source
		const c = g.node<number>([], null);
		const d = g.node([b, c], fwd, { error: "manual" }); // absorbs C's error, stays live
		collect(d);
		c.error(new Error("boom")); // absorbed; B still live → not yet all-terminal
		expect(d.status.output).not.toBe("completed");
		expect(d.status.output).not.toBe("errored"); // errorWhenDepsError:false → no auto-ERROR
		g.batch(() => {
			b.set(1);
			b.complete();
		}); // B terminal → ALL deps terminal (C errored) → COMPLETE
		expect(d.status.output).toBe("completed");
	});

	it("(b) complete-then-error: B completes, then C errors LAST → D still auto-COMPLETEs (ERROR-arm mirror)", () => {
		const g = graph();
		const b = g.node<number>([], null);
		const c = g.node<number>([], null);
		const d = g.node([b, c], fwd, { error: "manual" });
		collect(d);
		g.batch(() => {
			b.set(1);
			b.complete();
		}); // B terminal; C still live → not yet all-terminal
		expect(d.status.output).not.toBe("completed");
		c.error(new Error("boom")); // C absorbed-error LANDS LAST → all terminal → COMPLETE
		expect(d.status.output).toBe("completed"); // the ERROR-absorbed arm mirrors the COMPLETE arm (B42)
	});

	it("(c) errorWhenDepsError:true (default) auto-ERRORs on a dep error (absorbed path gated off)", () => {
		const g = graph();
		const b = g.node<number>([], null);
		const c = g.node<number>([], null);
		const d = g.node([b, c], fwd); // defaults: errorWhenDepsError:true
		collect(d);
		c.error(new Error("boom")); // auto-cascade → ERROR before any complete-check
		expect(d.status.output).toBe("errored");
	});
});

// C-18 (R-up-routing-diamond / D63): a routed broadcast PULL over a diamond can reach the same
// pull holder through multiple upstream paths, but that holder fires at most once for the wave.

// C-19 (R-undirty-settle-timing / D64): substrate-synthesized undirty RESOLVED from non-fn settle
// arms must use the normal down path, so pause resumeAll and batch timing apply.

// C-20 (R-teardown-terminal-relay / D65): COMPLETE/ERROR seal value output, but they do not block
// a later upstream TEARDOWN needed to unwind downstream lifecycle.

// C-21 (R-rewire-async-live-edge / D66): async ctx objects are allowed to keep the old dep input
// snapshot for reads, but their late up/down emissions target the node's live topology.

// C-22 (R-rewire-batch-boundary / D67): if a node has an uncommitted batched settle slice, an
// external rewire request waits until the batch commits, so the old slice is not overwritten.
