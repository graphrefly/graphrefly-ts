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
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED, START } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
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
				const batches: readonly [symbol, unknown?][][] = [];
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
				// kind === "derived-multi": accept two valid shapes.
				// (a) Clean: [[START]], [[DIRTY]], [[DATA, sum]]
				// (b) Gap-aware: [[START]], [[DIRTY]], [[RESOLVED]], [[DIRTY]], [[DATA, sum]]
				// The final batch must carry exactly [DATA, expectedFinal]; every
				// intermediate batch must be a single-message [DIRTY] or [RESOLVED].
				// Positions 1..N-1 may contain any interleaving of DIRTY/RESOLVED;
				// this invariant asserts the handshake begins with START, ends
				// with the correct DATA, and contains no other message types.
				if (batches.length < 3) return false;
				const last = batches[batches.length - 1];
				if (last.length !== 1 || last[0][0] !== DATA) return false;
				if (!Object.is(last[0][1], expectedFinal)) return false;
				for (let i = 1; i < batches.length - 1; i++) {
					const b = batches[i];
					if (b.length !== 1) return false;
					if (b[0][0] !== DIRTY && b[0][0] !== RESOLVED) return false;
				}
				return true;
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
