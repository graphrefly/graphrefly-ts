/**
 * Timeout — emits `ERROR` with `TimeoutError` if no `DATA` arrives within the deadline.
 *
 * §3.1c — caching, fallback & composition sugar. Uses
 * `core/clock.js`-style nanoseconds and a `ResettableTimer` so the deadline
 * resets on each DATA. Distinct from the `operators/control.ts` timeout
 * (which forwards a caller-supplied error/value) — this one is the
 * resilience family's "deadline → ERROR" primitive.
 *
 * **DS-13.5.B (locked 2026-05-01).** Pre-1.0 break: returns
 * {@link TimeoutBundle} with `node` + `timeoutState` companion. Opts
 * accept `Partial<TimeoutOptions>` or `Node<Partial<TimeoutOptions>>`
 * (object-shape, replacing the old `NodeOrValue<number>` flat shape).
 * State preservation across rebind: `ns` change does NOT reset the
 * in-flight deadline — new `ns` applies to next attempt only.
 */

import { monotonicNs } from "../../core/clock.js";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED, TEARDOWN } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { ResettableTimer } from "../timer.js";
import { isNode, operatorOpts } from "./_internal.js";
import { NS_PER_MS } from "./backoff.js";

/**
 * Thrown by {@link timeout} when no `DATA` arrives within the deadline.
 *
 * @category extra
 */
export class TimeoutError extends Error {
	override name = "TimeoutError";
	constructor(ns: number) {
		super(`Timed out after ${ns / NS_PER_MS}ms`);
	}
}

/**
 * Options accepted by {@link timeout}.
 *
 * - `ns` — deadline in nanoseconds (must be `> 0`). Required at the
 *   first opts settle; missing / non-positive values throw at
 *   construction.
 * - `meta` — optional metadata merged onto the result node's `meta`
 *   for describe()/explain() introspection. Reactive `meta` updates
 *   are picked up on the next attempt's emission.
 *
 * @category extra/resilience
 */
export interface TimeoutOptions {
	ns: number;
	meta?: Record<string, unknown>;
}

/**
 * Lifecycle-shaped state companion emitted by {@link timeout}.
 *
 * Default `equals` dedups on the `status` field — subscribers don't
 * re-fire on identical-shape transitions, but DO fire on every state
 * transition AND on payload changes within the same status (e.g. when
 * `running.startedAt_ns` advances on a fresh attempt).
 *
 * @category extra/resilience
 */
export type TimeoutState =
	| { status: "pending" }
	| { status: "running"; startedAt_ns: number; deadline_ns: number }
	| { status: "completed"; settledAt_ns: number }
	| { status: "errored"; firedAt_ns: number; deadline_ns: number };

/**
 * Bundle returned by {@link timeout}: the timeout-wrapped output node and
 * its lifecycle-shaped state companion.
 *
 * **Single-subscriber / pipeline-only contract (DS-13.5.B QA, N1, 2026-05-03).**
 * The `timeoutState` companion is allocated once at factory time and shared
 * across all subscribers to `node`. With one subscriber (the typical use
 * case — wire `node` into your downstream chain, optionally observe
 * `timeoutState` separately) the companion reflects a coherent timeline.
 * With **two or more subscribers** to `node`, each subscriber re-runs the
 * producer body and writes into the same `timeoutState`, which can flip
 * between states from different in-flight machines. Don't fan out
 * `node` to multiple subscribers and rely on `timeoutState` accuracy
 * unless you use {@link keepalive} / {@link share}-style consolidation.
 *
 * @category extra/resilience
 */
export interface TimeoutBundle<T> {
	node: Node<T>;
	timeoutState: Node<TimeoutState>;
}

interface TimeoutExtraOpts {
	meta?: Record<string, unknown>;
}

