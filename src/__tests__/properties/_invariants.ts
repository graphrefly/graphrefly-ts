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
import { vi } from "vitest";
import { batch } from "../../core/batch.js";
import {
	GraphReFlyConfig,
	type NodeCtx,
	type RigorRecorder,
	registerBuiltins,
} from "../../core/config.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	PAUSE,
	RESOLVED,
	RESUME,
	START,
} from "../../core/messages.js";
import { defaultConfig, type Node, node } from "../../core/node.js";
import { derived, effect, producer, state } from "../../core/sugar.js";
import {
	buffer,
	bufferCount,
	bufferTime,
	combine,
	concat,
	concatMap,
	debounce,
	delay,
	distinctUntilChanged,
	elementAt,
	exhaustMap,
	filter,
	find,
	interval,
	last,
	map,
	merge,
	mergeMap,
	pairwise,
	race,
	reduce,
	repeat,
	rescue,
	sample,
	scan,
	skip,
	switchMap,
	take,
	takeUntil,
	takeWhile,
	tap,
	throttle,
	timeout,
	windowCount,
	zip,
} from "../../extra/operators.js";
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
/**
 * #15 — Multi-sink trace convergence (§2.4). Two subscribers on the same
 * node observe the same sequence of post-activation messages.
 *
 * Mirrors TLA+ `MultiSinkTracesConverge`. `_deliverToSinks` at
 * src/core/node.ts:2248 iterates a snapshot of the sinks Set, so each
 * subscriber receives every wave's settlement in order. A regression that
 * dropped deliveries from a later-subscribed sink (or reordered the
 * snapshot) would fail this property.
 *
 * Topology: `state(0)` with two observers; after activation (handshake
 * filtered), the post-activation DATA/RESOLVED/DIRTY sequence at observer A
 * must equal observer B's. COMPOSITION-GUIDE §32-class peer-read bugs at
 * the multi-dep diamond level require a separate topology and are tracked
 * in docs/optimizations.md as a follow-up.
 */
const invariant15MultiSinkConverge: Invariant = {
	name: "multi-sink-trace-convergence",
	description:
		"Two sinks subscribed to the same source node observe the same post-activation sequence of DIRTY/DATA/RESOLVED messages.",
	specRef: "GRAPHREFLY-SPEC §2.4 (node fn contract) + §2.2 (subscribe)",
	property: () =>
		fc.property(eventSequenceArb({ maxLen: 6 }), (events) => {
			// Topology-fragility note: `activationEndA` / `activationEndB` are
			// captured as `seq.length` at the instant `subscribe()` returns.
			// This is correct for a plain `state(0)` where neither sink's
			// subscribe induces side-effect traffic at the other sink. If
			// this invariant ever grows to cover diamond/shared-ancestor
			// topologies, the second subscribe could synthesize activation
			// messages at the first sink via a mutual upstream mount, and
			// length-at-time would understate A's activation by those
			// messages. Anchor on "count of START messages observed" if that
			// regime is exercised.
			const s = state(0);
			const seqA: symbol[] = [];
			const seqB: symbol[] = [];
			const pushOnce = (bucket: symbol[]) => (msgs: readonly [symbol, unknown?][]) => {
				for (const msg of msgs) {
					if (msg[0] === START) continue;
					bucket.push(msg[0]);
				}
			};
			const uA = s.subscribe(pushOnce(seqA));
			const activationEndA = seqA.length;
			const uB = s.subscribe(pushOnce(seqB));
			const activationEndB = seqB.length;
			const completed = { value: false };
			for (const e of events) applyEvent(s, e, completed);
			uA();
			uB();
			const postA = seqA.slice(activationEndA);
			const postB = seqB.slice(activationEndB);
			if (postA.length !== postB.length) return false;
			for (let i = 0; i < postA.length; i++) {
				if (postA[i] !== postB[i]) return false;
			}
			return true;
		}),
};

/**
 * #16 — Up-direction tier guard (§1.4). Calling `node.up(messages)` with a
 * tier-3 (DATA/RESOLVED) or tier-4 (COMPLETE/ERROR) payload throws; tier-1
 * (DIRTY), tier-2 (PAUSE/RESUME), and tier-5 (TEARDOWN) do not throw on a
 * node that has deps.
 *
 * Mirrors TLA+ `UpQueuesCarryControlPlane`. The runtime enforces this at
 * `_validateUpTiers` (src/core/node.ts ~L981). Spec §1.4: "up — upstream
 * from sink toward source (PAUSE, RESUME, INVALIDATE, TEARDOWN)"; §2.2 `up`
 * interface says tier-3/4 throw.
 *
 * Regression guard: any future refactor that drops the tier check would
 * allow DATA/ERROR payloads to flow toward deps, bypassing equals
 * substitution and cache advance — a protocol-invariant violation.
 *
 * Note: TLA+ models the ASPIRATIONAL semantic where `UpPause` at a leaf
 * applies `pauseLocks` at the parent. The current runtime's `up()` only
 * forwards to deps; sources with no deps silently absorb the message. This
 * gap is tracked in docs/optimizations.md as "up-direction PAUSE semantics."
 * This invariant covers the contract the runtime DOES honor today (tier
 * guard + forwarding shape).
 */
const invariant16UpTierGuard: Invariant = {
	name: "up-direction-tier-guard",
	description:
		"Calling `up()` with a tier-3 (DATA/RESOLVED) or tier-4 (COMPLETE/ERROR) payload throws; tier-1/2/5 payloads do not throw on a node with deps.",
	specRef: "GRAPHREFLY-SPEC §1.4 (direction conventions) + §2.2 (up interface)",
	property: () =>
		fc.property(
			fc.constantFrom<"DIRTY" | "PAUSE" | "RESUME" | "DATA" | "RESOLVED" | "COMPLETE" | "ERROR">(
				"DIRTY",
				"PAUSE",
				"RESUME",
				"DATA",
				"RESOLVED",
				"COMPLETE",
				"ERROR",
			),
			(tierName) => {
				const s = state(0);
				const d = derived([s], ([x]) => x as number);
				const unsub = d.subscribe(() => {});
				try {
					// Build the message. PAUSE/RESUME require a lockId payload.
					let thrown = false;
					try {
						if (tierName === "DIRTY") {
							d.up([[DIRTY]]);
						} else if (tierName === "PAUSE") {
							d.up([[PAUSE, Symbol("up-pause")]]);
						} else if (tierName === "RESUME") {
							d.up([[RESUME, Symbol("up-resume")]]);
						} else if (tierName === "DATA") {
							d.up([[DATA, 1]]);
						} else if (tierName === "RESOLVED") {
							d.up([[RESOLVED]]);
						} else if (tierName === "COMPLETE") {
							d.up([[COMPLETE]]);
						} else {
							d.up([[ERROR, new Error("up-error")]]);
						}
					} catch {
						thrown = true;
					}
					const isTier34 =
						tierName === "DATA" ||
						tierName === "RESOLVED" ||
						tierName === "COMPLETE" ||
						tierName === "ERROR";
					return thrown === isTier34;
				} finally {
					unsub();
				}
			},
		),
};

/**
 * #17 — Pausable:false structural + paired negative control (§2.6).
 *
 * Mirrors TLA+ `PausableOffStructural` and strengthens the test beyond a
 * single-mode check. The runtime's `_emit` at src/core/node.ts ~L1953
 * guards lock accumulation behind `this._pausable !== false` — so PAUSE
 * arriving at a `pausable: false` node MUST be ignored, and fn execution
 * MUST continue firing normally (per the spec §2.6 table: "fn fires
 * normally regardless of flow control signals").
 *
 * The test uses a **derived node** whose fn execution is the observable
 * (state sources bypass `_maybeRunFnOnSettlement`'s `_paused` gate — see
 * node.ts:1602 — so pausable:on vs pausable:false at a pure source looks
 * identical to downstream subscribers, which would make a source-level
 * test silently false-positive). A derived node makes the mode matter.
 *
 * Paired property — with the same stimulus topology, flip only the
 * `pausable` option:
 * - `pausable: false`: `down([[PAUSE, lockId]])` on derived → subsequent
 *   source emit triggers fn, DATA reaches subscriber. ✓ contract.
 * - `pausable: true` (default): same stimulus, fn is suppressed via
 *   `_maybeRunFnOnSettlement`'s `_paused` early-return; subscriber sees
 *   NO DATA. ✓ confirms the option actually wires through. If both
 *   branches produced the same observation, the option would be silently
 *   ignored and this test would fail — i.e. it cannot pass for the
 *   "false-positive because the option never reached the runtime" reason.
 */
const invariant17PausableOffStructural: Invariant = {
	name: "pausable-off-structural",
	description:
		"A derived with `pausable: false` delivers DATA after PAUSE (lock ignored); same topology with `pausable: true` does NOT deliver (fn suppressed). The paired check rules out a test passing because the option was silently ignored.",
	specRef: "GRAPHREFLY-SPEC §2.6 (pausable option — false)",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 9 }), (emitVal) => {
			const run = (pausable: boolean): boolean => {
				const s = state(0);
				const d = derived([s], ([x]) => (x as number) * 2, { pausable });
				let sawData = false;
				let dataValue: number | null = null;
				const unsub = d.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) {
							sawData = true;
							dataValue = m[1] as number;
						}
					}
				});
				// After activation-time handshake, hold a PAUSE lock at the
				// derived. Then emit a fresh value upstream. Whether DATA
				// reaches the subscriber depends on `pausable`:
				// - false: lock ignored at _emit's `this._pausable !== false`
				//   guard; fn fires; DATA flows through.
				// - true: lock accumulates, `_paused` becomes true,
				//   `_maybeRunFnOnSettlement` early-returns on `if (this._paused)`.
				d.down([[PAUSE, Symbol("pausable-off-negcontrol")]]);
				sawData = false;
				dataValue = null;
				s.emit(emitVal);
				unsub();
				return sawData && dataValue === emitVal * 2;
			};
			// Contract check (positive): pausable:false → DATA must arrive.
			const positive = run(false);
			// Negative control: pausable:true → DATA must NOT arrive. If both
			// branches deliver DATA, the option was silently ignored and the
			// positive check passed for the wrong reason.
			const negative = !run(true);
			return positive && negative;
		}),
};

// ---------------------------------------------------------------------------
// Operator-layer invariants (added 2026-04-24 batch 9, G)
//
// These test composed-behavior correctness of higher-order operators
// (switchMap / mergeMap / exhaustMap). They differ from the protocol-layer
// invariants above in that they assert LIFECYCLE semantics — which inner
// sources contribute to the downstream trace and which are suppressed —
// rather than raw message ordering. Each invariant picks the narrowest
// topology that exhibits the target property.
//
// These are fast-check-only. TLA+ does not model operator internals; the
// wave-protocol spec stops at the `node` primitive. Operator correctness
// lives at the runtime layer and is tested via property generation over
// outer-source event sequences.
// ---------------------------------------------------------------------------

/**
 * #18 — switchMap: a value emitted into a SUPERSEDED inner source never
 * reaches the downstream trace.
 *
 * Topology: `outer = state`; `sm = switchMap(outer, v => inner_v)` where
 * `inner_v` is the SAME memoised `state` per outer value so we can reach
 * in and emit post-supersession. Drive outer with a strictly-ascending
 * sequence (distinct values); after all outer emits, emit a sentinel
 * value into every inner except the last (currently-active) one. No
 * sentinel may appear in the downstream trace.
 *
 * Catches: "inner subscription not torn down on supersede" — the class
 * flagged in `docs/optimizations.md` under "switchMap-inner teardown
 * hardening for refineExecutor / evalVerifier." A regression that keeps
 * a stale inner subscribed (e.g. forgetting to call `innerUnsub()` on
 * new-outer arrival) would produce sentinel values downstream and trip
 * this invariant.
 */
const invariant18SwitchMapStaleInnerSuppressed: Invariant = {
	name: "switchmap-stale-inner-suppressed",
	description:
		"After switchMap supersedes to a new inner, emits into a prior inner source never reach the downstream trace.",
	specRef: "src/extra/operators.ts:switchMap — supersede-on-outer-emit teardown contract",
	property: () =>
		fc.property(
			fc.uniqueArray(fc.integer({ min: 1, max: 99 }), {
				minLength: 2,
				maxLength: 5,
			}),
			(outerValues) => {
				const outer = state<number>(outerValues[0]);
				const inners = new Map<number, Node<number>>();
				const sm = switchMap(outer as Node<number>, (v: number) => {
					let inner = inners.get(v);
					if (!inner) {
						inner = state<number>(v * 10);
						inners.set(v, inner);
					}
					return inner;
				});
				const dataValues: number[] = [];
				const unsub = sm.subscribe((msgs) => {
					for (const msg of msgs as readonly [symbol, unknown?][]) {
						if (msg[0] === DATA) dataValues.push(msg[1] as number);
					}
				});
				// Drive outer through the remaining distinct values (already seeded
				// at outerValues[0] via state construction — initial subscription
				// pushes through the first inner already).
				for (let i = 1; i < outerValues.length; i++) outer.emit(outerValues[i]);
				const lastOuter = outerValues[outerValues.length - 1];
				const lenBefore = dataValues.length;
				// Emit a unique sentinel into each superseded inner. If teardown
				// worked, none reach the trace; if it didn't, at least one does.
				const SENTINEL = 987654;
				for (const [v, inner] of inners) {
					if (v !== lastOuter) inner.emit(SENTINEL);
				}
				unsub();
				for (let i = lenBefore; i < dataValues.length; i++) {
					if (dataValues[i] === SENTINEL) return false;
				}
				return true;
			},
		),
};

