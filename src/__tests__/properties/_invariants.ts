/**
 * Protocol invariant registry — all 9 invariants from
 * `archive/docs/SESSION-rigor-infrastructure-plan.md` § "Project 1".
 *
 * Each entry is a self-contained property the harness runs via fast-check.
 * The registry shape is the **LLM-readable contract surface**: an LLM (or a
 * future scorecard generator) can enumerate `INVARIANTS` to discover what the
 * substrate guarantees, without reading any operator code.
 *
 * Companion TLA+ spec at `~/src/graphrefly/formal/wave_protocol.tla` encodes
 * the first 6 (protocol-layer) invariants for exhaustive model checking by
 * TLC. Invariants 7–9 target the subscribe lifecycle (START handshake,
 * throw recovery, unsub-reentry), which the TLA+ model doesn't currently
 * model — they live only in the fast-check harness. Counter-examples from
 * TLC port directly into new `Invariant` entries here. See
 * `~/src/graphrefly/formal/README.md` for the porting workflow.
 *
 * Adding a new invariant: append a new `Invariant` object below; the iterating
 * test file in `protocol-invariants.test.ts` will pick it up automatically.
 * Names must be unique — enforced at module load.
 */

import * as fc from "fast-check";
import { batch } from "../../core/batch.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	PAUSE,
	RESOLVED,
	RESUME,
	START,
} from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import { derived, effect, state } from "../../core/sugar.js";
import { applyEvent, captureTrace, type Event, eventSequenceArb } from "./_generators.js";

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

export interface Invariant {
	/** kebab-case identifier — used as the vitest test name. Must be unique. */
	readonly name: string;
	/** Human + LLM-readable summary. Single sentence. */
	readonly description: string;
	/** Reference into `~/src/graphrefly/GRAPHREFLY-SPEC.md` (section anchor). */
	readonly specRef: string;
	/** Returns the fast-check property this invariant asserts. */
	readonly property: () => fc.IPropertyWithHooks<unknown>;
	/** fast-check run count override (default 100). */
	readonly numRuns?: number;
	/**
	 * When set, this invariant is **authored ahead of a known substrate gap** —
	 * it encodes the behavior the framework SHOULD guarantee, but the current
	 * implementation does not. The test runner skips these (via `it.skip`) so
	 * CI stays green, but the registry still surfaces them to LLMs and
	 * docs-gen as part of the contract surface.
	 *
	 * Landing the substrate fix is the trigger to flip this to `undefined`
	 * and let the test run — a failing property then means the fix regressed.
	 * The value is the docs/optimizations.md anchor the fix is tracked under.
	 */
	readonly openUntilSubstrateFix?: string;
}

// ---------------------------------------------------------------------------
// Helpers — small predicates over recorded traces
// ---------------------------------------------------------------------------

/** Number of source emits a wave attempts (batch-wave fans out to N attempts). */
function waveAttemptCount(event: Event): number {
	if (event.kind === "emit") return 1;
	if (event.kind === "batch") return event.values.length;
	return 0;
}

