/**
 * Higher-order operators — switchMap / mergeMap / concatMap / exhaustMap / flatMap
 * (D47 / R-rewire-deferred / CSP-2.7; per-language sugar, D6/D24, never in parity).
 *
 * Each projects every outer value to an INNER source and flattens the inners' emissions. The
 * inner sources are wired as runtime DEPS via the deferred-self-rewire substrate affordance
 * (`ctx.rewireNext`, D47) — NOT an internal subscribe (D45 bans that; it would create a describe
 * island). Growing/shrinking the dep set is deferred to the committed wave boundary, so a fn
 * never mutates its own topology mid-run (that is the D37 feedback-cycle ERROR). An inner that
 * COMPLETEs is `removeDep`'d → its source `_deactivate`s + fires `onDeactivation`: that is the
 * cancellation / abortInFlight basis (switchMap drops the superseded inner's WORK, not just its
 * output; mergeMap bounds memory). Built on the bare `node` primitive via the {@link Operator}
 * factory shape + the `g.initNode` funnel (D43), so the real factory name shows in describe.
 *
 * Lifecycle folding (D47): completeWhenDepsComplete:false + terminalAsRealInput:true — the
 * operator owns completion (emit COMPLETE only when the SOURCE is done AND no inner is live /
 * pending), and an inner/source terminal settles the gate so the fn observes it. Inner ERROR /
 * source ERROR auto-forward via the substrate's errorWhenDepsError (default true) → the operator
 * errors (terminal). NOTE: a terminal operator does not tear down its still-subscribed siblings
 * (they are completed or will be GC'd with the operator); explicit source-error→teardown-all and
 * non-default-dispatcher inner binding are first-cut limitations (backlog).
 *
 * Alignment: each run issues REMOVES before ADDS so the per-node FIFO drain keeps the operator's
 * tracked inner list aligned with the live dep order across the intermediate boundary waves (a
 * removed dep is silent — no settle — and applies before any added dep's push-on-subscribe wave).
 */

import type { Ctx, NodeFn } from "../ctx/types.js";
import type { Node } from "../node/node.js";
import type { Operator } from "./operators.js";
import { fromAny, type NodeInput } from "./sources.js";

/** Project an outer value to an inner source (a Node, Promise, (a)sync iterable, or scalar). */
export type Project<TIn, TOut> = (value: TIn) => NodeInput<TOut>;

type Mode = "merge" | "switch" | "concat" | "exhaust";

/** Per-node bookkeeping (ctx.state): the live inner deps (aligned with deps[1..]) + concat queue. */
interface MapState<TIn> {
	inners: Node<unknown>[];
	queue: TIn[]; // concatMap pending values (lazy projection); empty for the other modes
}

/**
 * The shared higher-order machinery. The operator depends on the source S at index 0; inner
 * sources occupy indices 1.. (added/removed at runtime via ctx.rewireNext). The body is
 * SELF-CATCHING (D30) and re-supplies itself on every rewire (the initNode wrap covers only the
 * first run; the re-supplied fn must stay self-catching).
 */