/**
 * #19 — mergeMap: every live inner source's DATA emits reach the downstream
 * trace. No silent drop of non-current inners.
 *
 * Topology: `outer = state`; `mm = mergeMap(outer, v => inner_v)` with
 * memoised inner states per outer value. After driving outer with a
 * distinct sequence, emit a uniquely-tagged sentinel `v * 1000 + k` into
 * inner `v` (for a fresh k). Every emitted sentinel must appear in the
 * downstream trace — any missing one indicates a leaked/unsubscribed
 * inner.
 *
 * Catches: mergeMap inner-tracking regressions. Unlike switchMap which
 * supersedes, mergeMap keeps ALL inners live until each completes; a
 * regression that drops an inner subscription (e.g. clearAll fires
 * erroneously, or innerStops loses an entry) would silently suppress
 * valid DATA and trip this invariant.
 */
const invariant19MergeMapAllInnersContribute: Invariant = {
	name: "mergemap-all-live-inners-contribute",
	description:
		"Every DATA emitted into a live inner source after mergeMap has subscribed to it reaches the downstream trace.",
	specRef: "src/extra/operators.ts:mergeMap — all-inners-forward contract",
	property: () =>
		fc.property(
			fc.uniqueArray(fc.integer({ min: 1, max: 99 }), {
				minLength: 2,
				maxLength: 4,
			}),
			(outerValues) => {
				const outer = state<number>(outerValues[0]);
				const inners = new Map<number, Node<number>>();
				const mm = mergeMap(outer as Node<number>, (v: number) => {
					let inner = inners.get(v);
					if (!inner) {
						inner = state<number>(v * 10);
						inners.set(v, inner);
					}
					return inner;
				});
				const dataValues: number[] = [];
				const unsub = mm.subscribe((msgs) => {
					for (const msg of msgs as readonly [symbol, unknown?][]) {
						if (msg[0] === DATA) dataValues.push(msg[1] as number);
					}
				});
				for (let i = 1; i < outerValues.length; i++) outer.emit(outerValues[i]);
				// Emit a distinct sentinel into each inner. All of them must appear
				// downstream — mergeMap keeps inners live.
				const expectedSentinels: number[] = [];
				for (const [v, inner] of inners) {
					const sentinel = v * 1000 + 7;
					expectedSentinels.push(sentinel);
					inner.emit(sentinel);
				}
				unsub();
				for (const s of expectedSentinels) {
					if (!dataValues.includes(s)) return false;
				}
				return true;
			},
		),
};

/**
 * #20 — exhaustMap: while an inner is active, subsequent outer emits are
 * DROPPED. Only the first outer's inner contributes until that inner
 * completes.
 *
 * Topology: `outer = state`; `em = exhaustMap(outer, v => inner_v)` with
 * memoised inner states per outer value. Drive outer with a distinct
 * sequence. The first value's inner remains uncompleted — so all
 * subsequent outers must NOT have had `project` called on them (no
 * inner created for them). Assert `inners.size === 1` (only the first
 * outer's inner was created).
 *
 * Catches: exhaustMap regression where the drop-while-active gate is
 * bypassed. A broken implementation that spawns inners for every outer
 * emit (mergeMap-style) would create multiple entries in the inners
 * map and trip this invariant.
 */
const invariant20ExhaustMapDropsWhileActive: Invariant = {
	name: "exhaustmap-drops-while-active",
	description:
		"While an exhaustMap inner is active (uncompleted), subsequent outer emits are dropped — no new inner is created for them.",
	specRef: "src/extra/operators.ts:exhaustMap — drop-while-active contract",
	property: () =>
		fc.property(
			fc.uniqueArray(fc.integer({ min: 1, max: 99 }), {
				minLength: 2,
				maxLength: 4,
			}),
			(outerValues) => {
				const outer = state<number>(outerValues[0]);
				const projectCalls: number[] = [];
				const em = exhaustMap(outer as Node<number>, (v: number) => {
					projectCalls.push(v);
					// Inner never completes — it's a long-lived state source.
					return state<number>(v * 10);
				});
				const unsub = em.subscribe(() => {});
				for (let i = 1; i < outerValues.length; i++) outer.emit(outerValues[i]);
				unsub();
				// Only the FIRST outer value's project should have fired; the
				// remaining outers arrived while the first inner was still
				// active and should have been dropped without a project call.
				return projectCalls.length === 1 && projectCalls[0] === outerValues[0];
			},
		),
};

/**
 * #21 — concatMap: `project` is called serially — never for outer N+1 until
 * inner N completes. Queue depth is unbounded (unless `maxBuffer` is set);
 * `project` calls cadence ties to inner completion ordering, not outer
 * arrival ordering.
 *
 * Topology: `outer = state`; `cm = concatMap(outer, v => memoisedInner(v))`
 * with a counter wrapping `project` and a memoised inner state per outer
 * value so we can reach in and drive COMPLETE. Drive outer through a
 * distinct sequence; `project` should only have fired once (for the
 * initial subscription). Then complete each inner in outer-arrival order,
 * asserting that each completion triggers exactly one new `project` call
 * for the next queued outer value.
 *
 * Catches: queue-bypass regressions (e.g. `project` called eagerly on
 * every outer emit), or FIFO-violation (e.g. outer N+2 subscribes before
 * outer N+1 — breaks `tryPump`'s serial contract).
 */
const invariant21ConcatMapSerialSubscription: Invariant = {
	name: "concatmap-serial-inner-subscription",
	description:
		"concatMap calls `project` for outer N+1 only after inner N completes; queued outer emits never trigger concurrent project calls.",
	specRef: "src/extra/operators.ts:concatMap — serialized-subscription contract",
	property: () =>
		fc.property(
			fc.uniqueArray(fc.integer({ min: 1, max: 99 }), {
				minLength: 2,
				maxLength: 4,
			}),
			(outerValues) => {
				const outer = state<number>(outerValues[0]);
				const projectCalls: number[] = [];
				const inners = new Map<number, Node<number>>();
				const cm = concatMap(outer as Node<number>, (v: number) => {
					projectCalls.push(v);
					const inner = state<number>(v * 10);
					inners.set(v, inner);
					return inner;
				});
				const unsub = cm.subscribe(() => {});
				// Initial subscription fires project for outerValues[0].
				if (projectCalls.length !== 1) return false;
				if (projectCalls[0] !== outerValues[0]) return false;

				// Emit remaining outer values — all should queue without firing project.
				for (let i = 1; i < outerValues.length; i++) outer.emit(outerValues[i]);
				if (projectCalls.length !== 1) return false;

				// Complete inners in outer-arrival order; each completion must trigger
				// exactly one new project call for the next queued outer.
				for (let i = 0; i < outerValues.length - 1; i++) {
					const prevInner = inners.get(outerValues[i]);
					if (!prevInner) return false;
					prevInner.down([[COMPLETE]]);
					if (projectCalls.length !== i + 2) return false;
					if (projectCalls[i + 1] !== outerValues[i + 1]) return false;
				}

				unsub();
				return true;
			},
		),
};

/**
 * #22 — mergeMap: `{ concurrent: K }` never permits more than K concurrent
 * inner subscriptions. With K < outerValues.length, outer emits beyond K
 * queue; `project` is not called for them until a prior inner completes.
 *
 * Topology: same memoised-inner-per-outer pattern as #21. Count `project`
 * calls; drive outer through a distinct sequence. After all emits,
 * `project` has been called exactly `min(K, outerValues.length)` times.
 * Then complete inners in order; each completion triggers one new
 * `project` call until all outers have been subscribed.
 *
 * Catches: concurrency-bound bypass (queue.shift not gated on `active <
 * maxConcurrent`), premature queue drain, or the `spawn` / `drainBuffer`
 * counters diverging from actual live subscriptions.
 */
const invariant22MergeMapConcurrencyBound: Invariant = {
	name: "mergemap-concurrency-bound-respected",
	description:
		"mergeMap with `{concurrent: K}` keeps at most K project calls pending; additional outers queue until a prior inner completes.",
	specRef: "src/extra/operators.ts:mergeMap — concurrency bound contract",
	property: () =>
		fc.property(
			fc.uniqueArray(fc.integer({ min: 1, max: 99 }), {
				minLength: 3,
				maxLength: 5,
			}),
			fc.integer({ min: 1, max: 2 }),
			(outerValues, K) => {
				const outer = state<number>(outerValues[0]);
				const projectCalls: number[] = [];
				const inners = new Map<number, Node<number>>();
				const mm = mergeMap(
					outer as Node<number>,
					(v: number) => {
						projectCalls.push(v);
						const inner = state<number>(v * 10);
						inners.set(v, inner);
						return inner;
					},
					{ concurrent: K },
				);
				const unsub = mm.subscribe(() => {});
				// Emit the remaining outers. The first K project calls should have
				// fired (initial + K-1 additional); the rest queue.
				for (let i = 1; i < outerValues.length; i++) outer.emit(outerValues[i]);
				const expectedInitial = Math.min(K, outerValues.length);
				if (projectCalls.length !== expectedInitial) return false;
				// Completed inners should pop one queued outer each.
				for (let i = 0; i < outerValues.length - K; i++) {
					const prevInner = inners.get(outerValues[i]);
					if (!prevInner) return false;
					prevInner.down([[COMPLETE]]);
					const expected = Math.min(K + i + 1, outerValues.length);
					if (projectCalls.length !== expected) return false;
				}
				unsub();
				return true;
			},
		),
};

/**
 * #23 — race: the first source to emit DATA wins; losers' subsequent DATA
 * never reaches the output, and the winner continues forwarding DATA
 * afterwards.
 *
 * Topology: N captured-push `producer<number>` sources (no cached DATA,
 * no push-on-subscribe artifacts). `r = race(...sources)`. After
 * subscribe, `pushers[0]` fires first with a winner tag — that settles
 * the winner index. Then every loser pushes a uniquely-tagged sentinel
 * that MUST NOT reach the trace. Finally `pushers[0]` fires a second
 * winner tag that MUST reach the trace (winner-continues contract).
 *
 * Using producers (not `state` with cached DATA) ensures the winner is
 * selected by the actual first-DATA-arrival semantic race advertises,
 * not by the push-on-subscribe ordering artifact of cached-state
 * sources. A regression that selects winners by subscribe order rather
 * than first-emit would now fail this invariant when we push into
 * sources[0] explicitly first.
 *
 * Catches: winner-lock regressions (e.g. `winner` reset on each batch,
 * or losers re-entering after an unrelated event), short-circuit bypass
 * (a loser forwarding DATA despite `winner !== null`), or winner drop
 * (forwarding only the first winner DATA and suppressing subsequent
 * winner emits).
 */
const invariant23RaceFirstWins: Invariant = {
	name: "race-first-wins-only",
	description:
		"race() forwards DATA only from whichever source emitted DATA first; losers' subsequent DATA never reaches output; the winner continues forwarding its subsequent DATA.",
	specRef: "src/extra/operators.ts:race — first-DATA-wins contract",
	property: () =>
		fc.property(fc.integer({ min: 2, max: 5 }), (sourceCount) => {
			const pushers: Array<((v: number) => void) | undefined> = Array.from(
				{ length: sourceCount },
				() => undefined,
			);
			const sources: Node<number>[] = Array.from({ length: sourceCount }, (_, i) => {
				return producer<number>((a) => {
					pushers[i] = (v) => a.emit(v);
					return () => {
						pushers[i] = undefined;
					};
				}) as Node<number>;
			});
			const r = race(...sources);
			const emitted: number[] = [];
			const unsub = r.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number);
				}
			});
			// Producer sources don't auto-fire on subscribe; push sources[0] first
			// to elect it the winner by explicit first-DATA-arrival order.
			const WINNER_TAG_1 = 77777;
			pushers[0]?.(WINNER_TAG_1);
			// Losers push sentinels — all must be suppressed.
			const LOSER_TAG = 99900;
			for (let i = 1; i < sourceCount; i++) {
				pushers[i]?.(LOSER_TAG + i);
			}
			// Winner pushes a second DATA — must reach output (winner-continues).
			const WINNER_TAG_2 = 77778;
			pushers[0]?.(WINNER_TAG_2);
			unsub();
			for (const v of emitted) {
				if (v >= LOSER_TAG && v < LOSER_TAG + sourceCount) return false;
			}
			return emitted.length === 2 && emitted[0] === WINNER_TAG_1 && emitted[1] === WINNER_TAG_2;
		}),
};

/**
 * #24 — repeat: `repeat(source, N)` emits downstream COMPLETE exactly after
 * the N-th inner COMPLETE — never sooner, never later.
 *
 * Topology: `s = state<number>(0, { resubscribable: true })`;
 * `r = repeat(s, N)`. Drive s through N-1 COMPLETE signals via raw
 * `s.down([[COMPLETE]])`; the outer r MUST NOT have emitted COMPLETE yet
 * (repeat resubscribes and waits for next inner terminal). After the N-th
 * COMPLETE, r MUST emit exactly one downstream COMPLETE.
 *
 * Catches: off-by-one in `remaining` counter, premature downstream
 * COMPLETE (e.g. forwarding the first inner COMPLETE), or over-repeat
 * (e.g. resubscribing after the final COMPLETE).
 */