/** Capture trace as a list of per-wave segments (one segment per event). */
function captureTracePerWave<T>(
	leaf: Node<T>,
	source: Node<number>,
	events: readonly Event[],
): { initial: symbol[]; perWave: symbol[][] } {
	const initial: symbol[] = [];
	let bucket: symbol[] = initial;
	const unsub = leaf.subscribe((msgs) => {
		for (const msg of msgs as readonly [symbol, unknown?][]) {
			if (msg[0] === START) continue;
			bucket.push(msg[0]);
		}
	});
	const perWave: symbol[][] = [];
	const completed = { value: false };
	for (const e of events) {
		const seg: symbol[] = [];
		bucket = seg;
		perWave.push(seg);
		applyEvent(source, e, completed);
	}
	unsub();
	return { initial, perWave };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * #1 — No DATA without a preceding DIRTY in the same wave.
 *
 * Walks the post-activation trace; tracks `pending = (DIRTY count − settlement count)`.
 * If `pending` ever goes negative, a settlement (DATA/RESOLVED) reached the
 * sink without an outstanding DIRTY — protocol §1.3 invariant 1 violation.
 *
 * Topology: `state → derived(*2) → derived(+1)` (linear chain).
 * Caught by hand audit: Wave 1 `mergeMap` ERROR leak (settlement without DIRTY).
 */
const invariant1: Invariant = {
	name: "no-data-without-dirty",
	description:
		"In any post-activation wave, every DATA/RESOLVED settlement is preceded by an unbalanced DIRTY.",
	specRef: "GRAPHREFLY-SPEC §1.3 invariant 1",
	property: () =>
		fc.property(eventSequenceArb(), (events) => {
			const s = state(0);
			const m = derived([s], ([x]) => (x as number) * 2);
			const leaf = derived([m], ([x]) => (x as number) + 1);
			const trace = captureTrace(leaf, s, events);
			let pending = 0;
			for (let i = trace.activationEnd; i < trace.types.length; i++) {
				const t = trace.types[i];
				if (t === DIRTY) pending += 1;
				else if (t === DATA || t === RESOLVED) {
					pending -= 1;
					if (pending < 0) return false;
				}
				// COMPLETE/ERROR/INVALIDATE don't affect the DIRTY/settlement balance.
			}
			return true;
		}),
};

/**
 * #2 — RESOLVED settles exactly the wave that dirtied it; no leaks across waves.
 *
 * Stronger than #1: at the end of the run, `pending` must be exactly 0. A
 * positive pending means a DIRTY was sent without a follow-up settlement —
 * subscribers permanently believe the value might still change. A negative
 * pending means a settlement arrived without any DIRTY (caught first by #1).
 *
 * Topology: `state → derived` (single-dep, default Object.is equals).
 */
const invariant2: Invariant = {
	name: "resolved-per-wave",
	description:
		"After all events complete, every DIRTY observed at a downstream node has been balanced by exactly one DATA or RESOLVED.",
	specRef: "GRAPHREFLY-SPEC §1.3 invariant 7 (batch drain)",
	property: () =>
		fc.property(eventSequenceArb(), (events) => {
			const s = state(0);
			const leaf = derived([s], ([x]) => x as number);
			const trace = captureTrace(leaf, s, events);
			let pending = 0;
			for (let i = trace.activationEnd; i < trace.types.length; i++) {
				const t = trace.types[i];
				if (t === DIRTY) pending += 1;
				else if (t === DATA || t === RESOLVED) pending -= 1;
			}
			return pending === 0;
		}),
};

/**
 * #3 — Terminal monotonicity: after COMPLETE/ERROR, no further DATA/DIRTY/RESOLVED.
 *
 * The invariant owns its terminal injection: prefix events, then a forced
 * COMPLETE, then suffix events. The forced COMPLETE is always present and
 * always at a known position with driven events after it, so the test
 * always exercises the post-terminal monotonicity path.
 *
 * Topology: `state` (source itself).
 */
const invariant3: Invariant = {
	name: "terminal-monotonicity",
	description:
		"Once COMPLETE or ERROR appears in the trace, no further DIRTY, DATA, or RESOLVED messages may follow.",
	specRef: "GRAPHREFLY-SPEC §1.3 invariant 4 (terminal)",
	property: () =>
		fc.property(
			eventSequenceArb({ maxLen: 4 }),
			eventSequenceArb({ maxLen: 4 }),
			(prefix, suffix) => {
				const sequence: Event[] = [...prefix, { kind: "complete" }, ...suffix];
				const s = state(0);
				const trace = captureTrace(s, s, sequence);
				const terminalIdx = trace.types.findIndex((t) => t === COMPLETE || t === ERROR);
				if (terminalIdx === -1) return false; // forced complete must reach the trace
				for (let i = terminalIdx + 1; i < trace.types.length; i++) {
					const t = trace.types[i];
					if (t === DIRTY || t === DATA || t === RESOLVED) return false;
				}
				return true;
			},
		),
};

/**
 * #4 — Diamond resolution: fan-in converges to at most ONE settlement per
 * source-emit propagation (no glitch where B-path and C-path each fire D
 * independently).
 *
 * Topology: A → B; A → C; D = derived([B, C]). Each source emit on A is
 * one propagation cycle; D may fire at most once per cycle. A `batch` event
 * with K emits fans out to ONE coalesced downstream wave at D (per the
 * per-node emit coalescing fix, 2026-04-17) — so the bound inside a batch
 * is 1. Outside batch, the bound is the count of source-emit attempts in
 * the wave. What the invariant rules out is `D fires 2K times` (one per
 * dep edge).
 */
const invariant4: Invariant = {
	name: "diamond-resolution",
	description:
		"In a diamond topology (two paths fan in to a derived), settlements at the fan-in node are bounded by the count of source-emit attempts in the wave — never 2× per dep edge.",
	specRef: "GRAPHREFLY-SPEC §1.3 invariant 3 (diamond)",
	property: () =>
		fc.property(eventSequenceArb(), (events) => {
			const a = state(0);
			const b = derived([a], ([x]) => x as number);
			const c = derived([a], ([x]) => (x as number) + 1);
			const d = derived([b, c], ([bv, cv]) => (bv as number) + (cv as number));
			const { perWave } = captureTracePerWave(d, a, events);
			for (let i = 0; i < perWave.length; i++) {
				const seg = perWave[i];
				const bound = waveAttemptCount(events[i]);
				let settlements = 0;
				for (const t of seg) if (t === DATA || t === RESOLVED) settlements += 1;
				if (settlements > bound) return false;
			}
			return true;
		}),
};

/**
 * #5 — Equals substitution: a suppressed DATA becomes RESOLVED, never silence.
 *
 * Drives the source. Every emit must produce exactly one settlement (DATA when
 * the value changed, RESOLVED when equals matched). The total settlement count
 * must equal the total emit-attempt count — silent drops would make this fail.
 *
 * Topology: `state` (source itself), default Object.is equals, small value
 * alphabet so equal-value emits are common.
 */
const invariant5: Invariant = {
	name: "equals-substitution",
	description:
		"Every source emit produces exactly one settlement (DATA or RESOLVED) — equality never causes silent drop.",
	specRef: "GRAPHREFLY-SPEC §1.3 invariant 2 (equals)",
	property: () =>
		fc.property(eventSequenceArb(), (events) => {
			const s = state(0);
			const trace = captureTrace(s, s, events);
			let settlements = 0;
			for (let i = trace.activationEnd; i < trace.types.length; i++) {
				const t = trace.types[i];
				if (t === DATA || t === RESOLVED) settlements += 1;
			}
			const expected = events.reduce((n, e) => n + waveAttemptCount(e), 0);
			return settlements === expected;
		}),
};

/**
 * #6 — Version counter per-emit correctness: `advanceVersion` fires exactly
 * once per observable cache change, and never on RESOLVED.
 *
 * After each event, asserts `v.version` advanced by exactly the expected
 * delta (number of value-changing emits in the event). A substrate bug that
 * double-increments on one emit and skips another would be caught here but
 * miss a final-value-only test.
 *
 * Topology: `state(0, { versioning: 0 })`.
 */
const invariant6: Invariant = {
	name: "version-counter-per-emit",
	description:
		"`v.version` advances by exactly the number of value-changing emits in each event; unchanged on RESOLVED.",
	specRef: "GRAPHREFLY-SPEC §7 (versioning)",
	property: () =>
		fc.property(eventSequenceArb(), (events) => {
			const initial = 0;
			const s = state(initial, { versioning: 0 });
			const unsub = s.subscribe(() => {});
			const completed = { value: false };
			let cache = initial;
			try {
				for (const event of events) {
					let expectedDelta = 0;
					let simCache = cache;
					if (event.kind === "emit") {
						if (!Object.is(event.value, simCache)) {
							expectedDelta += 1;
							simCache = event.value;
						}
					} else if (event.kind === "batch") {
						for (const v of event.values) {
							if (!Object.is(v, simCache)) {
								expectedDelta += 1;
								simCache = v;
							}
						}
					}
					const before = s.v?.version ?? 0;
					applyEvent(s, event, completed);
					const after = s.v?.version ?? 0;
					if (after - before !== expectedDelta) return false;
					cache = simCache;
				}
			} finally {
				unsub();
			}
			return true;
		}),
};

/**
 * #7 — START handshake. Per GRAPHREFLY-SPEC §2.2 the very first delivery
 * to a new subscriber starts with exactly `[[START]]` on its own.
 *
 * The remainder of the handshake depends on topology:
 * - **Source with cached value** (`state(v)`): `[[START]]` → `[[DATA, v]]`.
 *   The cached value is pushed directly; no DIRTY precedes it.
 * - **Derived (compute node)**: `[[START]]` → `[[DIRTY]]` → `[[DATA, fn(deps)]]`.
 *   The compute node emits DIRTY first (it doesn't have a cached value at
 *   subscribe time until deps have pushed), then computes and delivers DATA.
 * - **Sentinel** (`node<T>([])`, no initial): just `[[START]]`. No further
 *   push until something sets the cache.
 *
 * Tier-group delivery (§1.3.7) means each entry is its own `sink()` call —
 * START (tier 0) and DATA (tier 3) are always separate batches, and DIRTY
 * (tier 1) sits between them in the derived case.
 *
 * Probed (2026-04-17): `state(42)` → 2 batches; `derived([s], x=>x*2)` →
 * 3 batches with DIRTY in the middle; `node<T>([])` → 1 batch.
 */
const invariant7: Invariant = {
	name: "start-handshake",
	description:
		"First batch is exactly [[START]]. For a cached source the next batch is [[DATA, v]]; for a derived node the sequence is [[START]], [[DIRTY]], [[DATA, fn(deps)]]; for a sentinel only [[START]] is delivered.",
	specRef: "GRAPHREFLY-SPEC §2.2 (push-on-subscribe)",
	property: () =>
		fc.property(
			fc.integer({ min: 0, max: 10 }),
			fc.constantFrom<"source" | "derived" | "derived-multi" | "sentinel">(
				"source",
				"derived",
				"derived-multi",
				"sentinel",
			),
			(cachedValue, kind) => {
				let target: Node<number>;
				let expectedFinal: number;
				if (kind === "source") {
					target = state(cachedValue);
					expectedFinal = cachedValue;
				} else if (kind === "derived") {
					const src = state(cachedValue);
					target = derived([src], ([x]) => (x as number) * 2);
					expectedFinal = cachedValue * 2;
				} else if (kind === "derived-multi") {
					// Multi-dep derived: both deps cached at subscribe time.
					// Per the known "withLatestFrom multi-dep push-on-subscribe"
					// gap (docs/optimizations.md), two-dep activation may emit
					// a RESOLVED from the first-dep first-run gate before the
					// combined DATA. This invariant accepts either of the two
					// valid handshakes: [[START], [DIRTY], [DATA, ...]] (clean)
					// or [[START], [DIRTY], [RESOLVED], [DIRTY], [DATA, ...]]
					// (sequential dep arrival). Any other shape is a violation.
					const s1 = state(cachedValue);
					const s2 = state(cachedValue + 1);
					target = derived([s1, s2], ([a, b]) => (a as number) + (b as number));
					expectedFinal = cachedValue + (cachedValue + 1);
				} else {
					target = node<number>([]);
					expectedFinal = Number.NaN;
				}
				const batches: [symbol, unknown?][][] = [];
				const unsub = target.subscribe((msgs) => {
					batches.push([...(msgs as readonly [symbol, unknown?][])]);
				});
				unsub();
				// Every kind: first batch is exactly [[START]].
				if (batches.length === 0) return false;
				if (batches[0].length !== 1 || batches[0][0][0] !== START) return false;
				if (kind === "sentinel") return batches.length === 1;
				if (kind === "source") {
					// Source: [[START]], [[DATA, cached]].
					if (batches.length !== 2) return false;
					const d = batches[1];
					return d.length === 1 && d[0][0] === DATA && Object.is(d[0][1], cachedValue);
				}
				if (kind === "derived") {
					// Single-dep derived: [[START]], [[DIRTY]], [[DATA, fn(deps)]].
					if (batches.length !== 3) return false;
					if (batches[1].length !== 1 || batches[1][0][0] !== DIRTY) return false;
					const d2 = batches[2];
					return d2.length === 1 && d2[0][0] === DATA && Object.is(d2[0][1], expectedFinal);
				}
				// kind === "derived-multi": tightened 2026-04-23 alongside the
				// first-run gate landing (docs/optimizations.md: Multi-dep
				// push-on-subscribe ordering — RESOLVED). Substrate now
				// guarantees the clean handshake; the previous gap-aware form
				// `[[START], [DIRTY], [RESOLVED], [DIRTY], [DATA]]` was the
				// pre-fix substrate shape and is no longer reachable for sugar
				// `derived` / `effect` with `partial: false` default. #10
				// `multi-dep-initial-pair-clean` is the dedicated guard for
				// this exact shape; #7 now asserts the same clean 3-batch form
				// as the single-dep case, so a regression fails BOTH here and
				// #10 (not only #10).
				if (batches.length !== 3) return false;
				if (batches[1].length !== 1 || batches[1][0][0] !== DIRTY) return false;
				const lastMulti = batches[2];
				if (lastMulti.length !== 1 || lastMulti[0][0] !== DATA) return false;
				return Object.is(lastMulti[0][1], expectedFinal);
			},
		),
};

/**
 * #8 — Throw recovery / state consistency. When a subscriber's callback
 * throws, the node's internal cache/version state remains consistent and
 * matches what it would be in the throw-free world. Subscribers registered
 * **before** the thrower may see partial delivery for a wave where the
 * throw interrupts, but subsequent emits still update state correctly.
 *
 * The plan's original "batch drain atomicity" is weaker than it sounds at
 * runtime: emit() is synchronous and a throwing subscriber does propagate
 * out, potentially leaving later subscribers starved for that wave. This
 * invariant captures what **does** hold: state consistency post-throw.
 *
 * Topology: `state(0)` with a throwing subscriber, observed from outside.
 */
const invariant8: Invariant = {
	name: "throw-recovery-consistency",
	description:
		"A throwing subscriber callback does not corrupt the node's cache or version: after removing the thrower, a fresh emit updates cache and version exactly as if no throw had happened.",
	specRef: "GRAPHREFLY-SPEC §1.3 invariant 7 (batch drain)",
	property: () =>
		fc.property(eventSequenceArb({ maxLen: 6 }), (events) => {
			const s = state(0);
			// Throw only on DIRTY — which never appears during subscribe()'s
			// handshake (START + cached-DATA push), so we safely get past
			// registration. Every real emit produces DIRTY, triggering the throw.
			const uBad = s.subscribe((msgs) => {
				for (const [t] of msgs as readonly [symbol, unknown?][]) {
					if (t === DIRTY) throw new Error("intentional");
				}
			});
			const completed = { value: false };
			for (const event of events) {
				try {
					applyEvent(s, event, completed);
				} catch {
					// Swallow the rethrown subscriber error; we're checking state, not delivery.
				}
			}
			uBad();
			// After removing the thrower, emit one value and check cache advances.
			// Choose a value distinct from current cache to force a real DATA.
			const before = s.cache;
			const fresh = before === 999 ? 1000 : 999;
			s.emit(fresh);
			return s.cache === fresh;
		}),
};

/**
 * #9 — Subscribe/unsubscribe reentry. Unsubscribing from inside a subscribe
 * callback is safe: the act of calling the unsub function during its own
 * callback does not throw, does not leak, and does not disrupt other
 * subscribers' delivery. Subsequent emits still reach non-unsubbed
 * observers with the correct message sequence.
 *
 * Topology: `state(0)` with a self-unsubbing subscriber and an independent
 * observer. Property: observer's message balance still satisfies
 * NoDataWithoutDirty + BalancedWaves after the self-unsub has fired.
 */
const invariant9: Invariant = {
	name: "subscribe-unsubscribe-reentry",
	description:
		"A subscriber calling its own unsub from inside its callback does not throw and does not disrupt delivery to other subscribers.",
	specRef: "GRAPHREFLY-SPEC §2.2 (subscribe lifecycle)",
	property: () =>
		fc.property(
			eventSequenceArb({ maxLen: 6 }),
			fc.nat({ max: 3 }), // unsub after the Nth DATA received
			(events, unsubAfterN) => {
				const s = state(0);
				let dataCount = 0;
				let unsubSelf: (() => void) | null = null;
				let reentryError: unknown = null;
				unsubSelf = s.subscribe((msgs) => {
					for (const [t] of msgs as readonly [symbol, unknown?][]) {
						if (t === DATA) dataCount += 1;
					}
					if (dataCount >= unsubAfterN && unsubSelf) {
						try {
							const u = unsubSelf;
							unsubSelf = null;
							u();
						} catch (err) {
							reentryError = err;
						}
					}
				});
				// Independent observer — must stay uncorrupted.
				const observerTypes: symbol[] = [];
				let observerActivationEnd = 0;
				const uObs = s.subscribe((msgs) => {
					for (const msg of msgs as readonly [symbol, unknown?][]) {
						if (msg[0] === START) continue;
						observerTypes.push(msg[0]);
					}
				});
				observerActivationEnd = observerTypes.length;
				const completed = { value: false };
				for (const e of events) applyEvent(s, e, completed);
				uObs();
				if (unsubSelf) unsubSelf();
				if (reentryError !== null) return false;
				// Balance check on observer's post-activation trace.
				let pending = 0;
				for (let i = observerActivationEnd; i < observerTypes.length; i++) {
					const t = observerTypes[i];
					if (t === DIRTY) pending += 1;
					else if (t === DATA || t === RESOLVED) pending -= 1;
					if (pending < 0) return false;
				}
				return pending === 0;
			},
		),
};

/**
 * #10 — Multi-dep push-on-subscribe initial pair (OPEN, ahead of substrate fix).
 *
 * When a compute node has two already-cached `state()` deps and is subscribed,
 * the handshake should deliver ONE combined initial DATA: `[[START],
 * [DIRTY], [DATA, fn(initA, initB)]]`. Today `_activate` at
 * src/core/node.ts:1002 subscribes deps sequentially — each push-on-subscribe
 * is its own wave — so the actual handshake is
 * `[[START], [DIRTY], [RESOLVED], [DIRTY], [DATA, fn(initA, initB)]]` (fast-
 * check invariant #7 accepts both shapes for that reason).
 *
 * This is the stricter form: the handshake's tier-3 traffic must be EXACTLY
 * `[DATA, fn(initA, initB)]` — no precursor RESOLVED. Driving this green
 * unblocks docs/optimizations.md "Multi-dep push-on-subscribe ordering".
 *
 * Topology: `derived([state(x), state(y)], ([a, b]) => a + b)`.
 */
const invariant10MultiDepInitial: Invariant = {
	name: "multi-dep-initial-pair-clean",
	description:
		"A two-dep derived with two already-cached state deps delivers exactly [[START], [DIRTY], [DATA, fn(initA, initB)]] on first subscribe — no precursor RESOLVED from sequential dep activation.",
	specRef: "GRAPHREFLY-SPEC §2.7 (multi-dep push-on-subscribe)",
	property: () =>
		fc.property(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }), (x, y) => {
			const a = state(x);
			const b = state(y);
			const d = derived([a, b], ([av, bv]) => (av as number) + (bv as number));
			const batches: [symbol, unknown?][][] = [];
			const unsub = d.subscribe((msgs) => {
				batches.push([...(msgs as readonly [symbol, unknown?][])]);
			});
			unsub();
			// Strict shape: exactly 3 sink calls — [START], [DIRTY], [DATA, sum].
			if (batches.length !== 3) return false;
			if (batches[0].length !== 1 || batches[0][0][0] !== START) return false;
			if (batches[1].length !== 1 || batches[1][0][0] !== DIRTY) return false;
			if (batches[2].length !== 1) return false;
			const dataMsg = batches[2][0];
			return dataMsg[0] === DATA && Object.is(dataMsg[1], x + y);
		}),
};