/**
 * Wrap `source` with a deadline. If no `DATA` arrives within `opts.ns`
 * nanoseconds, the result node emits `[[ERROR, TimeoutError]]` and
 * transitions `timeoutState` to `"errored"`.
 *
 * The timer starts on subscription and resets on each `DATA`. `DIRTY`
 * does NOT reset the timer. Terminal messages (`COMPLETE` / `ERROR`)
 * cancel the timer.
 *
 * **Reactive opts (DS-13.5.B, locked 2026-05-01).**
 *
 * - Static-form callers pass `Partial<TimeoutOptions>` (today's path).
 *   `ns` is validated at construction; missing / non-positive throws
 *   `RangeError`.
 * - Reactive-form callers pass `Node<Partial<TimeoutOptions>>` — each
 *   emission shallow-merges over the prior opts. Empty `{}` emissions
 *   are no-ops (no rebind, no companion fire). Mid-flight opts swap
 *   does NOT reset the in-flight deadline; new `ns` applies to the
 *   next `startTimer()` call.
 * - When the opts Node has `cache === undefined` (SENTINEL: no opts
 *   emitted yet), the source is paused until the first valid opts
 *   settle. The first valid settle must carry `ns > 0` or the timer
 *   layer emits an ERROR (downstream observable) — distinct from the
 *   construction-time `RangeError` thrown for static / cache-defined
 *   invalid values.
 *
 * @param source - Upstream node.
 * @param opts - `Partial<TimeoutOptions>` (static) or
 *   `Node<Partial<TimeoutOptions>>` (reactive).
 * @param extraOpts - Forwarded factory metadata (meta field merged
 *   onto the result node).
 * @returns {@link TimeoutBundle} with `node` and `timeoutState`.
 *
 * @throws {RangeError} when the first opts settle is missing or has
 *   non-positive `ns`.
 *
 * @category extra
 */