const invariant24RepeatCountRespected: Invariant = {
	name: "repeat-count-respected",
	description:
		"repeat(source, N) emits downstream COMPLETE exactly after the N-th inner COMPLETE — never sooner, never later.",
	specRef: "src/extra/operators.ts:repeat — count-respecting contract",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 5 }), (N) => {
			const s = state<number>(0, { resubscribable: true });
			const r = repeat(s, N);
			let completes = 0;
			const unsub = r.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === COMPLETE) completes += 1;
				}
			});
			for (let i = 0; i < N - 1; i++) {
				s.down([[COMPLETE]]);
				if (completes !== 0) {
					unsub();
					return false;
				}
			}
			s.down([[COMPLETE]]);
			if (completes !== 1) {
				unsub();
				return false;
			}
			// Post-N COMPLETE leak check: an additional source COMPLETE must NOT
			// re-trigger repeat (`remaining` should have hit 0 and downstream should
			// be terminated). Catches an over-repeat regression that the narrow
			// N-COMPLETE loop would silently pass.
			s.down([[COMPLETE]]);
			unsub();
			return completes === 1;
		}),
};

/**
 * #25 — debounce: `debounce(source, ms)` emits only the LAST value when the
 * source emits rapidly within the ms quiet window; intermediate values
 * are coalesced.
 *
 * Topology: `s = state<number>(0)`; `d = debounce(s, 50)`. Under fake
 * timers, emit each generated value with a 10ms gap (< ms, so each reset
 * keeps the timer alive). No DATA must reach the trace during the burst.
 * After `advanceTimersByTime(60)` (crosses the reset quiet window), the
 * trace must contain exactly one new DATA equal to the LAST value.
 *
 * Catches: coalesce-bypass regressions (emit-per-input), timer-reset
 * drops (failing to `clearTimeout` on each DATA), or pending-value
 * staleness (flushing an earlier value instead of the latest).
 */
const invariant25DebounceCoalesce: Invariant = {
	name: "debounce-coalesces-rapid-emits",
	description:
		"debounce(source, ms) emits exactly one downstream DATA equal to the last rapidly-emitted value when all source emits fall within the ms quiet window.",
	specRef: "src/extra/operators.ts:debounce — coalesce contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 2, maxLength: 6 }),
			(values) => {
				vi.useFakeTimers();
				try {
					// { equals: () => false } on the source prevents Object.is absorption
					// from silently swallowing `[5, 5]`-style shrunk counter-examples at
					// the source before debounce even sees the second emit — otherwise
					// coalescing could appear to work vacuously on any-repeat input.
					const s = state<number>(0, { equals: () => false });
					const d = debounce(s as Node<number>, 50);
					const emitted: number[] = [];
					const unsub = d.subscribe((msgs) => {
						for (const m of msgs as readonly [symbol, unknown?][]) {
							if (m[0] === DATA) emitted.push(m[1] as number);
						}
					});
					for (const v of values) {
						s.emit(v);
						vi.advanceTimersByTime(10);
					}
					// Burst complete: all gaps 10ms < ms=50, so no timer has fired.
					if (emitted.length !== 0) {
						unsub();
						return false;
					}
					vi.advanceTimersByTime(60);
					unsub();
					return emitted.length === 1 && emitted[0] === values[values.length - 1];
				} finally {
					vi.useRealTimers();
				}
			},
		),
	// producer/factory churn under fake timers is tolerable; default 100 runs.
};

/**
 * #26 — timeout: `timeout(source, ms)` emits exactly one ERROR when the
 * source is idle past the ms budget; no DATA or COMPLETE precedes the
 * ERROR.
 *
 * Topology: silent `producer<number>` that never emits, wrapped in
 * `timeout(silent, ms)`. Under fake timers, advance `ms - 1` — no
 * terminal message yet. Advance 2 more — exactly one ERROR, no DATA,
 * no COMPLETE.
 *
 * Catches: watchdog-timer off-by-one, double-ERROR (timer re-firing
 * after emit), or forwarding a spurious DATA/COMPLETE during the
 * timeout cascade.
 */
const invariant26TimeoutErrorsOnIdle: Invariant = {
	name: "timeout-errors-on-idle",
	description:
		"timeout(source, ms) emits exactly one ERROR when the source is idle past the ms budget; no DATA or COMPLETE precedes the ERROR.",
	specRef: "src/extra/operators.ts:timeout — idle-watchdog contract",
	property: () =>
		fc.property(fc.integer({ min: 20, max: 200 }), (ms) => {
			vi.useFakeTimers();
			try {
				const silent = producer<number>(() => {
					return () => {};
				});
				const t = timeout(silent as Node<number>, ms);
				const seen: symbol[] = [];
				const unsub = t.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA || m[0] === COMPLETE || m[0] === ERROR) {
							seen.push(m[0]);
						}
					}
				});
				vi.advanceTimersByTime(ms - 1);
				if (seen.length !== 0) {
					unsub();
					return false;
				}
				vi.advanceTimersByTime(2);
				unsub();
				return seen.length === 1 && seen[0] === ERROR;
			} finally {
				vi.useRealTimers();
			}
		}),
};

/**
 * #27 — throttle (leading-edge, trailing=false): passes the first DATA of a
 * burst immediately and suppresses subsequent DATAs arriving within the
 * same ms window.
 *
 * Topology: `producer<number>` with a captured push fn so the property
 * controls emit timing. `throttle(src, 100, { trailing: false })`.
 * Under fake timers, emit each generated value with a 5ms gap (all
 * within the 100ms window). Only `values[0]` reaches the output.
 *
 * Catches: leading-edge gate bypass (every emit passes), trailing-edge
 * leak (`trailing: false` honored), or `lastEmitNs` reset inside the
 * window.
 */
const invariant27ThrottleLeadingSuppresses: Invariant = {
	name: "throttle-leading-passes-first-suppresses-rest",
	description:
		"Default throttle(source, ms, { trailing: false }) passes only the first DATA of a burst; subsequent DATAs within the same ms window are suppressed.",
	specRef: "src/extra/operators.ts:throttle — leading-edge contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 2, maxLength: 5 }),
			(values) => {
				vi.useFakeTimers();
				try {
					let pushSrc: ((v: number) => void) | undefined;
					// { equals: () => false } on the source prevents Object.is
					// absorption from quietly collapsing `[5, 5]`-style repeats at the
					// producer's own output before throttle ever sees them. Without
					// this, a throttle regression that passes every emit would still
					// look like "one DATA passed" on any duplicate-value input.
					const s = producer<number>(
						(a) => {
							pushSrc = (v) => a.emit(v);
							return () => {
								pushSrc = undefined;
							};
						},
						{ equals: () => false },
					);
					const t = throttle(s as Node<number>, 100, { trailing: false });
					const emitted: number[] = [];
					const unsub = t.subscribe((msgs) => {
						for (const m of msgs as readonly [symbol, unknown?][]) {
							if (m[0] === DATA) emitted.push(m[1] as number);
						}
					});
					for (const v of values) {
						pushSrc?.(v);
						vi.advanceTimersByTime(5);
					}
					unsub();
					return emitted.length === 1 && emitted[0] === values[0];
				} finally {
					vi.useRealTimers();
				}
			},
		),
};

/**
 * #28 — zip: emits the i-th tuple only once both `a` and `b` have delivered
 * their i-th DATA. Tuples stay positionally aligned regardless of dep
 * emit order.
 *
 * Topology: `state<number>(0)` and `state<number>(100)` wrapped in
 * `zip(a, b)`. Initial subscribe delivers [0, 100] (both cached DATAs
 * queue; tryEmit pairs them). Then emit N values into `a` (no tuples
 * emitted; queue_b empty). Then emit N values into `b` — exactly N
 * tuples, `emitted[k] === [k, 100 + k]` for k = 1..N.
 *
 * Catches: queue-bypass (emit-per-source without pairing), FIFO
 * violation in `tryEmit`, or `active` counter divergence that would
 * let one source race past the other.
 */
const invariant28ZipStrictPair: Invariant = {
	name: "zip-strict-pair-per-position",
	description:
		"zip(a, b) emits the i-th tuple only after both a and b have delivered their i-th DATA; tuples stay positionally aligned regardless of dep emit order.",
	specRef: "src/extra/operators.ts:zip — strict-pair contract",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 4 }), (N) => {
			const a = state<number>(0);
			const b = state<number>(100);
			const z = zip(a, b);
			const emitted: [number, number][] = [];
			const unsub = z.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as [number, number]);
				}
			});
			if (emitted.length !== 1 || emitted[0][0] !== 0 || emitted[0][1] !== 100) {
				unsub();
				return false;
			}
			for (let i = 1; i <= N; i++) a.emit(i);
			if (emitted.length !== 1) {
				unsub();
				return false;
			}
			for (let j = 1; j <= N; j++) b.emit(100 + j);
			unsub();
			if (emitted.length !== N + 1) return false;
			for (let k = 1; k <= N; k++) {
				if (emitted[k][0] !== k || emitted[k][1] !== 100 + k) return false;
			}
			return true;
		}),
};

/**
 * #29 — distinctUntilChanged: suppresses consecutive duplicate DATA values
 * even when the upstream source admits them; the downstream trace is
 * the dedup'd sequence.
 *
 * Topology: `state<number>(-1, { equals: () => false })` — source-level
 * absorption disabled so every `emit` produces DATA. Wrapped in
 * `distinctUntilChanged(s)`. Emit each generated value; assert the
 * downstream trace equals the canonical dedup of `[-1, ...values]`
 * starting from the initial.
 *
 * Catches: dedup state corruption across waves, first-DATA bypass,
 * or `equals` fn misapplication (e.g. using `Object.is` on objects
 * when a deep equality was configured).
 */
const invariant29DistinctUntilChanged: Invariant = {
	name: "distinct-until-changed-dedups-consecutive",
	description:
		"distinctUntilChanged suppresses consecutive duplicate DATA values even when the upstream source admits them; the downstream trace is the dedup'd sequence.",
	specRef: "src/extra/operators.ts:distinctUntilChanged — consecutive-dedup contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 2, maxLength: 8 }),
			(values) => {
				const s = state<number>(-1, { equals: () => false });
				const d = distinctUntilChanged(s as Node<number>);
				const emitted: number[] = [];
				const unsub = d.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) emitted.push(m[1] as number);
					}
				});
				for (const v of values) s.emit(v);
				unsub();
				const expected: number[] = [-1];
				let prev = -1;
				for (const v of values) {
					if (v !== prev) {
						expected.push(v);
						prev = v;
					}
				}
				if (emitted.length !== expected.length) return false;
				for (let i = 0; i < expected.length; i++) {
					if (emitted[i] !== expected[i]) return false;
				}
				return true;
			},
		),
};

/**
 * #30 — sample: `sample(src, notifier)` re-emits src's latest DATA each time
 * notifier emits DATA. Source-tick pairing is positional.
 *
 * Topology: `state<number>(-1)` (src) + `state<number>(-1)` (ticker)
 * wrapped in `sample(src, ticker)`. Initial subscribe:
 * - sample subscribes src → callback fires with src's cached DATA(-1), sets
 *   lastSourceValue.v = -1.
 * - sample subscribes ticker → callback fires with ticker's cached
 *   DATA(-1) → emits `lastSourceValue.v = -1`.
 *
 * Then, for each i in 1..N, mutate src to a unique value and tick; the
 * output must carry that unique value positionally.
 *
 * Catches: held-value staleness (emitting prior src value after newer
 * src DATA), notifier DATA swallowed without emit, or source-completed
 * leaks (sample continuing after source terminates).
 */
const invariant30Sample: Invariant = {
	name: "sample-emits-source-latest-on-notifier",
	description:
		"sample(src, notifier) emits the latest src DATA each time notifier emits; source-tick pairing is positional.",
	specRef: "src/extra/operators.ts:sample — latest-on-notifier contract",
	property: () =>
		fc.property(fc.integer({ min: 2, max: 5 }), (N) => {
			const src = state<number>(-1);
			const ticker = state<number>(-1);
			const sp = sample(src as Node<number>, ticker as Node<number>);
			const emitted: number[] = [];
			const unsub = sp.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number);
				}
			});
			for (let i = 1; i <= N; i++) {
				src.emit(i * 100);
				ticker.emit(i);
			}
			const expected = [-1];
			for (let i = 1; i <= N; i++) expected.push(i * 100);
			if (emitted.length !== expected.length) {
				unsub();
				return false;
			}
			for (let k = 0; k < expected.length; k++) {
				if (emitted[k] !== expected[k]) {
					unsub();
					return false;
				}
			}
			// Source-completed leak check: after src COMPLETE, sample must clear its
			// held value and notifier ticks must no longer produce DATA.
			const lenBeforeComplete = emitted.length;
			src.down([[COMPLETE]]);
			ticker.emit(999);
			ticker.emit(1000);
			unsub();
			return emitted.length === lenBeforeComplete;
		}),
};

