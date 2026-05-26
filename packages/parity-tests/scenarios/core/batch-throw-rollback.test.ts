/**
 * D282 — Throw-during-batch subscriber atomicity.
 *
 * **R4.3.2 — Throw rollback** (canonical spec at
 * `docs/implementation-plan-13.6-canonical-spec.md:1183`):
 *
 *   > If `fn` throws during the outermost batch frame: per-node flush hooks
 *   > fire (so nodes clear their pending state), all drainPhase queues are
 *   > cleared, throw re-propagates. **Inner batches inside flushInProgress
 *   > skip rollback** (cross-language decision A4).
 *
 * **D288 Path D + D289 + D290 (paired TS slice, 2026-05-25).**
 * `Impl.batch(fn)` widened to `(fn: (ctx: BatchCtx) => void): Promise<void>`;
 * scenarios use `ctx.down(node, msg)` instead of the substrate-private
 * `(node.inner as { down }).down([msg])` reach-through. The rust arm wires
 * `BenchCore.openBatch()` → `BenchBatchContext` (D289 napi); the pure-ts
 * arm wraps `legacy.batch` with a thin ctx adapter (D288 Q5 lock —
 * substrate API unchanged).
 *
 * Per the cross-track-ledger §1 D282 row (TS converges to Rust): the Rust
 * substrate is pre-conformant via `discard_wave_cleanup` +
 * `restore_wave_cache_snapshots`
 * (`~/src/graphrefly-rs/crates/graphrefly-core/src/batch.rs:3693`). The
 * TS-arm convergence ships under D282 via a per-node `_preBatchSnapshot`
 * + paired flush/rollback hooks on the `batchHooks` registry in
 * `packages/pure-ts/src/core/batch.ts` + `packages/pure-ts/src/core/node.ts`.
 *
 * **Test-quality lift (C1 anti-pattern #7 mandate):**
 * - Assert FULL subscriber message stream (not just `.cache`).
 * - Diamond topology MUST be an actual diamond: `a → {x, y} → bottom`
 *   (NOT two independent sources collapsed at a consumer).
 * - Cover `partial: false` first-wave-pending consumers, terminal-mid-batch,
 *   equals-absorbed throw, drain-time-nested-batch A4 carve-out, and the
 *   nested-batch sanity invariant (inner rollback leaves outer pending
 *   accumulator intact).
 *
 * **Cross-arm gate.** As of D290 + D291 (2026-05-25):
 * - Cross-arm: Cases 1/2/3/4/5/6/8/9/12 + Case 15b (`post-frame-ctx-throws`
 *   throw-path). Case 5 was lifted by D291 Item 1 (graphrefly-rs substrate
 *   `wave_terminal_snapshots` rollback fix).
 * - Still `runIf(impl.name === "pure-ts")`: Cases 7/10/10b/11/13/14
 *   (reach into substrate-private API the parity `Impl` contract does NOT
 *   surface — each `runIf` has an inline comment naming the deferred
 *   widening that would lift it) + Case 15a (`post-frame-ctx-throws`
 *   success-path — blocked by libuv-sync-commit deadlock; lifts under D292
 *   async-commit slice; see Case 15a comment block for details).
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";
import type { BatchCtx, ImplNode } from "../../impls/types.js";

// Pure-ts-arm-only construction shortcuts for tests that need substrate
// surface NOT exposed on the `Impl` parity contract (`versioning` opt,
// substrate-side `batch` for inline-sync nested calls). These tests are
// already `runIf(impl.name === "pure-ts")`-gated; the dynamic import keeps
// the native arm from loading legacy.
async function loadLegacyForPureTsOnly(): Promise<{
	node: typeof import("@graphrefly/pure-ts").node;
	batch: typeof import("@graphrefly/pure-ts").batch;
}> {
	const legacy = await import("@graphrefly/pure-ts");
	return { node: legacy.node, batch: legacy.batch };
}

describe.each(impls)("D282 R4.3.2 batch-throw rollback parity — $name", (impl) => {
	const runIfPureTs = impl.name === "pure-ts";

	// ── Case 1 — bare source throw: no subscriber delivery, cache stays sentinel ──
	test("throw on a fresh sentinel source: subscriber wave is empty, cache stays sentinel", async () => {
		const src = await impl.node<number>([], { name: "src" });

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await src.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		try {
			// Subscribe handshake delivers `[START]` only (sentinel cache).
			expect(seen.find(([t]) => t === impl.DATA)).toBeUndefined();
			seen.length = 0;

			await expect(
				impl.batch((ctx) => {
					ctx.down(src, [impl.DATA, 42]);
					throw new Error("boom");
				}),
			).rejects.toThrow(/boom/);

			// FULL subscriber stream: empty. No DIRTY, no DATA, nothing.
			expect(seen).toEqual([]);
			// Cache reverts to pre-batch sentinel.
			expect(src.cache).toBeUndefined();
		} finally {
			await unsub();
		}
	});

	// ── Case 2 — source with pre-batch DATA: cache reverts to pre-batch value ──
	test("throw on a settled source: subscriber wave is empty mid-batch, cache reverts to pre-batch value", async () => {
		const src = await impl.node<number>([], { initial: 10, name: "src" });

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await src.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		try {
			// Subscribe handshake delivered `[START, DATA(10)]`.
			expect(seen.some(([t, v]) => t === impl.DATA && v === 10)).toBe(true);
			seen.length = 0;

			await expect(
				impl.batch((ctx) => {
					ctx.down(src, [impl.DATA, 99]);
					throw new Error("boom");
				}),
			).rejects.toThrow(/boom/);

			expect(seen).toEqual([]);
			// Cache reverts from 99 (in-batch) → 10 (pre-batch).
			expect(src.cache).toBe(10);
		} finally {
			await unsub();
		}
	});

	// ── Case 3 — real diamond a → {x, y} → bottom, full subscriber stream ──
	test("real diamond (a→{x,y}→bottom) rollback: bottom subscriber stream is empty, no fn re-run", async () => {
		const a = await impl.node<number>([], { initial: 1, name: "a" });
		const x = await impl.map(a, (n: number) => n + 1); // a=1 → x=2
		const y = await impl.map(a, (n: number) => n + 10); // a=1 → y=11

		// `bottom` reads from BOTH x and y — the diamond's narrow tip.
		// A diamond by definition has ONE upstream node fan-out into
		// two branches that fan back in.
		const bottom = await impl.combine<number>([x, y]);

		const bSeen: Array<readonly [symbol, unknown]> = [];
		const unsub = await bottom.subscribe((msgs) => {
			for (const m of msgs) bSeen.push([m[0] as symbol, m[1]]);
		});
		try {
			// Initial cascade: bottom.cache = [2, 11].
			const initialData = bSeen.find(([t]) => t === impl.DATA);
			expect(initialData).toBeDefined();
			expect(initialData?.[1]).toEqual([2, 11]);
			bSeen.length = 0;

			const xCachePre = x.cache;
			const yCachePre = y.cache;
			const bottomCachePre = bottom.cache;

			await expect(
				impl.batch((ctx) => {
					ctx.down(a, [impl.DATA, 100]);
					throw new Error("boom");
				}),
			).rejects.toThrow(/boom/);

			// Bottom's subscriber stream is empty post-batch: no cascade fired.
			expect(bSeen).toEqual([]);
			// x and y were never delivered to (their _onDepMessage never fired),
			// so their caches are untouched.
			expect(x.cache).toBe(xCachePre);
			expect(y.cache).toBe(yCachePre);
			expect(bottom.cache).toEqual(bottomCachePre);
			// a's cache reverts to pre-batch value 1.
			expect(a.cache).toBe(1);
		} finally {
			await unsub();
		}
	});

	// ── Case 4 — partial:false first-wave-pending consumer (closes E3) ──
	test("partial:false consumer post-throw: gate stays held, fn never fires, status not stuck dirty (closes E3)", async () => {
		// Default partial=false: fn doesn't run until every dep has fired DATA at least once.
		// `sentinelDep` is a fresh sentinel state node — it'll hold the gate.
		const sentinelDep = await impl.node<number>([], { name: "sentinel-dep" });
		const src = await impl.node<number>([], { name: "src" });

		let fnRuns = 0;
		const consumer = await impl.combine<number>([sentinelDep, src]);
		// `combine` is partial:false by default — the gate releases only when
		// both deps have fired real DATA. We attach a subscriber that ALSO
		// counts fn-runs indirectly via DATA delivery: if fn never fired,
		// consumer's subscriber sees no DATA.
		const cSeen: Array<readonly [symbol, unknown]> = [];
		const unsub = await consumer.subscribe((msgs) => {
			for (const m of msgs) {
				cSeen.push([m[0] as symbol, m[1]]);
				if (m[0] === impl.DATA) fnRuns++;
			}
		});
		try {
			// Initial: nothing delivered (sentinelDep holds the gate).
			expect(cSeen.find(([t]) => t === impl.DATA)).toBeUndefined();
			cSeen.length = 0;

			await expect(
				impl.batch((ctx) => {
					ctx.down(src, [impl.DATA, 7]);
					throw new Error("boom");
				}),
			).rejects.toThrow(/boom/);

			// FULL stream: empty. Crucially NO DIRTY (closes E3 — pre-fix
			// the consumer received DIRTY+DATA, then on revert was stuck
			// at status="dirty" with INVALIDATE's `_cached===undefined`
			// early-return preventing recovery).
			expect(cSeen).toEqual([]);
			expect(fnRuns).toBe(0);
			expect(consumer.cache).toBeUndefined();

			// AFTER rollback, the consumer is NOT poisoned — wiring up
			// the sentinelDep + re-emitting src works normally.
			cSeen.length = 0;
			await sentinelDep.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 7]]);
			// Both deps have fired → gate releases → consumer emits.
			expect(cSeen.some(([t, v]) => t === impl.DATA && Array.isArray(v))).toBe(true);
			expect(consumer.cache).toEqual([1, 7]);
		} finally {
			await unsub();
		}
	});

	// ── Case 5 — terminal-mid-batch (closes E7 terminal-resurrection) ──
	//
	// **Cross-arm post-D291 (2026-05-25).** graphrefly-rs substrate now
	// snapshots `rec.terminal` slot transitions during a wave and restores
	// them on `BatchGuard::Drop`'s panic-discard path — closes R4.3.2
	// status-snapshot completeness for terminal tiers (COMPLETE/ERROR).
	// `wave_terminal_snapshots` + `wave_dep_terminal_snapshots` track
	// the `None → Some(_)` transitions in `terminate_node` (entry + cascade);
	// `Core::restore_wave_terminal_snapshots` resets the slots and releases
	// any ERROR-tier `TerminalKind::Error(h)` retains lock-released.
	// Pin: `crates/graphrefly-core/tests/d291_terminal_rollback.rs`.
	test("terminal-mid-batch rollback: COMPLETE not delivered, status not stuck completed (closes E7)", async () => {
		const src = await impl.node<number>([], { initial: 5, name: "src" });

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await src.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		try {
			// Skip past handshake DATA(5).
			seen.length = 0;

			await expect(
				impl.batch((ctx) => {
					ctx.down(src, [impl.COMPLETE]);
					throw new Error("boom");
				}),
			).rejects.toThrow(/boom/);

			// FULL stream: empty. No COMPLETE delivered.
			expect(seen).toEqual([]);
			// Source is NOT in terminal state — a follow-up emit must work.
			await src.down([[impl.DATA, 6]]);
			expect(src.cache).toBe(6);
			expect(seen.some(([t, v]) => t === impl.DATA && v === 6)).toBe(true);
		} finally {
			await unsub();
		}
	});

	// ── Case 6 — equals-absorbed throw (closes E15) ──
	test("equals-absorbed throw: subscriber stream empty, status reverts to pre-batch (closes E15)", async () => {
		// Default equals is Object.is. Emitting the same value triggers
		// the equals-absorbed RESOLVED rewrite in _updateState.
		const src = await impl.node<number>([], { initial: 42, name: "src" });

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await src.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		try {
			seen.length = 0;

			await expect(
				impl.batch((ctx) => {
					// Same value as cache → equals-absorbed to RESOLVED in _updateState.
					ctx.down(src, [impl.DATA, 42]);
					throw new Error("boom");
				}),
			).rejects.toThrow(/boom/);

			// FULL stream: empty (no RESOLVED either — nothing dispatched).
			expect(seen).toEqual([]);
			// Cache unchanged (was 42, batch wrote 42, rollback restores 42).
			expect(src.cache).toBe(42);

			// Re-emit a genuinely different value to verify the node is
			// not in a corrupt status="resolved" state with version skew.
			await src.down([[impl.DATA, 43]]);
			expect(src.cache).toBe(43);
			expect(seen.some(([t, v]) => t === impl.DATA && v === 43)).toBe(true);
		} finally {
			await unsub();
		}
	});

	// ── Case 7 — drain-time-nested-batch A4 carve-out ──
	//
	// **Stays `runIf(pure-ts)`:** uses pure-ts substrate-private
	// `legacy.batch` *inside* a subscribe sink so the inner batch fires
	// while `flushInProgress=true`. The native arm's `impl.batch` is the
	// public surface only — there is no public napi for "sync substrate
	// batch from inside a TSFN sink". Lifting would require either a
	// new `Impl.legacyBatch` surface (D196 deferred — no consumer
	// pressure outside this scenario) or a substrate-level A4 cross-
	// arm regression in `graphrefly-rs` instead.
	test.runIf(runIfPureTs)(
		"A4 carve-out: throw inside a nested batch FIRED FROM A DRAIN sink does NOT rollback (inner mutations commit)",
		async () => {
			// Wiring: an OUTER `batch()` defers `outer`'s emission so its
			// sink fires from INSIDE the substrate's drain (flushInProgress=true).
			// The sink then runs an INNER `batch()` that throws — per A4 the
			// inner-throw under flushInProgress SKIPS rollback, and `other`'s
			// pending state flushes when the outer drain's batchHook loop picks
			// up its registered flush hook. Both inner batches use the sync
			// substrate `legacy.batch` so the throw catch happens INSIDE the
			// drain (the async `impl.batch` wrapper turns the throw into a
			// Promise rejection, which would defer the catch to a microtask
			// AFTER the drain has finished — losing the flushInProgress=true
			// context the A4 carve-out is conditioned on).
			const { batch: legacyBatch } = await loadLegacyForPureTsOnly();

			const outer = await impl.node<number>([], { name: "outer" });
			const other = await impl.node<number>([], { name: "other" });

			const otherSeen: Array<readonly [symbol, unknown]> = [];
			const unsubOther = await other.subscribe((msgs) => {
				for (const m of msgs) otherSeen.push([m[0] as symbol, m[1]]);
			});

			let outerSinkFired = false;
			let innerBatchAttempts = 0;
			let innerBatchSyncReturned = false;
			const unsubOuter = await outer.subscribe((msgs) => {
				if (outerSinkFired) return;
				// Only fire on a DATA-bearing wave — the subscribe handshake
				// delivers `[START]` only (no DATA) on a sentinel source, and
				// we don't want the inner batch to run at subscribe-time
				// (that would trigger rollback because flushInProgress=false
				// at handshake — the substrate is dispatching the handshake
				// sync, NOT inside a drain).
				if (!msgs.some((m) => m[0] === impl.DATA)) return;
				outerSinkFired = true;
				innerBatchAttempts++;
				// Fired from inside the outer drain → flushInProgress=true.
				// Per A4: this inner batch's throw skips rollback. We catch
				// inline so the throw doesn't propagate out of the sink.
				//
				// /qa F9: spy-counter isolation. `innerBatchAttempts` proves
				// the inner batch's throw path WAS exercised (not silently
				// no-op'd by the runtime). If A4 were broken and rollback
				// fired, `other` would not be in `batchHooks` for the outer
				// drain to flush — `other.cache` would be `undefined` and
				// the test would fail at the cache assertion. The combined
				// signals (attempts ≥ 1 + other.cache === 99) lock the A4
				// carve-out mechanism, not just the observable outcome.
				try {
					legacyBatch(() => {
						(other.inner as { down(msgs: ReadonlyArray<readonly unknown[]>): void }).down([
							[impl.DATA, 99],
						]);
						throw new Error("inner-boom");
					});
					innerBatchSyncReturned = true; // unreachable — should throw
				} catch {
					/* expected — A4 re-propagates without rollback */
				}
			});

			try {
				otherSeen.length = 0;
				// Outer `impl.batch` defers the emit → drain → sink → inner
				// batch throws while flushInProgress=true. A4 commits.
				await impl.batch((ctx) => {
					ctx.down(outer, [impl.DATA, 1]);
				});

				// A4 carve-out: other received DATA(99). NOT rolled back.
				// /qa F9: spy-counter assertions prove the carve-out is the
				// reason for the pass (not a false-positive).
				expect(innerBatchAttempts).toBe(1); // inner legacyBatch was invoked
				expect(innerBatchSyncReturned).toBe(false); // and DID throw (caught inline)
				const otherData = otherSeen.find(([t]) => t === impl.DATA);
				expect(otherData).toBeDefined();
				expect(otherData?.[1]).toBe(99);
				expect(other.cache).toBe(99);
			} finally {
				await unsubOuter();
				await unsubOther();
			}
		},
	);

	// ── Case 8 — user-throw vs equals-managed-ERROR coexistence ──
	//
	// On the **pure-ts arm** this case exercises the unique mechanism:
	// `equals` throws → substrate emits a managed ERROR via the recursive
	// `_emit`; the user fn ALSO throws AFTER triggering the equals-throw;
	// the outer batch's rollback path STILL fires (rollback isn't
	// suppressed by the equals-side ERROR being queued).
	//
	// On the **native arm** the `equals: () => { throw … }` opt is NOT on
	// the `Impl.node` contract (`opts?: { initial, name, resubscribable }`
	// only — Q4-locked narrow shape). The native arm's wrapper.js silently
	// drops the unsupported `equals` field; the equals-bang mechanism does
	// NOT fire there. Case 8 on the native arm reduces to a basic
	// user-throw rollback (already covered by Case 1/2/12); the test still
	// passes because every assertion is about rollback invariants, not
	// about the equals-side mechanism. **Lifting the equals-specific
	// mechanism cross-arm would require widening `Impl.node` opts with
	// `equals` (D196 deferred — no scenario consumer pressure outside
	// this one).**
	test("user-thrown after equals-throw: rollback fires (the substrate ERROR doesn't suppress user-throw rollback)", async () => {
		// equals throws → substrate emits ERROR via recursive _emit. If the
		// user fn ALSO throws AFTER triggering the equals-throw, the outer
		// batch's rollback path still fires.
		const src = await impl.node<number>([], {
			initial: 42,
			name: "src",
			equals: () => {
				throw new Error("equals-bang");
			},
		} as { initial: number; name: string; equals: (a: number, b: number) => boolean });

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await src.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		try {
			seen.length = 0;

			await expect(
				impl.batch((ctx) => {
					ctx.down(src, [impl.DATA, 99]);
					throw new Error("user-boom");
				}),
			).rejects.toThrow(/user-boom/);

			// Subscriber stream is empty: the user throw rolls back; the
			// substrate's equals-ERROR was queued via recursive _emit but
			// also rolled back as part of the same batch session.
			expect(seen).toEqual([]);
			// Cache reverts to 42 (pre-batch).
			expect(src.cache).toBe(42);
		} finally {
			await unsub();
		}
	});

	// ── Case 9 — re-emit after throw succeeds (no corrupt state) ──
	test("re-emit after throw: node not corrupted, normal wave delivers cleanly", async () => {
		const src = await impl.node<number>([], { initial: 0, name: "src" });

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await src.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		try {
			seen.length = 0;

			await expect(
				impl.batch((ctx) => {
					ctx.down(src, [impl.DATA, 1]);
					throw new Error("boom");
				}),
			).rejects.toThrow(/boom/);

			expect(seen).toEqual([]);
			expect(src.cache).toBe(0);
			seen.length = 0;

			// Re-emit outside batch — wave delivers normally.
			await src.down([[impl.DATA, 2]]);
			const dirtyIdx = seen.findIndex(([t]) => t === impl.DIRTY);
			const dataIdx = seen.findIndex(([t, v]) => t === impl.DATA && v === 2);
			expect(dirtyIdx).toBeGreaterThanOrEqual(0);
			expect(dataIdx).toBeGreaterThanOrEqual(0);
			expect(dirtyIdx).toBeLessThan(dataIdx);
			expect(src.cache).toBe(2);
		} finally {
			await unsub();
		}
	});

	// ── Case 10 — versioning rollback (V0 + V1) ──
	//
	// **Stays `runIf(pure-ts)`:** the `versioning` opt is NOT on
	// `Impl.node` (only `initial/name/resubscribable` per the Q4 narrow-
	// contract lock). Both V0 (version counter) and V1 (cid+prev linked-
	// history) need `versioning: 0 | 1` at node construction. Lifting
	// would require an `Impl.node` widening for `versioning` — R3.2.4
	// `setVersioning` widening is the canonical follow-on (deferred
	// per Phase 14 op-log counter dependency, D283 D004 deferral note).
	test.runIf(runIfPureTs)(
		"versioning V0 rolls back: post-throw version === pre-batch version",
		async () => {
			// The Impl contract doesn't expose `versioning` on `impl.node` opts
			// (the parity contract is intentionally narrow). Build a versioned
			// state node directly via the substrate; subscribe via the impl
			// node's subscribe to keep the wave assertions impl-shape-clean.
			const { node: legacyNode } = await loadLegacyForPureTsOnly();
			const innerSrc = legacyNode<number>([], {
				initial: 0,
				name: "src",
				versioning: 0,
			}) as unknown as {
				cache: number | undefined;
				v: { version: number } | undefined;
				subscribe(cb: (msgs: ReadonlyArray<readonly unknown[]>) => void): () => void;
				down(msgs: ReadonlyArray<readonly unknown[]>): void;
			};

			const unsub = innerSrc.subscribe(() => {});
			try {
				// `Node.v` is the public versioning accessor (a `Readonly<NodeVersionInfo> | undefined`).
				const versionPre = innerSrc.v?.version;
				expect(typeof versionPre).toBe("number");

				await expect(
					impl.batch(() => {
						innerSrc.down([[impl.DATA, 99]]);
						throw new Error("boom");
					}),
				).rejects.toThrow(/boom/);

				// Version reverts to pre-batch.
				expect(innerSrc.v?.version).toBe(versionPre);
				// Re-emit advances version normally — pin "not corrupt".
				innerSrc.down([[impl.DATA, 7]]);
				expect((innerSrc.v?.version ?? 0) > (versionPre ?? 0)).toBe(true);
			} finally {
				unsub();
			}
		},
	);

	// ── Case 10b — V1 versioning cid/prev rollback (/qa F2) ──
	//
	// **Stays `runIf(pure-ts)`:** same `versioning` opt absence as Case 10
	// (V1 = cid+prev linked-history). Would lift with the same
	// `Impl.node` `versioning` widening (R3.2.4 follow-on).
	test.runIf(runIfPureTs)(
		"versioning V1 cid/prev rolls back unconditionally: undefined pre-batch values are restored to undefined post-throw",
		async () => {
			// /qa F2: pre-fix the restore was `if (snap.versioning.cid !== undefined) ...`
			// which would SKIP restoration when the snapshot's `cid` was `undefined`,
			// leaking a mid-batch-set `cid` hash post-rollback. The fix is unconditional
			// restore. This test pins the contract by constructing a V1-versioned node
			// with `cid` set initially, capturing pre-batch `cid`/`prev`, emitting inside
			// batch (which advances `cid` to a new hash), and asserting rollback restores
			// the originals.
			const { node: legacyNode } = await loadLegacyForPureTsOnly();
			const innerSrc = legacyNode<number>([], {
				initial: 0,
				name: "src",
				versioning: 1, // V1 = cid+prev linked-history
			}) as unknown as {
				cache: number | undefined;
				v: { version: number; cid?: string; prev?: string | null } | undefined;
				subscribe(cb: (msgs: ReadonlyArray<readonly unknown[]>) => void): () => void;
				down(msgs: ReadonlyArray<readonly unknown[]>): void;
			};

			const unsub = innerSrc.subscribe(() => {});
			try {
				// V1 starts with `cid` derived from the initial value, `prev` = null.
				const cidPre = innerSrc.v?.cid;
				const prevPre = innerSrc.v?.prev;
				const versionPre = innerSrc.v?.version;
				expect(typeof cidPre).toBe("string");

				await expect(
					impl.batch(() => {
						// Emitting a different value advances cid + sets prev = old cid.
						innerSrc.down([[impl.DATA, 999]]);
						throw new Error("boom");
					}),
				).rejects.toThrow(/boom/);

				// All three V1 fields restored to pre-batch exactly.
				expect(innerSrc.v?.cid).toBe(cidPre);
				expect(innerSrc.v?.prev).toBe(prevPre);
				expect(innerSrc.v?.version).toBe(versionPre);

				// Re-emit normally advances cid (and sets prev = pre-batch cid).
				innerSrc.down([[impl.DATA, 7]]);
				expect(innerSrc.v?.cid).not.toBe(cidPre);
				expect(innerSrc.v?.prev).toBe(cidPre);
			} finally {
				unsub();
			}
		},
	);

	// ── Case 11 — nested-batch sanity (user lock — pins the
	// _batchPendingMessages = null on rollback invariant) ──
	//
	// **Stays `runIf(pure-ts)`:** explicitly nests a synchronous
	// `legacy.batch` *inside* an `impl.batch` body so the inner-batch
	// throw fires at `batchDepth > 0` (the commit-on-outer-success
	// nesting semantic). The native arm has no public sync nested-
	// batch surface; lifting would require an `Impl.legacyBatch` /
	// `Impl.openBatchSync` widening or a `graphrefly-rs`-side cross-
	// arm regression (D196 deferred — no scenario pressure outside
	// this one).
	test.runIf(runIfPureTs)(
		"nested-batch sanity: inner-batch rollback leaves outer-batch pending intact",
		async () => {
			// /qa F10: use the sync substrate `legacy.batch` directly for the
			// inner nesting so the substrate's `batchDepth` semantics are
			// unambiguous at throw-time. Wrapping with `impl.batch`'s async
			// shell works today (the inner `legacy.batch` runs sync before
			// the async wrapper's microtask boundary), but is brittle if
			// `legacy.batch` ever becomes truly async (D080 future).
			const { batch: legacyBatch } = await loadLegacyForPureTsOnly();

			const a = await impl.node<number>([], { initial: 0, name: "a" });
			const b = await impl.node<number>([], { initial: 0, name: "b" });

			const aSeen: Array<readonly [symbol, unknown]> = [];
			const bSeen: Array<readonly [symbol, unknown]> = [];
			const unsubA = await a.subscribe((msgs) => {
				for (const m of msgs) aSeen.push([m[0] as symbol, m[1]]);
			});
			const unsubB = await b.subscribe((msgs) => {
				for (const m of msgs) bSeen.push([m[0] as symbol, m[1]]);
			});
			try {
				aSeen.length = 0;
				bSeen.length = 0;

				// Outer batch emits on `a`. Inside, an inner batch emits on `b`
				// and throws. The inner throw propagates up — but per the nesting
				// invariant, the OUTER batch's accumulator for `a` is intact;
				// when the outer batch finishes (without throwing itself), `a`'s
				// wave flushes normally to its subscribers, while `b`'s wave
				// also flushes (commit-on-outer-success — the inner throw at
				// batchDepth==1 does NOT trigger rollback because the rollback
				// gate is `batchDepth === 0`).
				await impl.batch((ctx) => {
					ctx.down(a, [impl.DATA, 1]);
					try {
						// Inner batch via sync substrate `legacyBatch`. NOT
						// inside a drain (drainPhase queues haven't fired yet
						// at this depth) — outermost rollback semantics apply
						// ONLY when batchDepth==0 in the catch path. The inner
						// batch has batchDepth==2 → 1 on decrement, so the
						// rollback gate does NOT trigger. The inner throw
						// re-propagates without rollback; outer's accumulators
						// (including `a`) stay pending, AND `b`'s accumulator
						// also stays — flushes when the outer succeeds. This
						// is the *commit-on-outer-success* nesting semantic.
						legacyBatch(() => {
							(b.inner as { down(msgs: ReadonlyArray<readonly unknown[]>): void }).down([
								[impl.DATA, 2],
							]);
							throw new Error("inner-boom");
						});
					} catch {
						/* expected — the inner throw doesn't kill the outer batch */
					}
				});

				// `a` delivers (outer batch succeeded; `a`'s pending flushed).
				expect(aSeen.some(([t, v]) => t === impl.DATA && v === 1)).toBe(true);
				expect(a.cache).toBe(1);

				// `b` ALSO delivers — the inner-batch throw with batchDepth>0 on
				// decrement does NOT trigger rollback (rollback gate is the
				// outermost batchDepth==0). This is the documented "commit-on-
				// outer-success" semantic. The OPPOSITE-direction test (outer
				// throws → both `a` AND `b` roll back) is covered by Case 12 below.
				expect(bSeen.some(([t, v]) => t === impl.DATA && v === 2)).toBe(true);
				expect(b.cache).toBe(2);
			} finally {
				await unsubA();
				await unsubB();
			}
		},
	);

	// ── Case 12 — outer throw rolls back both nodes touched ──
	test("outer throw rolls back ALL nodes touched: multi-node atomicity", async () => {
		const a = await impl.node<number>([], { initial: 10, name: "a" });
		const b = await impl.node<number>([], { initial: 20, name: "b" });

		const aSeen: Array<readonly [symbol, unknown]> = [];
		const bSeen: Array<readonly [symbol, unknown]> = [];
		const unsubA = await a.subscribe((msgs) => {
			for (const m of msgs) aSeen.push([m[0] as symbol, m[1]]);
		});
		const unsubB = await b.subscribe((msgs) => {
			for (const m of msgs) bSeen.push([m[0] as symbol, m[1]]);
		});
		try {
			aSeen.length = 0;
			bSeen.length = 0;

			await expect(
				impl.batch((ctx) => {
					ctx.down(a, [impl.DATA, 11]);
					ctx.down(b, [impl.DATA, 22]);
					throw new Error("boom");
				}),
			).rejects.toThrow(/boom/);

			// Multi-node atomicity: BOTH subscriber streams are empty.
			expect(aSeen).toEqual([]);
			expect(bSeen).toEqual([]);
			expect(a.cache).toBe(10);
			expect(b.cache).toBe(20);
		} finally {
			await unsubA();
			await unsubB();
		}
	});

	// ── Case 13 — PAUSE-inside-batch rollback (/qa F3) ──
	//
	// **Stays `runIf(pure-ts)`:** asserts on pure-ts substrate-private
	// `_paused: boolean` + `_pauseLocks: Set<unknown> | null` instance
	// fields (the only way to distinguish "paused-with-buffer" from
	// "paused-without-buffer" cleanly at the substrate level). The
	// native arm's `BenchNode` mirror does not expose these as JS-
	// visible fields. Lifting would require an `Impl.isPaused` /
	// `Impl.pauseLockCount` widening (D196 deferred — no consumer
	// pressure outside this one regression).
	test.runIf(runIfPureTs)(
		"PAUSE-inside-batch rollback: pause locks not phantom-held; node fully usable post-throw",
		async () => {
			// /qa F3: pre-fix the snapshot was captured AFTER the PAUSE/RESUME
			// lock-bookkeeping block in `_emit`, so a `[[PAUSE, lockId]]` inside
			// `batch(fn)` followed by throw would leave the node phantom-paused
			// (locks held, `_paused === true`) while `_cached`/`_status`
			// rewound. The fix hoists snapshot capture to the TOP of `_emit`
			// and adds a pause sub-snapshot. This test pins both invariants:
			// (1) post-rollback the node is NOT paused; (2) a fresh emit
			// delivers normally.
			const { batch: legacyBatch } = await loadLegacyForPureTsOnly();
			const src = await impl.node<number>([], { initial: 5, name: "src" });

			const seen: Array<readonly [symbol, unknown]> = [];
			const unsub = await src.subscribe((msgs) => {
				for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
			});
			try {
				seen.length = 0;

				// Use sync substrate batch so the throw path's batch context
				// is unambiguous. PAUSE inside the batch, then throw.
				expect(() =>
					legacyBatch(() => {
						(src.inner as { down(msgs: ReadonlyArray<readonly unknown[]>): void }).down([
							[impl.PAUSE, "test-lock-id"],
						]);
						(src.inner as { down(msgs: ReadonlyArray<readonly unknown[]>): void }).down([
							[impl.DATA, 99],
						]);
						throw new Error("boom");
					}),
				).toThrow(/boom/);

				// Pause locks rolled back: a fresh emit must deliver normally.
				// If the lock leaked, the next `.down([[DATA, ...]])` would be
				// swallowed (paused state suppresses tier-3 delivery).
				seen.length = 0;
				await src.down([[impl.DATA, 7]]);
				const dirtyIdx = seen.findIndex(([t]) => t === impl.DIRTY);
				const dataIdx = seen.findIndex(([t, v]) => t === impl.DATA && v === 7);
				expect(dirtyIdx).toBeGreaterThanOrEqual(0);
				expect(dataIdx).toBeGreaterThanOrEqual(0);
				expect(src.cache).toBe(7);
				// Inspect the substrate `_paused` field directly to lock the
				// internal invariant (the public `subscribe` path can't
				// distinguish "paused-with-buffer" from "paused-without-buffer"
				// cleanly without scenario-specific buffer setup).
				expect((src.inner as { _paused: boolean })._paused).toBe(false);
				expect((src.inner as { _pauseLocks: Set<unknown> | null })._pauseLocks).toBeNull();
			} finally {
				await unsub();
			}
		},
	);

	// ── Case 14 — TEARDOWN-mid-batch defers _deactivate (/qa F4(c)) ──
	//
	// **Stays `runIf(pure-ts)`:** asserts on pure-ts substrate-private
	// `_cleanup.onDeactivation` callback registry + `_status: string`
	// field (the deferred-vs-fired `_deactivate` mechanism IS the
	// pure-ts substrate's internal invariant — there's no cross-arm
	// public observable for "did `_deactivate` fire?" beyond "did the
	// dep cascade emit cleanly?" which is already covered by other
	// cases). Lifting would require an `Impl.cleanupTracker` /
	// `Impl.statusOf` widening (D196 deferred).
	test.runIf(runIfPureTs)(
		"TEARDOWN-inside-batch deactivation defers to flush: throw keeps deps subscribed, success fires _deactivate",
		async () => {
			// /qa F4(c): pre-fix `_updateState`'s TEARDOWN branch called
			// `_deactivate(skipStatusUpdate=true)` synchronously, which
			// unsubscribes deps + fires `cleanup.onDeactivation` — both
			// irreversible. Rollback restored `_cached`/`_status`/`_teardownDone`
			// but couldn't re-subscribe deps. The fix defers `_deactivate` to
			// flush time so the rollback path discards the deferred deactivation
			// entirely.
			//
			// Two sub-cases:
			// (a) THROW path: TEARDOWN emitted inside batch + throw → deactivation
			//     never fires; the node's `onDeactivation` cleanup is NOT called;
			//     deps remain subscribed (verified via re-emit).
			// (b) SUCCESS path: TEARDOWN emitted inside batch + clean return →
			//     deactivation DOES fire (just deferred); `onDeactivation` cleanup
			//     fires exactly once.
			const { batch: legacyBatch } = await loadLegacyForPureTsOnly();

			// (a) Throw path.
			{
				let deactivationCount = 0;
				const upstream = await impl.node<number>([], { initial: 1, name: "upstream-a" });
				// Build a derived node with cleanup.onDeactivation tracked.
				const derived = await impl.map(upstream, (n: number) => n + 10);
				// Install a cleanup hook directly on the substrate node.
				(
					derived.inner as {
						_cleanup: { onDeactivation?: () => void } | undefined;
					}
				)._cleanup = {
					onDeactivation: () => {
						deactivationCount++;
					},
				};

				const unsub = await derived.subscribe(() => {});
				try {
					expect(derived.cache).toBe(11); // 1 + 10

					expect(() =>
						legacyBatch(() => {
							(derived.inner as { down(msgs: ReadonlyArray<readonly unknown[]>): void }).down([
								[impl.TEARDOWN],
							]);
							throw new Error("boom");
						}),
					).toThrow(/boom/);

					// (a-1) `onDeactivation` did NOT fire (deactivation was
					// deferred + then discarded by rollback).
					expect(deactivationCount).toBe(0);
					// (a-2) Status rolled back from "sentinel" to pre-batch ("settled").
					expect((derived.inner as { _status: string })._status).not.toBe("sentinel");
					// (a-3) Deps still subscribed — re-emit on upstream flows through.
					await upstream.down([[impl.DATA, 42]]);
					expect(derived.cache).toBe(52); // 42 + 10
				} finally {
					await unsub();
				}
			}

			// (b) Success path — same setup, no throw, _deactivate fires.
			{
				let deactivationCount = 0;
				const upstream = await impl.node<number>([], { initial: 1, name: "upstream-b" });
				const derived = await impl.map(upstream, (n: number) => n + 10);
				(
					derived.inner as {
						_cleanup: { onDeactivation?: () => void } | undefined;
					}
				)._cleanup = {
					onDeactivation: () => {
						deactivationCount++;
					},
				};

				const unsub = await derived.subscribe(() => {});
				try {
					expect(derived.cache).toBe(11);

					// Clean batch — TEARDOWN deferred deactivate fires on flush.
					await impl.batch((ctx) => {
						ctx.down(derived, [impl.TEARDOWN]);
					});

					// `onDeactivation` fired exactly once on flush.
					expect(deactivationCount).toBe(1);
					// Status is "sentinel" post-teardown.
					expect((derived.inner as { _status: string })._status).toBe("sentinel");
				} finally {
					await unsub();
				}
			}
		},
	);

	// ── Case 15a — D288 Q3 per-frame lifetime: post-frame (success path) ──
	//
	// **D292 D.2 (2026-05-25): `runIf(pure-ts)` gate LIFTED.** The
	// libuv-sync-commit deadlock that blocked cross-arm verification
	// post-D291 is closed: `BenchBatchContext::commit` + `rollback` are
	// now async napi via `tokio::task::spawn_blocking(move || rx.recv())`
	// (R2 refinement: spawn_blocking, NOT actor.run — D255 α-shape
	// single-worker-per-Core means actor.run would serialize concurrent
	// reads behind the pending commit). `spawn_blocking` moves the
	// blocking wait to tokio's blocking pool — libuv stays free during
	// the actor's sink-fire-via-TSFN drain, so `BatchGuard::Drop`'s
	// success-path `fire_deferred` can reach TSFN-backed JS sinks
	// without deadlock. Sink panics during the drain convert to rejected
	// Promises via the R3 symmetric `catch_unwind` + widened
	// `BatchOp::Commit`/`Rollback` reply (`SyncSender<Result<(), String>>`).
	// Cross-arm regression pin: `crates/graphrefly-bindings-js/src/
	// batch_bindings.rs::tests::d292_async_commit_panic_propagates_as_rejection`.
	test("post-frame ctx.down throws (success path)", async () => {
		// Subscribers are load-bearing on the native arm: the JS-side
		// `cacheValue` mirror is only updated by the subscribe sink's
		// TSFN callback. Without a subscriber, `src.cache` would read
		// the initial value indefinitely (pure-ts reads directly through
		// `node.inner.cache`, so it's always current — the asymmetry is
		// a wrapper-side mirror artifact, NOT a contract violation).
		const src = await impl.node<number>([], { initial: 0, name: "src-15a" });
		const unsub = await src.subscribe(() => {});
		try {
			let stashedCtx: BatchCtx | null = null;
			await impl.batch((ctx) => {
				stashedCtx = ctx;
				ctx.down(src, [impl.DATA, 1]);
			});
			// Frame closed cleanly; src.cache is 1.
			expect(src.cache).toBe(1);
			// Stashed ctx.down(...) must throw the lifetime-contract message.
			const captured = stashedCtx as BatchCtx | null;
			expect(() => {
				(captured as BatchCtx).down(src as ImplNode<number>, [impl.DATA, 2]);
			}).toThrow(/BatchCtx used after batch frame closed/);
		} finally {
			await unsub();
		}
	});

	// ── Case 15b — D288 Q3 per-frame lifetime: post-frame (throw path) ──
	//
	// **Cross-arm.** Rollback path: `BatchGuard::Drop` takes the
	// `std::thread::panicking()` branch → `discard_wave_cleanup` → does
	// NOT fire sinks → does not trip Q2's `DURING_BATCH_HANDLE` tripwire.
	// Both arms cleanly close the batch frame and the stashed `ctx.down`
	// throws "BatchCtx used after batch frame closed".
	test("post-frame ctx.down throws (throw path)", async () => {
		const src = await impl.node<number>([], { initial: 0, name: "src-15b" });
		const unsub = await src.subscribe(() => {});
		try {
			let stashedCtx: BatchCtx | null = null;
			await expect(
				impl.batch((ctx) => {
					stashedCtx = ctx;
					ctx.down(src, [impl.DATA, 99]);
					throw new Error("boom");
				}),
			).rejects.toThrow(/boom/);
			// Rollback fired; src.cache reverts to 0.
			expect(src.cache).toBe(0);
			// Stashed ctx.down(...) must throw the lifetime-contract message
			// (even though the underlying benchCtx already rolled back).
			const captured = stashedCtx as BatchCtx | null;
			expect(() => {
				(captured as BatchCtx).down(src as ImplNode<number>, [impl.DATA, 2]);
			}).toThrow(/BatchCtx used after batch frame closed/);
		} finally {
			await unsub();
		}
	});
});
