/**
 * Combine operators (roadmap §2.1) — multi-source combinators.
 *
 * `combine` / `combineLatest` (latest tuple), `withLatestFrom` (paired emit
 * gated on primary), `merge` (interleave any), `zip` (one DATA per source per
 * cycle), `concat` (sequential), `race` (first DATA wins).
 */

import { COMPLETE, DATA, ERROR, type Messages, RESOLVED } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { subscribeOr } from "../../core/subscribe-error.js";
import { type ExtraOpts, gatedOperatorOpts, operatorOpts } from "./_internal.js";

/**
 * Combines the latest value from each dependency whenever any dep settles (combineLatest).
 *
 * @param sources - Nodes to combine (variadic).
 * @returns `Node<T>` - Tuple of latest values.
 *
 * @example
 * ```ts
 * import { combine, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = combine(state(1), state("a"));
 * ```
 *
 * @remarks
 * Unlike RxJS `combineLatest`, this is named `combine`. Use the {@link combineLatest} alias
 * if you prefer the RxJS name. Seed is always required for `scan`/`reduce` (no seedless mode).
 *
 * @category extra
 */
export function combine<const T extends readonly unknown[]>(
	...sources: { [K in keyof T]: Node<T[K]> }
): Node<T> {
	const deps = [...sources] as unknown as Node[];
	return node<T>(
		deps,
		(batchData, actions, ctx) => {
			const vals = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(vals as unknown as T);
		},
		{
			...operatorOpts<T>(),
			equals: (a, b) => {
				if (a.length !== b.length) return false;
				for (let i = 0; i < a.length; i++) {
					if (!Object.is(a[i], b[i])) return false;
				}
				return true;
			},
		},
	);
}

/**
 * When `primary` settles, emits `[primary, latestSecondary]`. `secondary` alone updates cache only.
 *
 * @param primary - Main stream.
 * @param secondary - Latest value is paired on each primary emission.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<readonly [A, B]>` - Paired stream.
 *
 * @example
 * ```ts
 * import { state, withLatestFrom } from "@graphrefly/graphrefly-ts";
 *
 * const n = withLatestFrom(state(1), state("x"));
 * ```
 *
 * @category extra
 */