/**
 * #31 — pairwise: emits `[prev, curr]` starting from the second DATA; the
 * first DATA produces no tuple.
 *
 * Topology: `state<number>(values[0], { equals: () => false })` (source
 * absorption disabled so even equal consecutive values pass) wrapped in
 * `pairwise(s)`. Emit `values[1..]`; assert the downstream trace is
 * exactly `[(values[0], values[1]), (values[1], values[2]), …]`.
 *
 * Catches: first-DATA tuple leak (emitting `[undefined, v0]`), prev-state
 * corruption across waves, or tuple-order flip.
 */
const invariant31Pairwise: Invariant = {
	name: "pairwise-emits-adjacent-tuples",
	description:
		"pairwise(source) emits [prev, curr] starting from the second DATA; the first DATA produces no tuple and tuples stay positionally aligned.",
	specRef: "src/extra/operators.ts:pairwise — adjacent-tuple contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 2, maxLength: 6 }),
			(values) => {
				const s = state<number>(values[0], { equals: () => false });
				const p = pairwise(s as Node<number>);
				const emitted: [number, number][] = [];
				const unsub = p.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) emitted.push(m[1] as [number, number]);
					}
				});
				for (let i = 1; i < values.length; i++) s.emit(values[i]);
				unsub();
				const expected: [number, number][] = [];
				for (let i = 1; i < values.length; i++) {
					expected.push([values[i - 1], values[i]]);
				}
				if (emitted.length !== expected.length) return false;
				for (let k = 0; k < expected.length; k++) {
					if (emitted[k][0] !== expected[k][0] || emitted[k][1] !== expected[k][1]) {
						return false;
					}
				}
				return true;
			},
		),
};

/**
 * #32 — bufferCount: `bufferCount(source, N)` emits one array of exactly N
 * DATAs per N consecutive source DATAs. Arrays are positionally aligned
 * with source order.
 *
 * Topology: `state<number>(-1, { equals: () => false })` wrapped in
 * `bufferCount(s, N)`. The cached DATA(-1) on subscribe counts as the
 * first source DATA. Emit N*M - 1 more values (total N*M); assert
 * exactly M arrays of size N, with the concatenated values equal to
 * `[-1, 1, 2, ..., N*M - 1]`.
 *
 * Catches: chunk-size drift (wrong array length), chunk-boundary miss
 * (e.g. emit-before-push check), or partial-tail leak (emit a sub-N
 * array without a COMPLETE gate).
 */
const invariant32BufferCount: Invariant = {
	name: "buffer-count-chunks-exactly-n",
	description:
		"bufferCount(source, N) emits exactly one array of size N per N consecutive source DATAs; arrays stay positionally aligned with source order.",
	specRef: "src/extra/operators.ts:bufferCount — chunking contract",
	property: () =>
		fc.property(fc.integer({ min: 2, max: 5 }), fc.integer({ min: 2, max: 5 }), (N, M) => {
			const s = state<number>(-1, { equals: () => false });
			const b = bufferCount(s as Node<number>, N);
			const emitted: number[][] = [];
			const unsub = b.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number[]);
				}
			});
			const total = N * M;
			for (let i = 1; i < total; i++) s.emit(i);
			unsub();
			if (emitted.length !== M) return false;
			for (const chunk of emitted) {
				if (chunk.length !== N) return false;
			}
			const flat: number[] = [];
			for (const c of emitted) flat.push(...c);
			if (flat.length !== total) return false;
			if (flat[0] !== -1) return false;
			for (let i = 1; i < total; i++) {
				if (flat[i] !== i) return false;
			}
			return true;
		}),
};

/**
 * #33 — delay: `delay(source, ms)` emits every source DATA exactly once,
 * in source-arrival order, after the ms shift. No DATA reaches
 * downstream before ms elapses from its source-arrival time.
 *
 * Topology: captured-push `producer<number>`. Under fake timers, fire
 * all N values at t=0. Assert zero DATA at t=99 and t=100-epsilon
 * (timer not yet fired). At t=101, all N DATAs delivered in source
 * order.
 *
 * Catches: timer-drop (delay swallowing a DATA), out-of-order delivery
 * (e.g. emitting values[1] before values[0]), or eager emission
 * (bypassing the ms shift).
 */
const invariant33Delay: Invariant = {
	name: "delay-preserves-values-and-order",
	description:
		"delay(source, ms) emits every source DATA exactly once, in source-arrival order, after the ms shift; no DATA reaches downstream before ms elapses.",
	specRef: "src/extra/operators.ts:delay — time-shift contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 2, maxLength: 5 }),
			(values) => {
				vi.useFakeTimers();
				try {
					let pushSrc: ((v: number) => void) | undefined;
					const s = producer<number>(
						(a) => {
							pushSrc = (v) => a.emit(v);
							return () => {
								pushSrc = undefined;
							};
						},
						{ equals: () => false },
					);
					const d = delay(s as Node<number>, 100, { equals: () => false });
					const emitted: number[] = [];
					const unsub = d.subscribe((msgs) => {
						for (const m of msgs as readonly [symbol, unknown?][]) {
							if (m[0] === DATA) emitted.push(m[1] as number);
						}
					});
					for (const v of values) pushSrc?.(v);
					if (emitted.length !== 0) {
						unsub();
						return false;
					}
					vi.advanceTimersByTime(99);
					if (emitted.length !== 0) {
						unsub();
						return false;
					}
					vi.advanceTimersByTime(2);
					unsub();
					if (emitted.length !== values.length) return false;
					for (let i = 0; i < values.length; i++) {
						if (emitted[i] !== values[i]) return false;
					}
					return true;
				} finally {
					vi.useRealTimers();
				}
			},
		),
};

/**
 * #34 — buffer: `buffer(src, notifier)` emits accumulated source DATAs as an
 * array on each notifier DATA, then resets the buffer. No emission
 * between notifier ticks.
 *
 * Topology: `state<number>(-1, { equals: () => false })` (src) +
 * `state<number>(-1, { equals: () => false })` (notifier) wrapped in
 * `buffer(src, notifier)`. Initial subscribe order: src subscribes
 * first, cached DATA(-1) → buf=[-1]; notifier subscribes, cached
 * DATA(-1) → flush [-1], buf=[].
 *
 * Then for each of R rounds: emit K distinct values into src (buf
 * grows to K; no emit yet) then tick notifier (flush the K values
 * as one array, buf=[]). Assert exactly R + 1 arrays emitted (1
 * initial + R per-round); each round-array has K sequential values.
 *
 * Catches: buffer-drop (value swallowed without notifier), flush-on-
 * source (erroneous emit on every source DATA), non-empty-gate missing
 * (flush when buf empty yielding []), or reset-miss (values leaked
 * across rounds).
 */
const invariant34Buffer: Invariant = {
	name: "buffer-notifier-flushes-accumulated",
	description:
		"buffer(src, notifier) emits accumulated source DATAs as an array on each notifier DATA, then resets the buffer; no emission between notifier ticks.",
	specRef: "src/extra/operators.ts:buffer — notifier-flush contract",
	property: () =>
		fc.property(fc.integer({ min: 2, max: 4 }), fc.integer({ min: 2, max: 4 }), (R, K) => {
			const src = state<number>(-1, { equals: () => false });
			const notifier = state<number>(-1, { equals: () => false });
			const b = buffer(src as Node<number>, notifier as Node<number>);
			const emitted: number[][] = [];
			const unsub = b.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number[]);
				}
			});
			if (emitted.length !== 1 || emitted[0].length !== 1 || emitted[0][0] !== -1) {
				unsub();
				return false;
			}
			let counter = 0;
			for (let r = 0; r < R; r++) {
				for (let k = 0; k < K; k++) src.emit(counter++);
				if (emitted.length !== r + 1) {
					unsub();
					return false;
				}
				notifier.emit(100 + r);
				if (emitted.length !== r + 2) {
					unsub();
					return false;
				}
				const latest = emitted[emitted.length - 1];
				if (latest.length !== K) {
					unsub();
					return false;
				}
				for (let k = 0; k < K; k++) {
					if (latest[k] !== r * K + k) {
						unsub();
						return false;
					}
				}
			}
			unsub();
			return true;
		}),
};

/**
 * #35 — bufferTime: `bufferTime(src, ms)` emits an array of the values
 * accumulated during each ms window; empty windows produce no
 * emission.
 *
 * Topology: captured-push `producer<number>` with `{ equals: () => false }`
 * wrapped in `bufferTime(src, 100)`. Under fake timers, for each
 * generated non-empty window: push the window's values, then
 * `advanceTimersByTime(100)` to fire the setInterval tick. Assert the
 * downstream trace is exactly `windows[i]` per position.
 *
 * Catches: window-boundary drift (tick fires at wrong time), empty-
 * buffer emission, or across-window leak.
 */
const invariant35BufferTime: Invariant = {
	name: "buffertime-flushes-on-window-boundary",
	description:
		"bufferTime(src, ms) emits one array per ms window containing that window's source DATAs in order; empty windows produce no emission.",
	specRef: "src/extra/operators.ts:bufferTime — time-window contract",
	property: () =>
		fc.property(
			fc.array(fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 1, maxLength: 4 }), {
				minLength: 2,
				maxLength: 4,
			}),
			(windows) => {
				vi.useFakeTimers();
				try {
					let push: ((v: number) => void) | undefined;
					const src = producer<number>(
						(a) => {
							push = (v) => a.emit(v);
							return () => {
								push = undefined;
							};
						},
						{ equals: () => false },
					);
					const b = bufferTime(src as Node<number>, 100);
					const emitted: number[][] = [];
					const unsub = b.subscribe((msgs) => {
						for (const m of msgs as readonly [symbol, unknown?][]) {
							if (m[0] === DATA) emitted.push(m[1] as number[]);
						}
					});
					for (const win of windows) {
						for (const v of win) push?.(v);
						vi.advanceTimersByTime(100);
					}
					unsub();
					if (emitted.length !== windows.length) return false;
					for (let i = 0; i < windows.length; i++) {
						if (emitted[i].length !== windows[i].length) return false;
						for (let j = 0; j < windows[i].length; j++) {
							if (emitted[i][j] !== windows[i][j]) return false;
						}
					}
					return true;
				} finally {
					vi.useRealTimers();
				}
			},
		),
};

/**
 * #36 — interval: `interval(periodMs)` emits an incrementing counter
 * starting at 0, one DATA per periodMs. Advancing N periods under
 * fake timers yields exactly N DATAs `[0, 1, ..., N-1]`.
 *
 * Catches: counter initialization drift, double-fire (two DATAs per
 * period), or period-miss.
 */
const invariant36Interval: Invariant = {
	name: "interval-emits-monotonic-counter-per-period",
	description:
		"interval(periodMs) emits an incrementing counter (0, 1, 2, ...) one per periodMs; advancing N periods yields exactly N DATAs with the expected counter values.",
	specRef: "src/extra/operators.ts:interval — periodic-emit contract",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 6 }), (N) => {
			vi.useFakeTimers();
			try {
				const iv = interval(50);
				const emitted: number[] = [];
				const unsub = iv.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) emitted.push(m[1] as number);
					}
				});
				vi.advanceTimersByTime(50 * N);
				unsub();
				if (emitted.length !== N) return false;
				for (let i = 0; i < N; i++) {
					if (emitted[i] !== i) return false;
				}
				return true;
			} finally {
				vi.useRealTimers();
			}
		}),
};

/**
 * #37 — rescue: `rescue(src, recover)` swallows source ERROR and emits
 * `recover(err)` as DATA; no ERROR is forwarded to the output.
 *
 * Topology: `state<number>(-1, { equals: () => false })` wrapped in
 * `rescue(s, err => recoveryValue)` where `recoveryValue` is
 * generated from `fc.integer({ min: 100, max: 999 })` (disjoint from
 * the initial -1 so absorption doesn't confuse the check). Initial
 * subscribe delivers DATA(-1). Then `src.down([[ERROR, errTag]])`
 * triggers the recover path. Assert: output trace is `[-1,
 * recoveryValue]`, zero ERRORs, zero COMPLETEs.
 *
 * Catches: ERROR leak (forwarded alongside recovery DATA),
 * recovery-fn not called (DATA from recover missing), or
 * double-emission of the recovery value.
 */
const invariant37Rescue: Invariant = {
	name: "rescue-replaces-error-with-value",
	description:
		"rescue(src, recover) swallows a source ERROR and emits recover(err) as DATA; no ERROR or spurious COMPLETE reaches the output.",
	specRef: "src/extra/operators.ts:rescue — error-recovery contract",
	property: () =>
		fc.property(
			fc.integer({ min: 100, max: 999 }),
			fc.integer({ min: 1, max: 99 }),
			(recoveryValue, errTag) => {
				const src = state<number>(-1, { equals: () => false });
				const r = rescue(src as Node<number>, () => recoveryValue);
				const emitted: number[] = [];
				const terminals: symbol[] = [];
				const unsub = r.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) emitted.push(m[1] as number);
						else if (m[0] === ERROR || m[0] === COMPLETE) terminals.push(m[0]);
					}
				});
				if (emitted.length !== 1 || emitted[0] !== -1) {
					unsub();
					return false;
				}
				src.down([[ERROR, errTag]]);
				unsub();
				if (terminals.length !== 0) return false;
				return emitted.length === 2 && emitted[1] === recoveryValue;
			},
		),
};