/**
 * #11 — Pause multi-pauser correctness. Multiple controllers can hold
 * independent pause locks on the same node; the node stays paused as long as
 * any lock is held, and `fn` fires exactly once — coalescing the pending wave
 * — on final-lock release. Spec §2.6: "This gives multi-pauser correctness
 * by construction: if controller A and controller B both hold pause locks,
 * releasing A's lock does not resume the node while B still holds its lock."
 *
 * Topology: `state → derived(tracks fn runs)`. Property:
 *   (a) while N locks pause upstream, intermediate releases (k < N-1 out of
 *       N-1 are released) do not cause `fn` to run;
 *   (b) the final lock release runs `fn` exactly once with the latest value.
 *
 * TLA+ mirror: `wave_protocol_pause_MC` — TLC enumerates every interleaving
 * of Pause/Resume across two lockIds and verifies the protocol invariants
 * (TerminalClearsPauseState, BufferImpliesLockedAndResumeAll, etc.) hold.
 */
const invariant11PauseMultiPauser: Invariant = {
	name: "pause-multi-pauser",
	description:
		"Multiple pause locks are tracked independently: releasing one lockId while another is held does not resume; fn fires exactly once with the latest dep values after the final lock releases.",
	specRef: "GRAPHREFLY-SPEC §2.6 (PAUSE/RESUME lock-id)",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 3 }), (numLocks) => {
			const s = state(0);
			let fnRuns = 0;
			const d = derived([s], ([v]) => {
				fnRuns += 1;
				return v as number;
			});
			const unsub = d.subscribe(() => {});
			const runsAfterSubscribe = fnRuns;

			const locks = Array.from({ length: numLocks }, (_, i) => Symbol(`lock-${i}`));
			for (const l of locks) s.down([[PAUSE, l]]);
			s.emit(1); // cache 0 → 1; would trigger d.fn if not paused

			// Release all but the last lock. While any lock held, fn must not fire.
			for (let i = 0; i < numLocks - 1; i++) {
				s.down([[RESUME, locks[i]]]);
			}
			const runsBeforeFinalRelease = fnRuns;

			s.down([[RESUME, locks[numLocks - 1]]]);
			const runsAfterRelease = fnRuns;

			unsub();

			// (a) N-1 partial releases — fn must not have re-run.
			if (runsBeforeFinalRelease !== runsAfterSubscribe) return false;
			// (b) Final release — fn fires exactly once for the coalesced wave.
			if (runsAfterRelease !== runsAfterSubscribe + 1) return false;
			return true;
		}),
};