function mapOperator<TIn, TOut>(
	factory: string,
	project: Project<TIn, TOut>,
	mode: Mode,
): Operator<TIn, TOut> {
	const body: NodeFn = (ctx: Ctx) => {
		try {
			const st = (ctx.state.get<MapState<TIn>>() ?? { inners: [], queue: [] }) as MapState<TIn>;
			let inners = st.inners;
			const queue = st.queue;

			// 1. forward any inner DATA this wave (index-independent — flatten whichever inner fired).
			for (let i = 1; i < ctx.depRecords.length; i++) {
				const b = ctx.depRecords[i].batch;
				if (b && b.length > 0) for (const v of b) ctx.down([["DATA", v]]);
			}

			// 2. drop inners that terminated this/any wave (bounding); `inners` aligns with deps[1..].
			const toRemove: Node<unknown>[] = [];
			const survivors: Node<unknown>[] = [];
			for (let i = 0; i < inners.length; i++) {
				if (ctx.depRecords[i + 1]?.terminal === true) toRemove.push(inners[i]);
				else survivors.push(inners[i]);
			}
			inners = survivors;

			// 3. project the source's new value(s) per mode.
			const toAdd: Node<unknown>[] = [];
			const make = (v: TIn): Node<unknown> =>
				fromAny<TOut>(project(v), { iter: true }) as Node<unknown>;
			const sb = ctx.depRecords[0].batch as readonly TIn[] | null;
			if (sb && sb.length > 0) {
				if (mode === "switch") {
					// switch to the latest value: cancel every current inner EXCEPT a (re-projected)
					// already-live one — the dep set is unique, so removing+re-adding the same Node
					// would needlessly tear down + re-subscribe it. Superseded sources torn down.
					const inner = make(sb[sb.length - 1]);
					for (const live of inners) if (live !== inner) toRemove.push(live);
					if (!inners.includes(inner)) toAdd.push(inner);
					inners = [inner];
				} else if (mode === "merge") {
					for (const v of sb) {
						const inner = make(v);
						// a projector returning an ALREADY-LIVE Node is already merged: addDep is
						// set-idempotent, so double-tracking it in `inners` would desync the
						// inners[i] <-> deps[i+1] map permanently. Skip the duplicate.
						if (inners.includes(inner)) continue;
						inners.push(inner);
						toAdd.push(inner);
					}
				} else if (mode === "concat") {
					for (const v of sb) queue.push(v); // lazy: project on activation
				} else {
					// exhaust: ignore the source while an inner is active.
					if (inners.length === 0) {
						const inner = make(sb[0]);
						inners.push(inner);
						toAdd.push(inner);
					}
				}
			}

			// 3b. concat: activate the queue head when the single slot is free.
			if (mode === "concat" && inners.length === 0 && toAdd.length === 0 && queue.length > 0) {
				const inner = make(queue.shift() as TIn);
				inners.push(inner);
				toAdd.push(inner);
			}

			ctx.state.set({ inners, queue });

			// 4. issue REMOVES before ADDS (alignment): a removed dep is silent + applies before the
			//    added dep's push-on-subscribe settle wave, so the tracked list stays aligned.
			for (const r of toRemove) ctx.rewireNext.removeDep(r, body);
			for (const a of toAdd) ctx.rewireNext.addDep(a, body);

			// 5. completion: the SOURCE is done AND nothing is live or pending → COMPLETE (D47 folding;
			//    a queued/just-added inner keeps it open). A terminal here discards the deferred queue.
			if (
				ctx.depRecords[0].terminal === true &&
				inners.length === 0 &&
				toAdd.length === 0 &&
				queue.length === 0
			) {
				ctx.down([["COMPLETE"]]);
			}
		} catch (e) {
			ctx.down([["ERROR", e]]); // D30: a throwing projector → ERROR (self-catch survives rewire)
		}
	};

	return {
		factory,
		body,
		// D47 folding: the operator owns completion + observes inner/source terminals.
		opts: { completeWhenDepsComplete: false, terminalAsRealInput: true },
	};
}

/**
 * switchMap: project each source value to an inner; on a new source value, CANCEL the in-flight
 * inner (its source `_deactivate`s — abortInFlight) and switch to the new one. Only the current
 * inner's emissions are forwarded.
 */
export function switchMap<TIn, TOut>(project: Project<TIn, TOut>): Operator<TIn, TOut> {
	return mapOperator("switchMap", project, "switch");
}

/**
 * mergeMap (a.k.a. flatMap): project each source value to an inner and keep ALL inners live,
 * interleaving their emissions. A completed inner is removed (memory bounding). Inner ERROR
 * forwards (the operator errors); siblings are not explicitly cancelled (first-cut limitation).
 */
export function mergeMap<TIn, TOut>(project: Project<TIn, TOut>): Operator<TIn, TOut> {
	return mapOperator("mergeMap", project, "merge");
}

/** flatMap: alias of {@link mergeMap} (RxJS naming parity). */
export function flatMap<TIn, TOut>(project: Project<TIn, TOut>): Operator<TIn, TOut> {
	return mapOperator("flatMap", project, "merge");
}

/**
 * concatMap: project each source value to an inner, but run AT MOST ONE inner at a time — queue
 * later source values (lazy projection) and activate the next only when the active inner COMPLETEs.
 * Preserves source order.
 */