/**
 * #38 — concat: `concat(a, b)` emits all of `a`'s DATA in phase 0; on `a`
 * COMPLETE, phase=1 flushes any buffered `b` DATA and continues
 * forwarding `b`. Second-source DATAs never reach output before `a`
 * COMPLETEs.
 *
 * Topology: `state<number>(-1, { equals: () => false })` (a) +
 * `state<number>(-2, { equals: () => false })` (b) wrapped in
 * `concat(a, b)`. Subscribe order inside concat: secondSrc first →
 * cached DATA(-2) goes to `pending` (phase=0). firstSrc second →
 * cached DATA(-1) passes through (phase=0 DATA branch). Initial
 * output: `[-1]`.
 *
 * Then: emit M values into `a` (all forwarded). Emit K values into
 * `b` (all buffered in `pending`; output unchanged). `a.down([[COMPLETE]])`
 * → phase=1, flush pending = `[-2, 101..100+K]` via sequential
 * `a.emit(v)`. Assert output = `[-1, 1..M, -2, 101..100+K]`.
 *
 * Catches: second-source leak into phase 0, pending-drop on COMPLETE,
 * out-of-order flush, or stuck-phase (never transitioning to phase=1).
 */
const invariant38Concat: Invariant = {
	name: "concat-phase-transition-a-completes-before-b",
	description:
		"concat(a, b) emits all of a's DATA in phase 0; on a COMPLETE, phase=1 flushes any buffered b DATA and continues forwarding b. Second-source DATAs never reach output before a COMPLETEs.",
	specRef: "src/extra/operators.ts:concat — phase-transition contract",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }), (M, K) => {
			const aSrc = state<number>(-1, { equals: () => false });
			const bSrc = state<number>(-2, { equals: () => false });
			const c = concat(aSrc as Node<number>, bSrc as Node<number>);
			const emitted: number[] = [];
			const unsub = c.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number);
				}
			});
			if (emitted.length !== 1 || emitted[0] !== -1) {
				unsub();
				return false;
			}
			for (let i = 1; i <= M; i++) aSrc.emit(i);
			if (emitted.length !== 1 + M) {
				unsub();
				return false;
			}
			for (let j = 1; j <= K; j++) bSrc.emit(100 + j);
			if (emitted.length !== 1 + M) {
				unsub();
				return false;
			}
			aSrc.down([[COMPLETE]]);
			unsub();
			const expected: number[] = [-1];
			for (let i = 1; i <= M; i++) expected.push(i);
			expected.push(-2);
			for (let j = 1; j <= K; j++) expected.push(100 + j);
			if (emitted.length !== expected.length) return false;
			for (let k = 0; k < expected.length; k++) {
				if (emitted[k] !== expected[k]) return false;
			}
			return true;
		}),
};

/**
 * #39 — take: `take(src, N)` forwards the first N source DATAs and then
 * emits exactly one COMPLETE; subsequent source DATAs never reach
 * output.
 *
 * Topology: `state<number>(0, { equals: () => false })` wrapped in
 * `take(s, N)`. Cached DATA(0) counts as the first take. Emit N-1
 * more values (total N); `take` emits all N DATAs `[0, 1, ..., N-1]`
 * then COMPLETEs. Emit `extras` more values into s; none reach
 * output, COMPLETE count stays at 1.
 *
 * Catches: off-by-one in count, missing COMPLETE on threshold, late
 * DATA leak after done, or multiple COMPLETEs.
 */
const invariant39Take: Invariant = {
	name: "take-terminates-after-n-datas",
	description:
		"take(src, N) forwards exactly the first N source DATAs then emits exactly one COMPLETE; subsequent source DATAs never reach output.",
	specRef: "src/extra/operators.ts:take — termination contract",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 3 }), (N, extras) => {
			const s = state<number>(0, { equals: () => false });
			const t = take(s as Node<number>, N);
			const emitted: number[] = [];
			let completes = 0;
			const unsub = t.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number);
					else if (m[0] === COMPLETE) completes += 1;
				}
			});
			for (let i = 1; i < N; i++) s.emit(i);
			if (emitted.length !== N) {
				unsub();
				return false;
			}
			if (completes !== 1) {
				unsub();
				return false;
			}
			for (let i = 0; i < N; i++) {
				if (emitted[i] !== i) {
					unsub();
					return false;
				}
			}
			for (let i = 0; i < extras; i++) s.emit(1000 + i);
			// `completeWhenDepsComplete: false` means take emits its own COMPLETE
			// on threshold; a subsequent source COMPLETE must not bubble through
			// as a second downstream COMPLETE.
			s.down([[COMPLETE]]);
			unsub();
			return emitted.length === N && completes === 1;
		}),
};

/**
 * #40 — skip: `skip(src, N)` drops the first N source DATAs and forwards
 * the remainder; total downstream DATA count equals
 * `max(0, srcCount - N)`.
 *
 * Topology: `state<number>(0, { equals: () => false })` wrapped in
 * `skip(s, N)`. Cached DATA(0) is the first source DATA. Emit
 * `extras` additional values (total `1 + extras` source DATAs).
 * Assert downstream length is `max(0, 1 + extras - N)`, and the
 * values are exactly `[0, 1, ..., extras].slice(N)`.
 *
 * Catches: count mis-tracking, forwarding a skipped DATA, or dropping
 * a non-skipped DATA after the window closes.
 */
const invariant40Skip: Invariant = {
	name: "skip-drops-first-n-datas",
	description:
		"skip(src, N) drops the first N source DATAs and forwards the remainder; total downstream count equals max(0, srcCount - N).",
	specRef: "src/extra/operators.ts:skip — position-gated forwarding contract",
	property: () =>
		fc.property(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 5 }), (N, extras) => {
			const s = state<number>(0, { equals: () => false });
			const sk = skip(s as Node<number>, N);
			const emitted: number[] = [];
			const unsub = sk.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number);
				}
			});
			for (let i = 1; i <= extras; i++) s.emit(i);
			unsub();
			const totalSrc = 1 + extras;
			const expectedCount = Math.max(0, totalSrc - N);
			if (emitted.length !== expectedCount) return false;
			const allSrc: number[] = [0];
			for (let i = 1; i <= extras; i++) allSrc.push(i);
			const expected = allSrc.slice(N);
			for (let k = 0; k < expected.length; k++) {
				if (emitted[k] !== expected[k]) return false;
			}
			return true;
		}),
};

/**
 * #41 — scan: `scan(src, reducer, seed)` emits `reducer(acc, value)` once
 * per source DATA; the accumulator chain is sequential and
 * positional.
 *
 * Topology: `state<number>(values[0], { equals: () => false })` wrapped
 * in `scan(s, (acc, v) => acc + v, 0)` (sum reducer). Cached
 * DATA(values[0]) folds acc 0 → values[0]. Emit values[1..];
 * accumulator chain is monotonically increasing (all fc integers
 * ≥ 1 → strictly monotonic sums, no equals-absorption at scan's
 * output). Assert downstream matches the canonical prefix-sum.
 *
 * Catches: seed not applied, accumulator reset across waves, skipped
 * value in the fold, or reversed chain (folding newer before older).
 */
const invariant41Scan: Invariant = {
	name: "scan-folds-accumulator-per-data",
	description:
		"scan(src, reducer, seed) emits reducer(acc, value) once per source DATA; the accumulator chain is sequential and positional.",
	specRef: "src/extra/operators.ts:scan — accumulator contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 6 }),
			(values) => {
				const s = state<number>(values[0], { equals: () => false });
				const sc = scan(s as Node<number>, (acc: number, v: number) => acc + v, 0);
				const emitted: number[] = [];
				const unsub = sc.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) emitted.push(m[1] as number);
					}
				});
				for (let i = 1; i < values.length; i++) s.emit(values[i]);
				unsub();
				// scan's `initial: seed` pushes DATA(seed) on subscribe BEFORE the fn
				// runs for the source's cached DATA — so the observed trace is
				// `[seed, acc_1, acc_2, ...]` rather than just the prefix sums.
				const expected: number[] = [0];
				let acc = 0;
				for (const v of values) {
					acc += v;
					expected.push(acc);
				}
				if (emitted.length !== expected.length) return false;
				for (let k = 0; k < expected.length; k++) {
					if (emitted[k] !== expected[k]) return false;
				}
				return true;
			},
		),
};

/**
 * #42 — reduce: `reduce(src, reducer, seed)` stays silent while source emits
 * DATA, accumulating into `store.acc`; on source COMPLETE, emits
 * exactly one DATA carrying the final accumulator value, then one
 * COMPLETE.
 *
 * Topology: `state<number>(values[0], { equals: () => false })`
 * wrapped in `reduce(s, (acc, v) => acc + v, 0)`. Emit `values[1..]`
 * (all silent at reduce's output — store.acc accumulates, no DATA).
 * Then `s.down([[COMPLETE]])` — reduce fires the terminal branch:
 * exactly one DATA = `sum(values)`, exactly one COMPLETE.
 *
 * Catches: premature emit (firing during DATA), missing terminal
 * emit, wrong accumulator value, or COMPLETE before DATA in the
 * terminal wave.
 */
const invariant42Reduce: Invariant = {
	name: "reduce-emits-once-on-complete",
	description:
		"reduce(src, reducer, seed) stays silent during DATA and emits exactly one DATA (carrying the final accumulator) followed by one COMPLETE on source COMPLETE.",
	specRef: "src/extra/operators.ts:reduce — single-emit-on-complete contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 6 }),
			(values) => {
				const s = state<number>(values[0], { equals: () => false });
				const r = reduce(s as Node<number>, (acc: number, v: number) => acc + v, 0);
				const emitted: number[] = [];
				let completes = 0;
				const unsub = r.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) emitted.push(m[1] as number);
						else if (m[0] === COMPLETE) completes += 1;
					}
				});
				for (let i = 1; i < values.length; i++) s.emit(values[i]);
				if (emitted.length !== 0 || completes !== 0) {
					unsub();
					return false;
				}
				s.down([[COMPLETE]]);
				unsub();
				const expectedSum = values.reduce((a, v) => a + v, 0);
				return emitted.length === 1 && emitted[0] === expectedSum && completes === 1;
			},
		),
};

/**
 * #43 — merge: `merge(...sources)` forwards every DATA from every live
 * source; total downstream count equals the sum of per-source DATA
 * counts. Order is subscribe-interleaved per source but the emitted
 * set of values must exactly match the input union.
 *
 * Topology: N sources, each `state<number>(-1 - i, { equals: () => false })`
 * for i ∈ 0..N-1 (unique negative caches). `m = merge(...sources)`.
 * Subscribe delivers N cached DATAs `[-1, -2, ..., -N]` in
 * subscribe order. Then K rounds round-robin, each source emits
 * `i * 1000 + k` (globally unique). Assert:
 *   - total emitted count = N + N*K
 *   - emitted set equals the canonical union set
 *
 * Catches: inner-source drop, duplicate fan-out, subscribe order
 * miss (first source's cache skipped), premature COMPLETE on one-
 * source-complete (merge must wait for all).
 */
const invariant43Merge: Invariant = {
	name: "merge-forwards-data-from-all-sources",
	description:
		"merge(...sources) forwards every DATA from every live source; total downstream count equals the sum of per-source counts and the emitted set matches the union.",
	specRef: "src/extra/operators.ts:merge — fan-in contract",
	property: () =>
		fc.property(fc.integer({ min: 2, max: 4 }), fc.integer({ min: 1, max: 3 }), (N, K) => {
			const sources = Array.from({ length: N }, (_, i) =>
				state<number>(-1 - i, { equals: () => false }),
			);
			const m = merge(...(sources as Node<number>[]));
			const emitted: number[] = [];
			let completes = 0;
			const unsub = m.subscribe((msgs) => {
				for (const mm of msgs as readonly [symbol, unknown?][]) {
					if (mm[0] === DATA) emitted.push(mm[1] as number);
					else if (mm[0] === COMPLETE) completes += 1;
				}
			});
			for (let k = 1; k <= K; k++) {
				for (let i = 0; i < N; i++) sources[i].emit(i * 1000 + k);
			}
			if (emitted.length !== N + N * K) {
				unsub();
				return false;
			}
			const expectedSet = new Set<number>();
			for (let i = 0; i < N; i++) expectedSet.add(-1 - i);
			for (let k = 1; k <= K; k++) {
				for (let i = 0; i < N; i++) expectedSet.add(i * 1000 + k);
			}
			const emittedSet = new Set(emitted);
			if (emittedSet.size !== expectedSet.size) {
				unsub();
				return false;
			}
			for (const v of expectedSet) {
				if (!emittedSet.has(v)) {
					unsub();
					return false;
				}
			}
			// Staged COMPLETE check: merge must NOT forward downstream COMPLETE until
			// every inner source completes. Complete all but the last — downstream
			// stays live. Then complete the last — exactly one COMPLETE emerges.
			for (let i = 0; i < N - 1; i++) sources[i].down([[COMPLETE]]);
			if (completes !== 0) {
				unsub();
				return false;
			}
			sources[N - 1].down([[COMPLETE]]);
			unsub();
			return completes === 1;
		}),
};