/**
 * #12 — Nested-drain peer-read consistency (simple topology).
 *
 * A derived `T = derived([A, B])` must never observe a snapshot where one
 * peer's value reflects a wave not yet delivered to `T`. Specifically, if an
 * effect on `B` enters `batch(() => A.emit(newA))` inside its sink callback,
 * the nested drain can force `T`'s dep-0 callback to fire with `newA`
 * BEFORE `B`'s outer sink-delivery loop reaches `T`'s dep-1 — leaving `T`'s
 * B DepRecord holding the PRIOR wave's B value. Any intermediate DATA `T`
 * emits must satisfy: if `a == newA`, then `b == triggerB` (the B value
 * whose sink triggered the nested A.emit). A sighting of `[newA, oldB]`
 * is a peer-read glitch.
 *
 * **Current status (probed 2026-04-23): PASSES on the current substrate.**
 * The `_dirtyDepCount` gate (node.ts `_maybeRunFnOnSettlement`) correctly
 * blocks T's fn from firing during the nested drain while dep-1 is still
 * pending. The documented COMPOSITION-GUIDE §32 / agentLoop bug lives in
 * **compound topologies** (switchMap resubscribe, feedback diamonds) that
 * this simple-topology harness does not model.
 *
 * This invariant ships anyway as a **regression guard**: any future change
 * to `_emit`, `_activate`, or `_maybeRunFnOnSettlement` that breaks the
 * simple-topology case will fail here immediately. Fully unblocking
 * docs/optimizations.md "Nested-drain wave-ordering" requires an
 * additional compound-topology invariant (switchMap-shaped dep re-wire) —
 * tracked separately.
 *
 * Topology: `A = state(0)`, `B = state(0)`, `T = derived([A, B])`, effect
 * on `B` that emits to `A` inside `batch()` when `B` hits `triggerValue`.
 * Subscribe effect before T (puts effect earlier in B's sink snapshot).
 */