export function withLatestFrom<A, B>(
	primary: Node<A>,
	secondary: Node<B>,
	opts?: ExtraOpts,
): Node<readonly [A, B]> {
	// **Phase 10.5 (2026-04-29; see `archive/docs/SESSION-graph-narrow-waist.md`
	// § "Phase 10.5 — `partial: false` is the actual fix"):** flipped from
	// `partial: true` to `partial: false`. Previously withLatestFrom opted
	// out of the §2.7 first-run gate to admit partial-dep waves; the side
	// effect was that on initial activation with state+state-cached deps,
	// the paired emission was dropped (W1 — see [optimizations.md "Multi-dep
	// push-on-subscribe ordering"](../../../docs/optimizations.md), and
	// COMPOSITION-GUIDE §28). With `partial: false` the gate holds during
	// activation until both deps deliver real DATA, then fires once with
	// `[primary, latestSecondary]` populated. The gate scope is
	// `_hasCalledFnOnce === false` only ([core/node.ts:1642-1645]) — once
	// fn fires, subsequent waves are gate-free and the "fire on primary
	// alone after warmup" semantic is preserved. Behavior diff vs the prior
	// `partial: true`: at activation when one dep is sentinel forever, fn
	// no longer emits a RESOLVED; it stays silent until the missing dep
	// delivers real DATA. **Audit (in-tree `withLatestFrom` consumers):**
	// `harness-loop.ts:511 triageInput` (both deps state-cached, gate
	// releases at activation), `harness-loop.ts:547 routerInput` (both deps
	// sentinel until first triage cycle, gate holds in both pre and post
	// Phase 10.5 — equivalent), `suggest-strategy.ts:176 paired`
	// (sentinel-forever-secondary case: pre-Phase-10.5 dispatched RESOLVED
	// but RESOLVED does not release downstream first-run gates per
	// [core/node.ts:1651-1660], so end state is identical). Flipping
	// individually in this fn (not via `partialOperatorOpts`) so `valve`
	// (which deliberately needs `partial: true` for control-alone-on-
	// activation) and any other partial-dep operators remain unaffected.
	return node<readonly [A, B]>(
		[primary as Node, secondary as Node],
		(data, a, ctx) => {
			const batch0 = data[0];
			const batch1 = data[1];
			// Current secondary value: this wave's last DATA if secondary fired,
			// otherwise last known value from ctx.prevData (previous wave).
			const secondaryVal = (
				batch1 != null && batch1.length > 0 ? batch1.at(-1) : ctx.prevData[1]
			) as B | undefined;

			// Only emit when primary (dep 0) sent DATA this wave.
			if (batch0 != null && batch0.length > 0) {
				// secondary has never produced DATA — undefined is the protocol
				// sentinel for "never sent DATA"; null is a valid DATA value.
				// With `partial: false` the gate holds during activation until
				// secondary delivers real DATA, so this branch is dead on the
				// first wave. It IS reachable post-warmup if secondary
				// INVALIDATEs (which clears `prevData[1]` to undefined per
				// `_depInvalidated` at [core/node.ts:1624-1635]) and then
				// primary fires before secondary re-delivers. INVALIDATE does
				// NOT re-arm the first-run gate ([core/node.ts:269] "Subsequent
				// waves, INVALIDATE, and `_addDep` do not re-gate"), so this
				// guard catches that re-delivery-pending window. (Terminal
				// settlement on secondary leaves `prevData[1]` populated per
				// `_depSettledAsTerminal` at [core/node.ts:1609-1617] — that
				// path doesn't reach this branch.)
				if (!(batch1 != null && batch1.length > 0) && ctx.prevData[1] === undefined) {
					a.down([[RESOLVED]]);
					return;
				}
				for (const v of batch0 as A[]) {
					a.emit([v, secondaryVal]);
				}
			} else {
				// Secondary update only (or both RESOLVED) — no downstream DATA.
				a.down([[RESOLVED]]);
			}
		},
		{
			...gatedOperatorOpts<readonly [A, B]>(opts),
			meta: { ...factoryTag("withLatestFrom"), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Merges **`DATA`** from any source with correct two-phase dirty tracking. **`COMPLETE`** after **all** sources complete (spec §1.3.5).
 *
 * @param sources - Nodes to merge (variadic; empty completes immediately).
 * Pass an optional trailing {@link ExtraOpts} to override `meta` (e.g. layer
 * a `metric:` companion onto the default `factoryTag("merge")`) or thread
 * core node options like `name` / `equals` / `versioning`.
 * @returns `Node<T>` - Merged stream.
 *
 * @remarks
 * **Ordering:** DIRTY/RESOLVED rules follow multi-source semantics in `~/src/graphrefly/GRAPHREFLY-SPEC.md`.
 *
 * **F-15 (2026-04-30):** `merge` accepts an optional trailing options object.
 * The runtime distinguishes a trailing opts argument from a `Node` via duck
 * typing (`subscribe` + `down` function shape) — caller-supplied opts that
 * happen to look like a `Node` are not supported (none in practice; the opts
 * shape is `{ meta?, name?, … }`).
 *
 * @example
 * ```ts
 * import { merge, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = merge(state(1), state(2));
 * const tagged = merge(state(1), state(2), { meta: { metric: "events" } });
 * ```
 *
 * @category extra
 */
export function merge<T>(...sources: readonly Node<T>[]): Node<T>;
export function merge<T>(...args: readonly [...Node<T>[], ExtraOpts]): Node<T>;
export function merge<T>(...args: ReadonlyArray<Node<T> | ExtraOpts | undefined>): Node<T> {
	// Trailing opts detection: last arg is a non-Node object. A `Node` carries
	// `subscribe` + `down` function members; a supported `ExtraOpts` carries
	// neither. A trailing `undefined` (idiomatic optional pass-through, e.g.
	// `merge(a, b, opts ?? undefined)`) is treated as "no opts" and dropped
	// from sources before the active-merge loop.
	let opts: ExtraOpts | undefined;
	let sources: readonly Node<T>[];
	const last = args.length > 0 ? args[args.length - 1] : undefined;
	if (last === undefined) {
		// No opts; drop trailing undefined so the source loop doesn't crash.
		sources = (
			args.length > 0 && args[args.length - 1] === undefined ? args.slice(0, -1) : args
		) as readonly Node<T>[];
	} else if (
		typeof last === "object" &&
		!(
			typeof (last as { subscribe?: unknown }).subscribe === "function" &&
			typeof (last as { down?: unknown }).down === "function"
		)
	) {
		opts = last as ExtraOpts;
		sources = args.slice(0, -1) as Node<T>[];
	} else {
		sources = args as readonly Node<T>[];
	}

	if (sources.length === 0) {
		return node<T>(
			(_data, a) => {
				a.down([[COMPLETE]]);
			},
			{ ...operatorOpts(opts), meta: { ...factoryTag("merge"), ...(opts?.meta ?? {}) } },
		);
	}
	// producer pattern: node() cannot be used here because the sentinel gate
	// would block the fn until ALL sources have sent their first DATA, which
	// defeats the purpose of merge (forward whichever source fires first).
	return node<T>(
		(_data, a) => {
			const n = sources.length;
			let completed = 0;
			let terminated = false;
			const unsubs: (() => void)[] = [];
			for (const src of sources) {
				// /qa F5 (2026-05-10): guard the subscribe loop with
				// `terminated` so a synchronous Dead-handler fired by
				// the all-completed branch doesn't leave subsequent
				// iterations subscribing into an already-completed
				// operator (which would leak unsubs not pushed into
				// `unsubs` due to the synchronous re-entry).
				if (terminated) break;
				// R2.2.7.b: Dead source counts as Complete for merge's
				// completion tracking (no DATA will ever flow); if all
				// sources are Dead/Complete, self-COMPLETE.
				const u = subscribeOr<unknown>(
					src as Node,
					(msgs) => {
						for (const m of msgs as Messages) {
							if (m[0] === DATA) {
								a.emit(m[1] as T);
							} else if (m[0] === COMPLETE) {
								completed += 1;
								if (completed >= n && !terminated) {
									terminated = true;
									a.down([[COMPLETE]]);
								}
							} else if (m[0] === ERROR) {
								if (!terminated) {
									terminated = true;
									a.down([m]);
								}
							}
							// DIRTY, RESOLVED, START silently absorbed
						}
					},
					() => {
						completed += 1;
						if (completed >= n && !terminated) {
							terminated = true;
							a.down([[COMPLETE]]);
						}
					},
				);
				unsubs.push(u);
			}
			return () => {
				for (const u of unsubs) u();
			};
		},
		{ ...operatorOpts(opts), meta: { ...factoryTag("merge"), ...(opts?.meta ?? {}) } },
	);
}

/**
 * Zips one **`DATA`** from each source per cycle into a tuple. Only **`DATA`** enqueues (spec §1.3.3).
 *
 * @param sources - Nodes to zip (variadic).
 * @returns `Node<T>` - Zipped tuples.
 *
 * @example
 * ```ts
 * import { state, zip } from "@graphrefly/graphrefly-ts";
 *
 * const n = zip(state(1), state(2));
 * ```
 *
 * @category extra
 */
export function zip<const T extends readonly unknown[]>(
	...sources: { [K in keyof T]: Node<T[K]> }
): Node<T> {
	const n = sources.length;
	// R5.7.x — zip requires ≥1 source; vacuous-tuple semantics rejected.
	if (n === 0) {
		throw new Error("zip(): requires at least one source");
	}
	// Producer pattern: manage queues internally.
	return node<T>((_data, a) => {
		const queues: unknown[][] = Array.from({ length: n }, () => []);
		let active = n;

		function tryEmit(): void {
			while (queues.every((q) => q.length > 0)) {
				const tuple = queues.map((q) => q.shift()!) as unknown as T;
				a.emit(tuple);
			}
		}

		const unsubs: (() => void)[] = [];
		let zipTerminated = false;
		for (let i = 0; i < n; i++) {
			if (zipTerminated) break;
			const idx = i;
			// R2.2.7.b: Dead source → zip can never form a tuple (this
			// source's queue will be permanently empty), self-COMPLETE.
			const u = subscribeOr<unknown>(
				sources[i] as Node,
				(msgs) => {
					for (const m of msgs as Messages) {
						if (zipTerminated) return;
						if (m[0] === DATA) {
							queues[idx].push(m[1]);
							tryEmit();
						} else if (m[0] === COMPLETE) {
							// /qa F4 (2026-05-10): check `zipTerminated`
							// so a prior Dead-source's COMPLETE doesn't
							// race with this live-source's COMPLETE
							// (would otherwise emit COMPLETE twice).
							active -= 1;
							if (!zipTerminated && (active === 0 || queues[idx].length === 0)) {
								zipTerminated = true;
								a.down([[COMPLETE]]);
							}
						} else if (m[0] === ERROR) {
							if (!zipTerminated) {
								zipTerminated = true;
								a.down([m]);
							}
						}
					}
				},
				() => {
					if (!zipTerminated) {
						zipTerminated = true;
						a.down([[COMPLETE]]);
					}
				},
			);
			unsubs.push(u);
		}
		return () => {
			for (const u of unsubs) u();
		};
	}, operatorOpts());
}

/**
 * Plays all of `firstSrc`, then all of `secondSrc`. **`DATA`** from `secondSrc` during phase one is buffered until handoff.
 *
 * @param firstSrc - First segment.
 * @param secondSrc - Second segment.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Concatenated stream.
 *
 * @example
 * ```ts
 * import { concat, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = concat(state(1), state(2));
 * ```
 *
 * @category extra
 */
export function concat<T>(firstSrc: Node<T>, secondSrc: Node<T>, opts?: ExtraOpts): Node<T> {
	// producer pattern: node() cannot be used here because the sentinel gate
	// would block the fn until ALL sources have sent their first DATA, which
	// defeats the purpose of concat (start forwarding firstSrc immediately,
	// regardless of secondSrc state).
	return node<T>((_data, a) => {
		let phase: 0 | 1 = 0;
		const pending: unknown[] = [];
		let firstUnsub: (() => void) | undefined;
		let secondUnsub: (() => void) | undefined;
		let secondCompleted = false;

		// R2.2.7.b: Dead secondSrc → mark second-completed flag; if
		// first eventually completes, immediately self-COMPLETE
		// (mirrors Rust concat's `second_completed` D041 fix).
		secondUnsub = subscribeOr<unknown>(
			secondSrc as Node,
			(msgs) => {
				for (const m of msgs as Messages) {
					if (phase === 0) {
						if (m[0] === DATA) pending.push(m[1]);
						else if (m[0] === COMPLETE) secondCompleted = true;
						else if (m[0] === ERROR) a.down([m]);
					} else {
						// phase 1 — forward everything from second
						if (m[0] === DATA) a.emit(m[1] as T);
						else if (m[0] === COMPLETE || m[0] === ERROR) a.down([m]);
					}
				}
			},
			() => {
				secondCompleted = true;
			},
		);

		// R2.2.7.b: Dead firstSrc → advance phase immediately, drain
		// pending, and if second is also done, self-COMPLETE.
		firstUnsub = subscribeOr<unknown>(
			firstSrc as Node,
			(msgs) => {
				for (const m of msgs as Messages) {
					if (phase === 0) {
						if (m[0] === DATA) {
							a.emit(m[1] as T);
						} else if (m[0] === COMPLETE) {
							phase = 1;
							// Flush buffered second-source DATA
							for (const v of pending) {
								a.emit(v as T);
							}
							pending.length = 0;
							if (secondCompleted) a.down([[COMPLETE]]);
						} else if (m[0] === ERROR) {
							a.down([m]);
						}
					}
					// phase 1: ignore further first-source messages
				}
			},
			() => {
				if (phase === 0) {
					phase = 1;
					for (const v of pending) {
						a.emit(v as T);
					}
					pending.length = 0;
					if (secondCompleted) a.down([[COMPLETE]]);
				}
			},
		);

		return () => {
			firstUnsub?.();
			secondUnsub?.();
		};
	}, operatorOpts(opts));
}

/**
 * First source to emit **`DATA`** wins; later traffic follows only the winner (Rx-style `race`).
 *
 * @param sources - Contestants (variadic; throws at construction when empty; one node is identity).
 * @returns `Node<T>` - Winning stream.
 *
 * @example
 * ```ts
 * import { race, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = race(state(1), state(2));
 * ```
 *
 * @category extra
 */
export function race<T>(...sources: readonly Node<T>[]): Node<T> {
	// R5.7.x — race requires ≥1 source; no-winner-possible rejected at construction.
	if (sources.length === 0) {
		throw new Error("race(): requires at least one source");
	}
	if (sources.length === 1) {
		// Identity passthrough — full batch iteration, not derived's .at(-1).
		return node<T>(
			[sources[0] as Node],
			(data, a) => {
				const batch0 = data[0];
				if (batch0 == null || batch0.length === 0) {
					a.down([[RESOLVED]]);
					return;
				}
				for (const v of batch0) a.emit(v as T);
			},
			operatorOpts<T>(),
		);
	}
	// Producer pattern: first DATA wins.
	return node<T>((_data, a) => {
		let winner: number | null = null;
		// /qa F3 (2026-05-10): tracks both Dead-at-subscribe AND
		// live-COMPLETE-without-DATA. Pre-fix this was `completedDead`
		// and only flipped from the onDead path, so mixed Dead+live
		// scenarios where a live source completed without ever
		// emitting DATA wouldn't trigger the all-completed self-Complete.
		// /qa F6 (2026-05-12): replaced per-index boolean array +
		// `completed.every()` O(n) check with a counter for O(1).
		let completedCount = 0;
		let raceTerminated = false;
		const unsubs: (() => void)[] = [];
		for (let i = 0; i < sources.length; i++) {
			if (raceTerminated) break;
			const idx = i;
			// R2.2.7.b: Dead source → increment completedCount; if all
			// sources are Dead or have completed-without-DATA, self-COMPLETE.
			const u = subscribeOr<unknown>(
				sources[i] as Node,
				(msgs) => {
					for (const m of msgs as Messages) {
						if (raceTerminated) return;
						if (winner !== null && idx !== winner) return;
						if (m[0] === DATA) {
							if (winner === null) winner = idx;
							a.emit(m[1] as T);
						} else if (m[0] === COMPLETE) {
							if (winner === null || idx === winner) {
								completedCount += 1;
								if (winner === idx) {
									// Winner completed; race is over.
									raceTerminated = true;
									a.down([m]);
								} else if (winner === null && completedCount >= sources.length) {
									// All sources completed-without-DATA; no
									// winner; self-COMPLETE.
									raceTerminated = true;
									a.down([m]);
								}
							}
						} else if (m[0] === ERROR) {
							if (winner === null || idx === winner) {
								raceTerminated = true;
								a.down([m]);
							}
						}
					}
				},
				() => {
					completedCount += 1;
					if (winner === null && !raceTerminated && completedCount >= sources.length) {
						raceTerminated = true;
						a.down([[COMPLETE]]);
					}
				},
			);
			unsubs.push(u);
		}
		return () => {
			for (const u of unsubs) u();
		};
	}, operatorOpts());
}

/**
 * RxJS-named alias for {@link combine} — emits when any dep updates with latest tuple of values.
 *
 * @param sources - Upstream nodes as separate arguments (same calling shape as `combine`).
 * @returns Combined node; signature matches `combine`.
 *
 * @example
 * ```ts
 * import { combineLatest, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = combineLatest(state(1), state("a"));
 * ```
 *
 * @category extra
 */
export const combineLatest = combine;