export function timeout<T>(
	source: Node<T>,
	opts: Partial<TimeoutOptions> | Node<Partial<TimeoutOptions>>,
	extraOpts?: TimeoutExtraOpts,
): TimeoutBundle<T> {
	const isReactive = isNode(opts);

	// Construction-time validation:
	// - Static form: validate the supplied object eagerly.
	// - Node form with defined cache: validate the cache value eagerly.
	// - Node form with `cache === undefined`: defer validation to first
	//   DATA emission; source is paused in the meantime.
	let latestOpts: TimeoutOptions | null = null;
	if (!isReactive) {
		const staticOpts = opts as Partial<TimeoutOptions>;
		if (
			staticOpts.ns === undefined ||
			typeof staticOpts.ns !== "number" ||
			!Number.isFinite(staticOpts.ns) ||
			staticOpts.ns <= 0
		) {
			throw new RangeError("timeout: opts.ns must be a positive finite number");
		}
		latestOpts = {
			ns: staticOpts.ns,
			...(staticOpts.meta != null ? { meta: staticOpts.meta } : {}),
		};
	} else {
		const cached = (opts as Node<Partial<TimeoutOptions>>).cache as
			| Partial<TimeoutOptions>
			| undefined;
		if (cached !== undefined) {
			if (
				cached.ns === undefined ||
				typeof cached.ns !== "number" ||
				!Number.isFinite(cached.ns) ||
				cached.ns <= 0
			) {
				throw new RangeError("timeout: opts.ns must be a positive finite number on first settle");
			}
			latestOpts = {
				ns: cached.ns,
				...(cached.meta != null ? { meta: cached.meta } : {}),
			};
		}
	}

	const callerMeta = extraOpts?.meta;
	const factoryArgs: Record<string, unknown> = isReactive
		? { ns: "Node<Partial<TimeoutOptions>>" }
		: { ns: latestOpts!.ns };

	// Companion state node — lifecycle-shaped. Default Object.is-on-status
	// dedup so identical-shape transitions don't re-fire downstream.
	const timeoutState = node<TimeoutState>([], {
		name: "timeoutState",
		describeKind: "state",
		initial: { status: "pending" },
		equals: (a, b) =>
			a === b ||
			(a != null &&
				b != null &&
				typeof a === "object" &&
				typeof b === "object" &&
				(a as { status: string }).status === (b as { status: string }).status &&
				JSON.stringify(a) === JSON.stringify(b)),
	});

	const out = node<T>(
		(_data, a) => {
			let stopped = false;
			let lastDeadlineNs = 0;
			const timer = new ResettableTimer();
			let optsUnsub: (() => void) | null = null;
			let srcUnsub: (() => void) | null = null;

			function emitState(next: TimeoutState): void {
				timeoutState.down([[DIRTY], [DATA, next]]);
			}

			function startTimer(): void {
				if (stopped) return;
				// QA A4 (2026-05-03): defensive guard — `latestOpts.ns`
				// reaching `undefined` / `NaN` / non-finite is a Class-of-
				// bugs source: an explicit `{ ns: undefined }` emit would
				// pass the per-key validation (which only checks
				// `next.ns !== undefined`) and shallow-merge over a valid
				// prior `ns`. Without this guard, `delayMs = NaN`, which
				// `setTimeout` treats as `0` → spurious immediate timeout.
				if (
					latestOpts == null ||
					typeof latestOpts.ns !== "number" ||
					!Number.isFinite(latestOpts.ns) ||
					latestOpts.ns <= 0
				) {
					return;
				}
				const ns = latestOpts.ns;
				lastDeadlineNs = ns;
				const startedAt = monotonicNs();
				const delayMs = ns / NS_PER_MS;
				emitState({
					status: "running",
					startedAt_ns: startedAt,
					deadline_ns: ns,
				});
				timer.start(delayMs, () => {
					if (stopped) return;
					stopped = true;
					srcUnsub?.();
					emitState({
						status: "errored",
						firedAt_ns: monotonicNs(),
						deadline_ns: ns,
					});
					a.down([[ERROR, new TimeoutError(ns)]]);
				});
			}

			function attachSource(): void {
				if (srcUnsub != null || stopped) return;
				srcUnsub = source.subscribe((msgs) => {
					for (const m of msgs) {
						if (stopped) return;
						const t = m[0];
						if (t === DIRTY) a.down([[DIRTY]]);
						else if (t === DATA) {
							startTimer();
							a.emit(m[1] as T);
						} else if (t === RESOLVED) a.down([[RESOLVED]]);
						else if (t === COMPLETE) {
							timer.cancel();
							stopped = true;
							emitState({
								status: "completed",
								settledAt_ns: monotonicNs(),
							});
							a.down([[COMPLETE]]);
							return;
						} else if (t === ERROR) {
							timer.cancel();
							stopped = true;
							emitState({
								status: "errored",
								firedAt_ns: monotonicNs(),
								deadline_ns: lastDeadlineNs,
							});
							a.down([m]);
							return;
						} else if (t === TEARDOWN) {
							timer.cancel();
							stopped = true;
							a.down([m]);
							return;
						} else a.down([m]);
					}
				});
				// Kick the initial timer if we already have valid opts.
				if (latestOpts != null && latestOpts.ns > 0) {
					startTimer();
				}
			}

			if (isReactive) {
				const optsNode = opts as Node<Partial<TimeoutOptions>>;
				optsUnsub = optsNode.subscribe((msgs) => {
					for (const m of msgs) {
						if (m[0] !== DATA) continue;
						const next = m[1] as Partial<TimeoutOptions>;
						if (next == null || typeof next !== "object") continue;
						// Empty `{}` emit is a no-op (lock spec).
						const keys = Object.keys(next);
						if (keys.length === 0) continue;
						// QA A4 (2026-05-03): validate ns whenever it APPEARS
						// in the emit's keys — including `{ ns: undefined }`,
						// which would otherwise skip validation and shallow-
						// merge over a valid prior `ns` with `undefined`,
						// producing `delayMs = NaN` ≈ 0 ms in startTimer().
						// `'ns' in next` covers both "explicitly undefined"
						// and "explicitly invalid" forms.
						if ("ns" in next) {
							if (typeof next.ns !== "number" || !Number.isFinite(next.ns) || next.ns <= 0) {
								if (latestOpts == null) {
									// First settle invalid — emit ERROR rather
									// than throw (mid-subscribe; sync throw
									// would corrupt the host scheduler).
									stopped = true;
									a.down([
										[
											ERROR,
											new RangeError(
												"timeout: opts.ns must be a positive finite number on first settle",
											),
										],
									]);
									return;
								}
								// Ignore invalid mid-flight ns updates; keep
								// prior latestOpts.
								continue;
							}
						}
						const wasNull = latestOpts == null;
						latestOpts = {
							...(latestOpts ?? { ns: 0 }),
							...next,
						} as TimeoutOptions;
						// First valid settle activates the source attach.
						if (wasNull && latestOpts.ns > 0) {
							attachSource();
						}
					}
				});
			}

			// Static form: attach immediately. Reactive form with defined
			// cache also attaches immediately (latestOpts pre-populated).
			if (latestOpts != null) {
				attachSource();
			}

			return () => {
				stopped = true;
				timer.cancel();
				if (srcUnsub) srcUnsub();
				if (optsUnsub) optsUnsub();
			};
		},
		{
			...operatorOpts(),
			initial: source.cache,
			meta: { ...(callerMeta ?? {}), ...factoryTag("timeout", factoryArgs) },
		},
	);

	return { node: out, timeoutState };
}