/**
 * #44 — filter: `filter(src, predicate)` forwards exactly the source DATAs
 * that satisfy predicate, in order; non-matching DATAs emit
 * RESOLVED (not captured as DATA).
 *
 * Topology: `state<number>(values[0], { equals: () => false })` +
 * `filter(s, v => v % 2 === 0, { equals: () => false })`. The outer
 * `equals: () => false` on filter disables its own Object.is dedupe
 * so consecutive identical matching values both pass through —
 * otherwise `values = [2, 2]` would collapse to one emit and
 * conflate operator semantics with protocol absorption. Emit
 * `values[1..]`; assert downstream equals `values.filter(even)`.
 *
 * Catches: predicate false-positive (forwarding a non-matching
 * value), predicate false-negative (dropping a matching value),
 * batch-iteration bug (only first element evaluated per wave), or
 * RESOLVED vs DATA conflation on non-matches.
 */
const invariant44Filter: Invariant = {
	name: "filter-forwards-only-matching-predicate",
	description:
		"filter(src, predicate) forwards exactly the source DATAs that satisfy predicate, in order; non-matching DATAs do not reach the output.",
	specRef: "src/extra/operators.ts:filter — predicate-gated forwarding contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 2, maxLength: 8 }),
			(values) => {
				const s = state<number>(values[0], { equals: () => false });
				const f = filter(s as Node<number>, (v) => v % 2 === 0, {
					equals: () => false,
				});
				const emitted: number[] = [];
				const unsub = f.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) emitted.push(m[1] as number);
					}
				});
				for (let i = 1; i < values.length; i++) s.emit(values[i]);
				unsub();
				const expected = values.filter((v) => v % 2 === 0);
				if (emitted.length !== expected.length) return false;
				for (let k = 0; k < expected.length; k++) {
					if (emitted[k] !== expected[k]) return false;
				}
				return true;
			},
		),
};

/**
 * #45 — map: `map(src, project)` emits `project(v)` for every source
 * DATA v, in order. Count is preserved exactly; ordering is
 * preserved exactly.
 *
 * Topology: `state<number>(values[0], { equals: () => false })`
 * wrapped in `map(s, v => v * 2 + 7, { equals: () => false })`.
 * The project fn `v * 2 + 7` is injective so consecutive
 * identical inputs would still produce distinct outputs only if
 * inputs differ; the `equals: () => false` on map itself lets
 * identical projected outputs pass when inputs repeat. Emit
 * `values[1..]`; assert downstream = `values.map(project)`.
 *
 * Catches: dropped emit (output < input count), duplicated emit,
 * batch-iteration bug (only first element projected per wave),
 * or project-fn not applied (raw value forwarded).
 */
const invariant45Map: Invariant = {
	name: "map-transforms-values-one-to-one",
	description:
		"map(src, project) emits project(v) for every source DATA v, in order; count and ordering are preserved.",
	specRef: "src/extra/operators.ts:map — one-to-one transform contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 2, maxLength: 8 }),
			(values) => {
				const s = state<number>(values[0], { equals: () => false });
				const project = (v: number) => v * 2 + 7;
				const m = map(s as Node<number>, project, { equals: () => false });
				const emitted: number[] = [];
				const unsub = m.subscribe((msgs) => {
					for (const mm of msgs as readonly [symbol, unknown?][]) {
						if (mm[0] === DATA) emitted.push(mm[1] as number);
					}
				});
				for (let i = 1; i < values.length; i++) s.emit(values[i]);
				unsub();
				const expected = values.map(project);
				if (emitted.length !== expected.length) return false;
				for (let k = 0; k < expected.length; k++) {
					if (emitted[k] !== expected[k]) return false;
				}
				return true;
			},
		),
};

/**
 * #46 — combine: `combine(a, b)` emits `[latestA, latestB]` on every dep
 * settle; tuples track the freshest value per dep.
 *
 * Topology: `state<number>(0, { equals: () => false })` +
 * `state<number>(100, { equals: () => false })` wrapped in
 * `combine(a, b)`. combine is `derived([a, b], vals => vals)` with
 * a custom element-wise tuple-equals; it defaults `partial: false`
 * so activation produces exactly one initial tuple `[0, 100]`.
 *
 * Then alternate distinct emits: `a.emit(i*10)` → tuple becomes
 * `[i*10, bCache]`; `b.emit(1000+i)` → tuple becomes
 * `[aLatest, 1000+i]`. Each emit produces exactly one new tuple
 * DATA. Assert total count is `1 + 2*steps` and the final tuple
 * is the most recent pair.
 *
 * Catches: first-run gate missed (no initial tuple), stale-value
 * leak (tuple carries prior dep value on cross-dep emit), or
 * duplicate-emission.
 */
const invariant46Combine: Invariant = {
	name: "combine-emits-latest-tuple-on-any-dep-settle",
	description:
		"combine(a, b) emits [latestA, latestB] on every dep settle; tuples track the freshest value per dep and count = 1 + (a-emits + b-emits).",
	specRef: "src/extra/operators.ts:combine — multi-dep snapshot contract",
	property: () =>
		fc.property(fc.integer({ min: 2, max: 4 }), (steps) => {
			const a = state<number>(0, { equals: () => false });
			const b = state<number>(100, { equals: () => false });
			const c = combine(a, b) as Node<readonly [number, number]>;
			const emitted: [number, number][] = [];
			const unsub = c.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as [number, number]);
				}
			});
			if (emitted.length !== 1 || emitted[0][0] !== 0 || emitted[0][1] !== 100) {
				unsub();
				return false;
			}
			let aValue = 0;
			let bValue = 100;
			for (let i = 1; i <= steps; i++) {
				aValue = i * 10;
				a.emit(aValue);
				const latestA = emitted[emitted.length - 1];
				if (latestA[0] !== aValue || latestA[1] !== bValue) {
					unsub();
					return false;
				}
				bValue = 1000 + i;
				b.emit(bValue);
				const latestB = emitted[emitted.length - 1];
				if (latestB[0] !== aValue || latestB[1] !== bValue) {
					unsub();
					return false;
				}
			}
			unsub();
			return emitted.length === 1 + 2 * steps;
		}),
};

/**
 * #47 — takeWhile: `takeWhile(src, predicate)` forwards matching DATAs;
 * on the first non-matching DATA, emits exactly one COMPLETE and
 * stops — no DATA forwarded for the non-match, predicate doesn't
 * re-evaluate later.
 *
 * Topology: `state<number>(0, { equals: () => false })` +
 * `takeWhile(s, v => v < 100)`. Cached DATA(0) passes predicate
 * (1st match). Emit `N - 1` more values 1..N-1 (all < 100), then
 * emit 500 (non-match). Expect: N matching DATAs, 1 COMPLETE, 0
 * extras. Emit `extras` more values (all > 100) — none reach
 * output, COMPLETE count stays 1.
 *
 * Catches: forwarding the non-matching value as DATA, missing
 * COMPLETE on first non-match, double-COMPLETE, late DATA leak
 * after done.
 */
const invariant47TakeWhile: Invariant = {
	name: "takewhile-terminates-on-first-non-matching",
	description:
		"takeWhile(src, predicate) forwards matching DATAs; on the first non-matching DATA, emits exactly one COMPLETE and stops. The non-match value never reaches output.",
	specRef: "src/extra/operators.ts:takeWhile — predicate-termination contract",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 3 }), (N, extras) => {
			const s = state<number>(0, { equals: () => false });
			const tw = takeWhile(s as Node<number>, (v) => v < 100);
			const emitted: number[] = [];
			let completes = 0;
			const unsub = tw.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number);
					else if (m[0] === COMPLETE) completes += 1;
				}
			});
			for (let i = 1; i < N; i++) s.emit(i);
			if (emitted.length !== N || completes !== 0) {
				unsub();
				return false;
			}
			s.emit(500);
			if (emitted.length !== N || completes !== 1) {
				unsub();
				return false;
			}
			for (let i = 0; i < extras; i++) s.emit(200 + i);
			// Post-terminal source COMPLETE must not bubble through as a second
			// downstream COMPLETE (takeWhile uses `completeWhenDepsComplete: false`).
			s.down([[COMPLETE]]);
			unsub();
			return emitted.length === N && completes === 1;
		}),
};

/**
 * #48 — last: `last(src)` stays silent during DATA and on source COMPLETE
 * emits exactly one DATA (the final DATA value seen) followed by
 * one COMPLETE.
 *
 * Topology: `state<number>(values[0], { equals: () => false })`
 * wrapped in `last(s)`. Emit `values[1..]` — all silent at last's
 * output (store.latest tracks). Then `s.down([[COMPLETE]])` fires
 * the terminal branch: one DATA = `values[values.length - 1]`,
 * one COMPLETE.
 *
 * Catches: premature emit during DATA, wrong value (not the last
 * seen), missing terminal emit, reversed order (COMPLETE before
 * DATA).
 */
const invariant48Last: Invariant = {
	name: "last-emits-latest-on-complete",
	description:
		"last(src) stays silent during DATA and on source COMPLETE emits exactly one DATA (the final DATA value seen) followed by one COMPLETE.",
	specRef: "src/extra/operators.ts:last — latest-on-complete contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 2, maxLength: 5 }),
			(values) => {
				const s = state<number>(values[0], { equals: () => false });
				const l = last(s as Node<number>);
				const emitted: number[] = [];
				let completes = 0;
				const unsub = l.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) emitted.push(m[1] as number);
						else if (m[0] === COMPLETE) completes += 1;
					}
				});
				for (let i = 1; i < values.length; i++) s.emit(values[i]);
				if (emitted.length !== 0 || completes !== 0) {
					unsub();
					return false;
				}
				s.down([[COMPLETE]]);
				unsub();
				return emitted.length === 1 && emitted[0] === values[values.length - 1] && completes === 1;
			},
		),
};

/**
 * #49 — tap: `tap(src, fn)` forwards every DATA unchanged; the side-effect
 * fn is invoked exactly once per source DATA in order — independent
 * of whether tap's own output absorbs identical consecutive emits.
 *
 * **Arm 1 (identity contract):** `state<number>(values[0], { equals: () => false })` +
 * `tap(s, v => sideEffects.push(v), { equals: () => false })`. The
 * `equals: () => false` on tap keeps consecutive identical values
 * passing through so emit count == side-effect count. Emit
 * `values[1..]`; assert both `emitted` and `sideEffects` equal
 * `values` exactly (same length, same order, same content).
 *
 * **Arm 2 (side-effect / emit decoupling):** source with
 * `equals: () => false`, tap WITHOUT the override, all emits are
 * identical so tap's Object.is absorbs everything after the first.
 * Assert: `sideEffects.length` equals the source-emit count
 * (fn fires per input) while `emittedCount` is exactly 1 (tap's
 * output absorbed the rest). Locks in the documented ordering:
 * `fnOrObserver(v)` is called BEFORE `a.emit(v)` per iteration.
 *
 * Catches: side-effect skip (fn not called for some DATAs),
 * double-invocation, value mutation on the forwarded DATA,
 * RESOLVED vs DATA conflation on the emit path, or a refactor
 * that moves the fn call after `a.emit` (post-absorption), which
 * would break the "once per source DATA" contract.
 */
const invariant49Tap: Invariant = {
	name: "tap-is-identity-with-side-effect",
	description:
		"tap(src, fn) forwards every DATA unchanged; the side-effect fn is invoked exactly once per source DATA, in order.",
	specRef: "src/extra/operators.ts:tap — identity-passthrough contract",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 6 }),
			(values) => {
				// Arm 1 — identity with no absorption: emit count, side-effect count,
				// and value sequence all equal `values`.
				{
					const s = state<number>(values[0], { equals: () => false });
					const sideEffects: number[] = [];
					const t = tap(
						s as Node<number>,
						(v: number) => {
							sideEffects.push(v);
						},
						{ equals: () => false },
					);
					const emitted: number[] = [];
					const unsub = t.subscribe((msgs) => {
						for (const m of msgs as readonly [symbol, unknown?][]) {
							if (m[0] === DATA) emitted.push(m[1] as number);
						}
					});
					for (let i = 1; i < values.length; i++) s.emit(values[i]);
					unsub();
					if (emitted.length !== values.length || sideEffects.length !== values.length) {
						return false;
					}
					for (let k = 0; k < values.length; k++) {
						if (emitted[k] !== values[k]) return false;
						if (sideEffects[k] !== values[k]) return false;
					}
				}
				// Arm 2 — side-effect / emit decoupling: source drives `repeats`
				// identical emits; tap's own cache absorbs all but the first. fn
				// must still fire `repeats` times (documented "once per source
				// DATA" contract, independent of downstream absorption).
				{
					const repeats = values.length;
					const fixedValue = 42;
					const s = state<number>(fixedValue, { equals: () => false });
					const sideEffects: number[] = [];
					const t = tap(s as Node<number>, (v: number) => {
						sideEffects.push(v);
					});
					let emittedCount = 0;
					const unsub = t.subscribe((msgs) => {
						for (const m of msgs as readonly [symbol, unknown?][]) {
							if (m[0] === DATA) emittedCount += 1;
						}
					});
					for (let i = 1; i < repeats; i++) s.emit(fixedValue);
					unsub();
					if (sideEffects.length !== repeats) return false;
					// Only the first DATA passes tap's Object.is; the rest absorb.
					if (emittedCount !== 1) return false;
				}
				return true;
			},
		),
};