const invariant12NestedDrain: Invariant = {
	name: "nested-drain-peer-consistency",
	description:
		"A derived([A, B]) must never observe a peer value from a wave not yet delivered to it. When a sibling sink of B enters batch(() => A.emit(newA)) inside its callback on the B=triggerB wave, every DATA T emits during that outer wave must reflect [newA, triggerB] or [initialA, triggerB] — never [newA, oldB].",
	specRef: "GRAPHREFLY-SPEC §1.3 invariant 2 + COMPOSITION-GUIDE §32",
	property: () =>
		fc.property(
			fc.integer({ min: 1, max: 9 }), // triggerB — B value that gates the nested drain (!= initial 0)
			fc.integer({ min: 100, max: 199 }), // newA — A value emitted from inside the nested batch
			(triggerB, newA) => {
				const a = state(0);
				const b = state(0);
				const tEmits: (readonly [number, number])[] = [];
				const t = derived([a, b], ([av, bv]) => [av as number, bv as number] as const);
				// Sibling sink of B — enters nested batch when B hits triggerB.
				const sibling = effect([b], ([bv]) => {
					if (bv === triggerB) {
						batch(() => a.emit(newA));
					}
				});
				// Order matters: sibling subscribes first, so it precedes T in B's
				// sinks snapshot — the pathological ordering the bug needs.
				const uSibling = sibling.subscribe(() => {});
				const uT = t.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) tEmits.push(m[1] as readonly [number, number]);
					}
				});
				// Single external drive: B.emit(triggerB). Everything else is
				// downstream drain traffic from that one wave (including the
				// nested batch the sibling triggers).
				b.emit(triggerB);
				uT();
				uSibling();
				// Any DATA with a=newA must carry b=triggerB. A sighting of
				// [newA, 0] (initial B) is the peer-read glitch: it means T's
				// fn fired during the nested drain while its B DepRecord still
				// held pre-trigger value. Likewise `[0, triggerB]` (initial A)
				// is fine (outer B wave settling before the nested A arrives).
				for (const [av, bv] of tEmits) {
					if (av === newA && bv !== triggerB) return false;
				}
				// Final cache must also be consistent with both latest values.
				if (t.cache !== undefined) {
					const [av, bv] = t.cache as readonly [number, number];
					if (av !== newA || bv !== triggerB) return false;
				}
				return true;
			},
		),
};