export function concatMap<TIn, TOut>(project: Project<TIn, TOut>): Operator<TIn, TOut> {
	return mapOperator("concatMap", project, "concat");
}

/**
 * exhaustMap: while an inner is active, DROP new source values; project the next source value only
 * after the active inner COMPLETEs.
 */
export function exhaustMap<TIn, TOut>(project: Project<TIn, TOut>): Operator<TIn, TOut> {
	return mapOperator("exhaustMap", project, "exhaust");
}

/** Per-node bookkeeping for {@link repeat}: the round index + the current live inner. */
interface RepeatState {
	started: boolean;
	round: number;
	inner: Node<unknown> | null;
}

/**
 * repeat: play a source `count` times in sequence (RxJS `repeat`). A DEPLESS self-driving operator
 * (Operator<never, S>, instantiate via `g.initNode(repeat(factory, count), [])`) — NOT a dep-operator.
 *
 * It takes a `factory: () => NodeInput<S>` (a RECIPE), not a source Node, because clean-slate Nodes
 * are HOT/shared (multicast + cache): re-subscribing the SAME node replays its cache, it does not
 * re-RUN the source. RxJS `repeat` re-subscribes the COLD source = a fresh subscription each round;
 * the clean-slate analogue is a fresh node per round → a factory. (A `repeat(count)`-over-a-Node
 * shape would need a substrate force-resubscribe affordance — D47's no-net-change-is-a-no-op makes
 * `removeDep(S)+addDep(S)` on the SAME node cancel out — deferred to that substrate work.)
 *
 * Mechanism (reuses the D47 self-rewire substrate, like the *Map family; NOT an internal subscribe,
 * D45): on activation it mints round 0's inner via `ctx.rewireNext.addDep`; each round's inner DATA
 * is forwarded; on the inner's COMPLETE (`completeWhenDepsComplete:false + terminalAsRealInput:true`)
 * it removeDep's the finished inner and, if rounds remain, addDep's a FRESH `factory()` inner (a
 * distinct node → a real net change, not the no-op same-node case); after the last round it emits
 * COMPLETE. An inner ERROR auto-forwards (errorWhenDepsError default → repeat errors). The body is
 * SELF-CATCHING (D30) and re-supplied on every rewire. The factory MUST mint a FRESH node per call
 * (a factory returning the same Node makes removeDep+addDep a net-zero no-op → repeat wedges).
 */
export function repeat<S>(factory: () => NodeInput<S>, count: number): Operator<never, S> {
	if (!Number.isInteger(count) || count < 1) {
		throw new RangeError(`repeat: count must be a positive integer (got ${count})`);
	}
	const body: NodeFn = (ctx: Ctx) => {
		try {
			const st = (ctx.state.get<RepeatState>() ?? {
				started: false,
				round: 0,
				inner: null,
			}) as RepeatState;
			// 1. forward the current inner's DATA this wave (the inner is the sole dep once wired).
			for (const r of ctx.depRecords) {
				if (r.batch && r.batch.length > 0) for (const v of r.batch) ctx.down([["DATA", v]]);
			}
			// 2. activation: mint round 0's inner.
			if (!st.started) {
				st.started = true;
				st.round = 0;
				const inner = fromAny<S>(factory(), { iter: true }) as Node<unknown>;
				st.inner = inner;
				ctx.state.set(st);
				ctx.rewireNext.addDep(inner, body);
				return;
			}
			// 3. inner COMPLETE → next round or terminal COMPLETE.
			if (st.inner !== null && ctx.depRecords[0]?.terminal === true) {
				const old = st.inner;
				ctx.rewireNext.removeDep(old, body); // bound the finished round's inner
				if (st.round + 1 < count) {
					st.round += 1;
					const next = fromAny<S>(factory(), { iter: true }) as Node<unknown>;
					st.inner = next;
					ctx.state.set(st);
					ctx.rewireNext.addDep(next, body);
				} else {
					st.inner = null;
					ctx.state.set(st);
					ctx.down([["COMPLETE"]]);
				}
			}
		} catch (e) {
			ctx.down([["ERROR", e]]); // D30 (self-catch survives rewire)
		}
	};
	return {
		factory: "repeat",
		body,
		opts: { completeWhenDepsComplete: false, terminalAsRealInput: true },
	};
}