/**
 * #50 — takeUntil: `takeUntil(src, notifier)` forwards src DATAs until
 * notifier emits DATA; on notifier DATA, emits exactly one COMPLETE
 * and stops forwarding src.
 *
 * Topology: `state<number>(0, { equals: () => false })` (src) plus a
 * captured-trigger `producer<number>` notifier (doesn't emit until
 * we call `triggerNotifier()` — rules out accidental cached-DATA
 * termination during subscribe). Emit `M - 1` extra src values (M
 * total including the cached DATA(0)). `triggerNotifier()` → one
 * COMPLETE. Emit K more src values — none reach output, COMPLETE
 * count stays 1.
 *
 * Catches: notifier ignored, premature termination from unrelated
 * notifier messages, late src DATA leak after `stopped`, or
 * double-COMPLETE.
 */
const invariant50TakeUntil: Invariant = {
	name: "takeuntil-terminates-on-notifier-data",
	description:
		"takeUntil(src, notifier) forwards src DATAs until notifier emits DATA; on notifier DATA, emits exactly one COMPLETE and stops forwarding src.",
	specRef: "src/extra/operators.ts:takeUntil — notifier-termination contract",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 3 }), (M, K) => {
			let triggerNotifier: (() => void) | undefined;
			const notifier = producer<number>((a) => {
				triggerNotifier = () => a.emit(1);
				return () => {
					triggerNotifier = undefined;
				};
			});
			const s = state<number>(0, { equals: () => false });
			const tu = takeUntil(s as Node<number>, notifier);
			const emitted: number[] = [];
			let completes = 0;
			const unsub = tu.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number);
					else if (m[0] === COMPLETE) completes += 1;
				}
			});
			for (let i = 1; i < M; i++) s.emit(i);
			if (emitted.length !== M || completes !== 0) {
				unsub();
				return false;
			}
			triggerNotifier?.();
			if (completes !== 1) {
				unsub();
				return false;
			}
			for (let i = 0; i < K; i++) s.emit(1000 + i);
			unsub();
			return emitted.length === M && completes === 1;
		}),
};

/**
 * #51 — find: `find(src, predicate)` skips non-matching DATAs; on the
 * first matching DATA, emits exactly that value followed by one
 * COMPLETE. (`find = take(filter(src, predicate), 1)` — this
 * invariant is load-bearing for the composition: a broken `take`
 * or `filter` would surface here first on a concrete domain
 * semantic.)
 *
 * Topology: `state<number>(0, { equals: () => false })` wrapped in
 * `find(s, v => v > 100)`. Cached DATA(0) and emit `nonMatches` more
 * values `1..nonMatches` (all <= nonMatches, well under 100 →
 * non-matching). Assert no DATA emitted. `s.emit(500)` (match) → one
 * DATA = 500, one COMPLETE. Extras ignored.
 *
 * Catches: forwarding non-matching DATA, missing COMPLETE on match,
 * late DATA after match + complete.
 */
const invariant51Find: Invariant = {
	name: "find-emits-first-matching-and-completes",
	description:
		"find(src, predicate) skips non-matching DATAs; on the first matching DATA, emits that value followed by exactly one COMPLETE.",
	specRef: "src/extra/operators.ts:find — first-match-and-terminate contract",
	property: () =>
		fc.property(
			fc.integer({ min: 0, max: 4 }),
			fc.integer({ min: 1, max: 3 }),
			(nonMatches, extras) => {
				const s = state<number>(0, { equals: () => false });
				const f = find(s as Node<number>, (v) => v > 100);
				const emitted: number[] = [];
				let completes = 0;
				const unsub = f.subscribe((msgs) => {
					for (const m of msgs as readonly [symbol, unknown?][]) {
						if (m[0] === DATA) emitted.push(m[1] as number);
						else if (m[0] === COMPLETE) completes += 1;
					}
				});
				for (let i = 1; i <= nonMatches; i++) s.emit(i);
				if (emitted.length !== 0 || completes !== 0) {
					unsub();
					return false;
				}
				const matchValue = 500;
				s.emit(matchValue);
				if (emitted.length !== 1 || emitted[0] !== matchValue || completes !== 1) {
					unsub();
					return false;
				}
				for (let i = 0; i < extras; i++) s.emit(200 + i);
				// Post-terminal source COMPLETE must not produce a second downstream
				// COMPLETE — `find = take(filter(...), 1)` inherits take's
				// `completeWhenDepsComplete: false`.
				s.down([[COMPLETE]]);
				unsub();
				return emitted.length === 1 && completes === 1;
			},
		),
};

/**
 * #52 — elementAt: `elementAt(src, index)` drops the first `index` DATAs
 * and emits exactly the next DATA (the index-th in source order,
 * zero-based) followed by one COMPLETE. (`elementAt = take(skip(src,
 * index), 1)` — composition-verifying.)
 *
 * Topology: `state<number>(0, { equals: () => false })` wrapped in
 * `elementAt(s, index)` with `index ∈ 0..3`. Source emits
 * `[0, 1, ..., index]` in order (1 cached + `index` additional); the
 * index-th value (zero-based) is `index` itself. Assert
 * `emitted = [index]`, `completes = 1`. Extras ignored.
 *
 * Catches: off-by-one on position gating, early emit before
 * reaching index, or COMPLETE missing.
 */
const invariant52ElementAt: Invariant = {
	name: "elementat-emits-nth-and-completes",
	description:
		"elementAt(src, index) drops the first `index` DATAs and emits exactly the next DATA (the index-th in source order, zero-based) followed by one COMPLETE.",
	specRef: "src/extra/operators.ts:elementAt — position-gated single-emit contract",
	property: () =>
		fc.property(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 3 }), (index, extras) => {
			const s = state<number>(0, { equals: () => false });
			const e = elementAt(s as Node<number>, index);
			const emitted: number[] = [];
			let completes = 0;
			const unsub = e.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) emitted.push(m[1] as number);
					else if (m[0] === COMPLETE) completes += 1;
				}
			});
			for (let i = 1; i <= index; i++) s.emit(i);
			if (emitted.length !== 1 || emitted[0] !== index || completes !== 1) {
				unsub();
				return false;
			}
			for (let i = 0; i < extras; i++) s.emit(1000 + i);
			// Post-terminal source COMPLETE must not bubble through
			// (`elementAt = take(skip(...), 1)` inherits take's
			// `completeWhenDepsComplete: false`).
			s.down([[COMPLETE]]);
			unsub();
			return emitted.length === 1 && completes === 1;
		}),
};

/**
 * #53 — windowCount: `windowCount(src, N)` emits one sub-node per N
 * source DATAs. Each sub-node carries exactly N DATAs and
 * COMPLETEs; downstream count of sub-nodes equals `M` where
 * `N * M` = total source DATAs.
 *
 * Topology: `state<number>(-1, { equals: () => false })` wrapped in
 * `windowCount(s, N)`. Initial cached DATA(-1) opens the first
 * window (via lazy `openWindow` on first DATA). Emit `N*M - 1`
 * additional values so total source DATAs = N*M. Subscribe to each
 * emitted sub-node and collect its DATAs and COMPLETE. Assert:
 * - exactly M sub-nodes emitted,
 * - each sub-node has N DATAs and is completed,
 * - flattened sub-node sequence equals `[-1, 1, 2, ..., N*M - 1]`
 *   (source DATAs in order).
 *
 * Catches: sub-node fan-out off-by-one, window not closed on
 * threshold, values leaked between windows, or a sub-node
 * failing to COMPLETE.
 */
const invariant53WindowCount: Invariant = {
	name: "windowcount-sub-nodes-per-chunk",
	description:
		"windowCount(src, N) emits one sub-node per N source DATAs; each sub-node carries exactly N DATAs and COMPLETEs; the flattened sub-node sequence equals the source DATA sequence in order.",
	specRef: "src/extra/operators.ts:windowCount — per-window sub-node emission contract",
	property: () =>
		fc.property(fc.integer({ min: 2, max: 4 }), fc.integer({ min: 2, max: 4 }), (N, M) => {
			const s = state<number>(-1, { equals: () => false });
			const w = windowCount(s as Node<number>, N);
			const windows: number[][] = [];
			const windowCompleted: boolean[] = [];
			const subUnsubs: (() => void)[] = [];
			const unsub = w.subscribe((msgs) => {
				for (const m of msgs as readonly [symbol, unknown?][]) {
					if (m[0] === DATA) {
						const sub = m[1] as Node<number>;
						const idx = windows.length;
						windows.push([]);
						windowCompleted.push(false);
						const u = sub.subscribe((sMsgs) => {
							for (const sm of sMsgs as readonly [symbol, unknown?][]) {
								if (sm[0] === DATA) windows[idx].push(sm[1] as number);
								else if (sm[0] === COMPLETE) windowCompleted[idx] = true;
							}
						});
						subUnsubs.push(u);
					}
				}
			});
			for (let i = 1; i < N * M; i++) s.emit(i);
			unsub();
			for (const u of subUnsubs) u();
			if (windows.length !== M) return false;
			for (let m = 0; m < M; m++) {
				if (windows[m].length !== N) return false;
				if (!windowCompleted[m]) return false;
			}
			const allValues: number[] = [-1];
			for (let i = 1; i < N * M; i++) allValues.push(i);
			let idx = 0;
			for (let m = 0; m < M; m++) {
				for (let k = 0; k < N; k++) {
					if (windows[m][k] !== allValues[idx++]) return false;
				}
			}
			return true;
		}),
};

// ---------------------------------------------------------------------------
// Rigor ghost-state mirrors — fast-check counterparts to TLC invariants that
// reference TLA+ ghost state (`cleanupWitness`, `terminatedBy`,
// `nonVacuousInvalidateCount`, `batchActive`) with no first-class runtime
// representation. The substrate exposes a `RigorRecorder` slot on
// `GraphReFlyConfig`; tests attach a recorder, drive the graph, then assert
// against the accumulated log.
//
// Triage notes (2026-04-24): TLC #18 `MultiSinkIterationCoherent` and TLC #27
// `MultiSinkIterationDriftClean` are NOT mirrored here — their TLA+ ghost
// (`pendingExtraDelivery`) has no runtime analogue. The runtime's
// `_deliverToSinks` iterates sinks synchronously over a single shared
// `messages` reference, so mid-iteration drift is not a representable state.
// TLC #20 / #22 / #23 are also skipped pending runtime features (§2.5
// `replayBuffer`, §2.3 meta TEARDOWN) that aren't implemented today.
// ---------------------------------------------------------------------------

interface CleanupWitnessEntry {
	node: NodeCtx;
	prevValue: unknown;
}
interface TerminalTransitionEntry {
	node: NodeCtx;
	kind: "completed" | "errored";
	autoComplete: boolean;
	autoError: boolean;
	hasDeps: boolean;
}
interface RigorLog {
	readonly recorder: RigorRecorder;
	readonly witnesses: CleanupWitnessEntry[];
	readonly terminals: TerminalTransitionEntry[];
}

/**
 * Build a fresh isolated `GraphReFlyConfig` with the default handlers + a
 * `RigorRecorder` attached. Returns the config plus the accumulated log. Each
 * property run constructs its own config so runs can't leak state between
 * them.
 */
function createRigorLoggedConfig(): { config: GraphReFlyConfig; log: RigorLog } {
	const cfg = new GraphReFlyConfig({
		onMessage: defaultConfig.onMessage,
		onSubscribe: defaultConfig.onSubscribe,
	});
	registerBuiltins(cfg);
	const witnesses: CleanupWitnessEntry[] = [];
	const terminals: TerminalTransitionEntry[] = [];
	const recorder: RigorRecorder = {
		onNonVacuousInvalidate(n, prev) {
			witnesses.push({ node: n, prevValue: prev });
		},
		onTerminalTransition(n, kind, autoComplete, autoError, hasDeps) {
			terminals.push({ node: n, kind, autoComplete, autoError, hasDeps });
		},
	};
	cfg.rigorRecorder = recorder;
	return { config: cfg, log: { recorder, witnesses, terminals } };
}

/**
 * #54 — cleanup-witness-in-value-domain (mirrors TLC #19
 * `CleanupWitnessInValueDomain`). Every recorded cleanup witness carries a
 * `prevValue` drawn from the value domain — specifically, not the
 * `undefined` sentinel. The runtime's `_onDepMessage` INVALIDATE branch
 * guards the hook with `if (this._cached === undefined) return`, so a
 * vacuous invalidate (never-populated or already-reset cache) never fires
 * the witness append.
 *
 * Topology: `state<number>(0)` fed into a `derived` that observes DATA; the
 * derived is the node we invalidate. Seed it with a DATA so `_cached` is
 * populated, then invalidate N times (`derived.down([[INVALIDATE]])`).
 * Only the first invalidate finds `_cached !== undefined` — that's the
 * non-vacuous witness. Subsequent invalidates on the already-reset cache
 * are vacuous and must not fire.
 *
 * Assert: witnesses for the derived node have `prevValue !== undefined` and
 * the witnesses captured equal the number of distinct value-to-undefined
 * transitions driven by the test (here, 1 per DATA→invalidate cycle).
 *
 * Catches: regressions that drop the `_cached === undefined` vacuous-guard,
 * or fire the hook on TEARDOWN / status reset paths.
 */