/**
 * #13 — bufferAll replay ordering. In `pausable: "resumeAll"` mode, outgoing
 * tier-3 settlements emitted during a pause window are captured into the
 * node's bufferAll buffer; on final-lock RESUME the buffer drains to
 * subscribers BEFORE the forwarded RESUME message. Spec §2.6 bufferAll:
 * "On final-lock RESUME, the buffered messages are replayed through the
 * node's own `_emit` pipeline BEFORE the RESUME signal is forwarded
 * downstream."
 *
 * Property:
 *   (a) during pause, no tier-3 (DATA/RESOLVED) reaches the subscriber;
 *   (b) on RESUME, the subscriber observes all buffered tier-3 messages
 *       (in order — at least one, since per spec a buffered DATA may
 *       collapse to RESOLVED against current cache) followed by the
 *       RESUME tuple itself — no tier-3 appears after RESUME.
 *
 * TLA+ mirror: `wave_protocol_bufferall_MC` — TLC verifies the per-node
 * structural invariants (BufferImpliesLockedAndResumeAll,
 * BufferHoldsOnlyDeferredTiers) which together with the atomic drain-then-
 * forward in DeliverPauseResume enforce this ordering by construction.
 */
const invariant13BufferAllReplay: Invariant = {
	name: "buffer-all-replay-ordering",
	description:
		"In pausable:'resumeAll' mode, tier-3 settlements emitted during a pause window are buffered and replayed to subscribers BEFORE the forwarded RESUME; no tier-3 message appears after the RESUME that closed the pause window.",
	specRef: "GRAPHREFLY-SPEC §2.6 (bufferAll mode)",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 5 }),
			(values) => {
				const s = node<number>((_actions) => {}, {
					pausable: "resumeAll",
					initial: 0,
					describeKind: "state",
				});
				const trace: symbol[] = [];
				const unsub = s.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						trace.push(m[0]);
					}
				});
				const lock = Symbol("bufferAll");
				s.down([[PAUSE, lock]]);
				const idxPauseRecorded = trace.length;

				for (const v of values) s.emit(v);

				// (a) During pause: tier-3 must NOT appear in trace after the
				// PAUSE was recorded. Substrate synthesizes DIRTY (tier-1, immediate)
				// for each emit, but DATA/RESOLVED is buffered.
				for (let i = idxPauseRecorded; i < trace.length; i++) {
					if (trace[i] === DATA || trace[i] === RESOLVED) return false;
				}

				const idxBeforeResume = trace.length;
				s.down([[RESUME, lock]]);
				unsub();

				// (b) Post-RESUME segment: must contain the RESUME tuple; every
				// DATA/RESOLVED in the post-resume segment must appear before the
				// RESUME (atomic drain-then-forward), never after.
				let resumeIdx = -1;
				for (let i = idxBeforeResume; i < trace.length; i++) {
					if (trace[i] === RESUME) {
						resumeIdx = i;
						break;
					}
				}
				if (resumeIdx === -1) return false; // RESUME must reach subscriber
				for (let i = resumeIdx + 1; i < trace.length; i++) {
					if (trace[i] === DATA || trace[i] === RESOLVED) return false;
				}
				return true;
			},
		),
};