const invariant54CleanupWitnessInValueDomain: Invariant = {
	name: "cleanup-witness-in-value-domain",
	description:
		"Every non-vacuous INVALIDATE records a cleanup witness with a prev value drawn from the value domain (never the `undefined` sentinel).",
	specRef:
		"wave_protocol.tla #19 CleanupWitnessInValueDomain (via src/core/node.ts:_updateState INVALIDATE branch)",
	property: () =>
		fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 5 }), (values) => {
			const { config, log } = createRigorLoggedConfig();
			const s = state<number>(values[0] ?? 0, { config, equals: () => false });
			const d = derived<number>([s], (deps) => (deps[0] as number) * 2, { config });
			const unsub = d.subscribe(() => {});
			// Each cycle: emit a fresh DATA (populates d._cached via derived's
			// auto-emit of fn return), then invalidate (fires the witness
			// hook on the first arrival) — then a second invalidate which
			// is vacuous (cache already reset) and MUST NOT fire the hook.
			let expected = 0;
			for (const v of values) {
				s.emit(v);
				d.down([[INVALIDATE]]);
				expected++;
				d.down([[INVALIDATE]]);
			}
			unsub();
			// Non-vacuous guard: the total witness log length must be at least
			// the expected count so a future Node-facade refactor that makes
			// `w.node === d` silently return empty fails loud instead of
			// passing vacuously. (QA batch 20 guard.)
			if (log.witnesses.length < expected) return false;
			const onD = log.witnesses.filter((w) => w.node === d);
			if (onD.length !== expected) return false;
			for (const w of onD) {
				if (w.prevValue === undefined) return false;
			}
			return true;
		}),
};

/**
 * #55 — cleanup-witness-not-sentinel (mirrors TLC #24
 * `CleanupWitnessNotSentinel`). Structural companion to #54: no witness
 * entry — for ANY node, under any topology — equals the `undefined`
 * sentinel. Whereas #54 drives a specific topology and asserts a count,
 * #55 runs an event-driven graph and sweeps the whole witness log.
 *
 * Topology: `state<number>(0)` → passthrough `derived` → leaf `effect`
 * sink. Drive the source with `eventSequenceArb` (random emit / batch /
 * resolved / terminal); opportunistically fire `INVALIDATE` on any node in
 * the chain. Sweep: every witness entry must have a non-undefined
 * `prevValue`.
 *
 * Catches: a regression that reorders `this._cached = undefined` before the
 * witness hook (so the hook sees the already-cleared sentinel), or that
 * fires the witness hook on a TEARDOWN reset path where `_cached` is
 * legitimately `undefined`.
 */
const invariant55CleanupWitnessNotSentinel: Invariant = {
	name: "cleanup-witness-not-sentinel",
	description:
		"No cleanup witness entry equals the `undefined` sentinel — the witness hook only fires when _cached is a real value.",
	specRef:
		"wave_protocol.tla #24 CleanupWitnessNotSentinel (via src/core/node.ts:_onDepMessage INVALIDATE guard)",
	property: () =>
		fc.property(
			fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 4 }),
			(emits) => {
				const { config, log } = createRigorLoggedConfig();
				const s = state<number>(0, { config, equals: () => false });
				const d = derived<number>([s], (deps) => (deps[0] as number) + 1, { config });
				const unsub = d.subscribe(() => {});
				// Interleave emits with invalidates at both nodes. First
				// invalidate on a populated cache = non-vacuous; second =
				// vacuous (cache cleared). Both paths must respect the guard.
				for (const v of emits) {
					s.emit(v);
					d.down([[INVALIDATE]]);
					s.down([[INVALIDATE]]);
					d.down([[INVALIDATE]]);
				}
				unsub();
				// Non-vacuous guard: each emit cycle's first `d.down([[INVALIDATE]])`
				// runs on a populated `d._cached` (seeded by `s.emit(v)` propagating
				// through the derived fn), so at least `emits.length` witnesses
				// MUST be captured. A substrate regression that stops populating
				// `d._cached` (or a future Node-facade wrap that breaks the log)
				// would trip this before the sentinel sweep runs vacuously.
				if (log.witnesses.length < emits.length) return false;
				for (const w of log.witnesses) {
					if (w.prevValue === undefined) return false;
				}
				return true;
			},
		),
};

/**
 * #56 — cleanup-witness-accounting (mirrors TLC #26
 * `CleanupWitnessAccounting`). Quantitative law tying the witness log
 * length to the count of non-vacuous INVALIDATE deliveries. The runtime
 * guard `if (this._cached === undefined) return` enforces this
 * structurally: the hook cannot fire without a cache advance and the
 * cache cannot be cleared without firing. So the invariant reduces to
 * ≥1 non-vacuous invalidate produced ≥1 witness entry and the count per
 * node equals the number of populated→cleared transitions driven.
 *
 * Topology: `state<number>(0)` fed to `derived`. Controlled cycles of
 * (emit → invalidate) on the derived node; a counter tracks the exact
 * number of non-vacuous invalidates we drove. Assert
 * `witnesses-for-derived.length === counter`.
 *
 * Catches: off-by-N regressions between the witness guard and the cache
 * reset (e.g. a refactor that moves the cache reset above the hook so
 * every hook sees `undefined`, or vice-versa — hook fires but cache
 * never clears).
 */
const invariant56CleanupWitnessAccounting: Invariant = {
	name: "cleanup-witness-accounting",
	description:
		"The witness log length for a node equals the count of non-vacuous INVALIDATE deliveries to that node (cache populated → cache cleared transitions).",
	specRef:
		"wave_protocol.tla #26 CleanupWitnessAccounting (via src/core/node.ts:_onDepMessage INVALIDATE guard)",
	property: () =>
		fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 3 }), (N, extras) => {
			const { config, log } = createRigorLoggedConfig();
			const s = state<number>(0, { config, equals: () => false });
			const d = derived<number>([s], (deps) => (deps[0] as number) + 1, { config });
			const unsub = d.subscribe(() => {});
			let nonVacuous = 0;
			for (let i = 0; i < N; i++) {
				s.emit(i + 1); // populates d._cached via derived's auto-emit
				d.down([[INVALIDATE]]); // non-vacuous — hook fires
				nonVacuous++;
				for (let k = 0; k < extras; k++) {
					// vacuous: cache already cleared
					d.down([[INVALIDATE]]);
				}
			}
			unsub();
			// Non-vacuous guard: the full witness log must have at least
			// `nonVacuous` entries so a vacuous-pass path (e.g. a future
			// Node-facade refactor breaking `w.node === d`) can't silently
			// satisfy the exact-count equality below.
			if (log.witnesses.length < nonVacuous) return false;
			const onD = log.witnesses.filter((w) => w.node === d);
			return onD.length === nonVacuous;
		}),
};

/**
 * #57 — no-dep-cascade-terminal-when-gate-false (mirrors TLC #25
 * `NoDepCascadeTerminalWhenGateFalse`). A derived node configured with
 * `completeWhenDepsComplete: false` must NOT transition to `"completed"`
 * when all of its deps terminate via COMPLETE. Symmetrically,
 * `errorWhenDepsError: false` must suppress the dep-cascade ERROR path.
 * The runtime gate lives in `_maybeAutoTerminalAfterWave` — if the gate
 * is flipped to always-emit, this invariant trips.
 *
 * Topology: two `state<number>` sources feeding a `derived` with
 * `completeWhenDepsComplete: false`. Emit a DATA to each, then drive
 * COMPLETE at each source. The gate-off derived must not terminate.
 * Sweep terminals: any `kind === "completed" && hasDeps === true &&
 * autoComplete === false` is a failure.
 *
 * Catches: a refactor that drops the `_autoComplete` check inside
 * `_maybeAutoTerminalAfterWave`, or that auto-terminates a gated node via
 * a different code path (e.g. a mis-wired `_maybeAutoTerminalAfterWave`
 * call from a terminal-delivery site).
 */
const invariant57NoDepCascadeTerminalWhenGateFalse: Invariant = {
	name: "no-dep-cascade-terminal-when-gate-false",
	description:
		"A derived with `completeWhenDepsComplete: false` / `errorWhenDepsError: false` never transitions to `completed` / `errored` via dep cascade — no such entry appears in the terminal log.",
	specRef:
		"wave_protocol.tla #25 NoDepCascadeTerminalWhenGateFalse (via src/core/node.ts:_maybeAutoTerminalAfterWave)",
	property: () =>
		fc.property(fc.boolean(), fc.boolean(), (useError, drainExtra) => {
			const { config, log } = createRigorLoggedConfig();
			const a = state<number>(0, { config, equals: () => false });
			const b = state<number>(0, { config, equals: () => false });
			const d = derived<number>([a, b], (deps) => (deps[0] as number) + (deps[1] as number), {
				config,
				completeWhenDepsComplete: false,
				errorWhenDepsError: false,
			});
			const unsub = d.subscribe(() => {});
			a.emit(1);
			b.emit(2);
			if (useError) {
				a.down([[ERROR, new Error("test")]]);
				b.down([[ERROR, new Error("test")]]);
			} else {
				a.down([[COMPLETE]]);
				b.down([[COMPLETE]]);
			}
			if (drainExtra) {
				// drain any post-terminal wave that a regression might enqueue
				a.down([[COMPLETE]]);
				b.down([[COMPLETE]]);
			}
			unsub();
			// Non-vacuous guard: the test's premise is that `a` and `b`
			// actually terminated — if neither source transitioned (e.g. a
			// future runtime change that stops propagating direct ERROR /
			// COMPLETE through sources), the "d didn't dep-cascade" check
			// below trivially holds without exercising the gate. Sources
			// have no deps, so their terminal transitions fire with
			// `hasDeps === false`.
			const expectedKind = useError ? "errored" : "completed";
			const sourceTerminals = log.terminals.filter(
				(t) => (t.node === a || t.node === b) && t.kind === expectedKind && !t.hasDeps,
			);
			if (sourceTerminals.length < 2) return false;
			for (const t of log.terminals) {
				if (t.node !== d) continue;
				// A terminal transition on d with hasDeps=true and the matching
				// gate flag false must never fire — that's dep-cascade behavior.
				if (t.kind === "completed" && t.autoComplete === false && t.hasDeps) return false;
				if (t.kind === "errored" && t.autoError === false && t.hasDeps) return false;
			}
			return true;
		}),
};

// ---------------------------------------------------------------------------
// Dropped TLC mirrors (tracked in docs/optimizations.md "Remaining rigor-infra
// follow-ons"):
//
// - TLC #18 `MultiSinkIterationCoherent` / #27 `MultiSinkIterationDriftClean`
//   — TLA+ ghost `pendingExtraDelivery` has no runtime analogue. The runtime's
//   `_deliverToSinks` iterates sinks synchronously over a single shared
//   `messages` reference; there is no mid-iteration pending queue to sweep.
// - TLC #20 `ReplayBufferBounded` / #23 `LateSubscriberReceivesReplay` —
//   §2.5 `replayBuffer: N` is not implemented in the TS runtime yet.
// - TLC #22 `MetaTeardownObservedPreReset` — §2.3 meta companion TEARDOWN
//   tier-5 modeling is not in the TS runtime.
// - TLC #28 `TerminatedImpliesBatchIdle` — TLA+ models `batchActive` as a
//   gate on terminal actions (`Terminate` / `Teardown` require
//   `batchActive.status = "idle"`). The TS runtime allows terminal
//   transitions inside an active batch because `_frameBatch` + `downWithBatch`
//   tier-sort delivery so DATA always ships before COMPLETE in the flushed
//   wave. The invariant is a modeling-level law that doesn't map to runtime
//   semantics — a mirror would be a test of the tier-sort rather than the
//   claimed property.
// ---------------------------------------------------------------------------

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
	invariant15MultiSinkConverge,
	invariant16UpTierGuard,
	invariant17PausableOffStructural,
	invariant18SwitchMapStaleInnerSuppressed,
	invariant19MergeMapAllInnersContribute,
	invariant20ExhaustMapDropsWhileActive,
	invariant21ConcatMapSerialSubscription,
	invariant22MergeMapConcurrencyBound,
	invariant23RaceFirstWins,
	invariant24RepeatCountRespected,
	invariant25DebounceCoalesce,
	invariant26TimeoutErrorsOnIdle,
	invariant27ThrottleLeadingSuppresses,
	invariant28ZipStrictPair,
	invariant29DistinctUntilChanged,
	invariant30Sample,
	invariant31Pairwise,
	invariant32BufferCount,
	invariant33Delay,
	invariant34Buffer,
	invariant35BufferTime,
	invariant36Interval,
	invariant37Rescue,
	invariant38Concat,
	invariant39Take,
	invariant40Skip,
	invariant41Scan,
	invariant42Reduce,
	invariant43Merge,
	invariant44Filter,
	invariant45Map,
	invariant46Combine,
	invariant47TakeWhile,
	invariant48Last,
	invariant49Tap,
	invariant50TakeUntil,
	invariant51Find,
	invariant52ElementAt,
	invariant53WindowCount,
	invariant54CleanupWitnessInValueDomain,
	invariant55CleanupWitnessNotSentinel,
	invariant56CleanupWitnessAccounting,
	invariant57NoDepCascadeTerminalWhenGateFalse,
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