/**
 * #14 — Resubscribe clears pause state (no lock leakage across lifecycles).
 * Spec §2.6 "Teardown": "On TEARDOWN or deactivation, the buffer and lock
 * set are discarded... Resubscribable nodes also clear the lock set on
 * resubscribe so a new lifecycle cannot inherit a lock from a prior one."
 *
 * Without this clearing, a lock held by a disposed controller in lifecycle
 * L1 would survive into L2 and leave the re-subscribed node permanently
 * stuck paused — every subsequent emit would be dropped/buffered with no
 * way to release.
 *
 * Property: after pausing with N locks in L1, emitting (which buffers),
 * terminating without releasing any lock, and re-subscribing to start L2,
 * a fresh emit in L2 produces an observable DATA/RESOLVED at the new
 * subscriber. If pause state leaked, the emit would be buffered with no
 * active RESUME path to drain it.
 *
 * TLA+ mirror: `wave_protocol_resubscribe_MC` — TLC verifies
 * `ResubscribeYieldsCleanState` (pauseLocks/pauseBuffer/dirtyMask/handshake/
 * trace all empty immediately after `Resubscribe` action) and
 * `TerminalClearsPauseState` (non-resubscribable terminal nodes also clear
 * pause state).
 */
const invariant14ResubscribePause: Invariant = {
	name: "resubscribe-clears-pause-state",
	description:
		"On a resubscribable node, pause locks and bufferAll buffer from a terminated lifecycle do not leak into a resubscribe: a fresh emit in the new lifecycle reaches the new subscriber.",
	specRef: "GRAPHREFLY-SPEC §2.6 (Teardown / Resubscribable)",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 3 }), (numLocks) => {
			const s = state(0, {
				pausable: "resumeAll",
				resubscribable: true,
			});

			// Lifecycle 1: subscribe, pause with N locks, emit (buffered),
			// terminate without releasing a single lock. This is the
			// "controller disposed without cleanup" failure mode.
			const u1 = s.subscribe(() => {});
			const locks = Array.from({ length: numLocks }, (_, i) => Symbol(`L1-${i}`));
			for (const l of locks) s.down([[PAUSE, l]]);
			s.emit(99); // buffered, never drained
			s.down([[COMPLETE]]);
			u1();

			// Lifecycle 2: fresh subscribe triggers terminal reset. Any lock
			// that leaked would keep the new lifecycle stuck paused.
			let sawTier3 = false;
			const u2 = s.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA || m[0] === RESOLVED) sawTier3 = true;
				}
			});
			s.emit(42);
			u2();

			// If pause state cleared correctly: emit(42) produces DIRTY + DATA
			// through the pipeline, subscriber sees DATA. If it leaked: the
			// DATA goes into the stale bufferAll buffer and never reaches the
			// subscriber.
			return sawTier3;
		}),
};
// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * The invariant catalog. Order is the canonical reading order; tests run all
 * of them. Append new invariants to the end — name + specRef are stable
 * identifiers downstream tools can rely on.
 */
export const INVARIANTS: readonly Invariant[] = [
	invariant1,
	invariant2,
	invariant3,
	invariant4,
	invariant5,
	invariant6,
	invariant7,
	invariant8,
	invariant9,
	invariant10MultiDepInitial,
	invariant11PauseMultiPauser,
	invariant12NestedDrain,
	invariant13BufferAllReplay,
	invariant14ResubscribePause,
];

// Enforce name uniqueness — the registry doubles as the LLM-readable contract
// surface, and duplicate names would silently corrupt both the vitest test
// list and any downstream enumeration.
{
	const seen = new Set<string>();
	for (const inv of INVARIANTS) {
		if (seen.has(inv.name)) {
			throw new Error(`Duplicate invariant name in registry: ${inv.name}`);
		}
		seen.add(inv.name);
	}
}
