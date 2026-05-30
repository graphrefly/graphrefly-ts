/**
 * Operators as free-standing factory definitions (D43 / D6 / D40 Catalog-first).
 *
 * Operators are `node` sugar (D6), NOT verbs (D4) and NEVER in parity (D24). Each is a
 * pure {@link Operator} spec — `{factory, body, opts}` — built on the bare `node` primitive
 * (NOT the `derived` verb): `body` reads `ctx.depRecords` positionally and emits via
 * `ctx.down`. Two ways to instantiate:
 *
 *   - {@link initNode}(op, deps, opts?) — bare, no Graph; returns a working `Node<T>`.
 *   - `g.initNode(op, deps, opts?)` — graph-bound; the SAME call, plus inspection registration
 *     (the real factory name lands in the graph's `_entries`, so describe/observe/profile
 *     show it — D6/R-describe — while the node stays thin, R-node-thin).
 *
 * The D30 throw→ERROR boundary lives once, in the free {@link initNode} (which `g.initNode`
 * funnels through). The pure-ts `operatorOpts/partialOperatorOpts/gatedOperatorOpts` trio is
 * NOT ported: its sole job (`describeKind:"derived"`) is dead under D6/D39 (factory = the
 * REAL operator name); only the `partial`/`terminalAsRealInput` flags survive, carried
 * per-operator in `op.opts`.
 *
 * Config is folded into the factory (`map(fn)`, `scan(reducer, seed)`, `take(n)`, `merge()`),
 * so fn params are annotated where the source type can't be inferred (RxJS-pipe cost);
 * dep-type safety is recovered by the typed `g.initNode` overloads.
 */

import type { Ctx, NodeFn } from "../ctx/types.js";
import { Node, type NodeOptions } from "../node/node.js";

/**
 * A free-standing operator definition (D43). `TIn` = the element type each dep delivers
 * (the operator reads `ctx.depRecords[i].latest as TIn`); `TOut` = the emitted value type.
 * `__in`/`__out` are phantom-only (never assigned) — they let `g.initNode` infer + check the
 * dep tuple against the operator without an explicit type argument.
 */
export interface Operator<TIn = unknown, TOut = unknown> {
	/** Real operator name shown in describe (D6/L1.5) — recorded at `_add` by `g.initNode`. */
	readonly factory: string;
	/** The ctx-body: reads `ctx.depRecords` positionally, emits via `ctx.down`. */
	readonly body: (ctx: Ctx) => void;
	/** Behavioral node options the operator needs (e.g. `partial:true` for combine-family). */
	readonly opts?: Partial<NodeOptions<TOut>>;
	/** @internal phantom — never set; carries the dep element type for `g.initNode` inference. */
	readonly __in?: TIn;
	/** @internal phantom — never set; carries the output value type. */
	readonly __out?: TOut;
}

/**
 * Instantiate an operator as a bare `Node<T>` — NO Graph required (D43 bare-node path).
 * Wraps `op.body` in the D30 value-throw→ERROR boundary; merges `op.opts` with caller `opts`
 * (caller wins, so `partial`/`pool`/`dispatcher` overrides take effect). The
 * dispatcher defaults to the process-global (D26) unless `opts.dispatcher` is passed.
 *
 * `g.initNode` is the same call PLUS graph registration; graph inspection
 * (describe/observe/profile) requires that path — a node built bare here is not registered in
 * any graph's index.
 */
export function initNode<TIn, TOut>(
	op: Operator<TIn, TOut>,
	deps: readonly Node<unknown>[],
	opts: NodeOptions<TOut> = {},
): Node<TOut> {
	const body: NodeFn = (ctx) => {
		try {
			op.body(ctx);
		} catch (e) {
			ctx.down([["ERROR", e]]); // D30: value-level throw → ERROR
		}
	};
	return new Node<TOut>([...deps], body, { ...op.opts, ...opts });
}

/** map: emit fn(value). */
export function map<S, T>(fn: (v: S) => T): Operator<S, T> {
	return {
		factory: "map",
		body: (ctx) => {
			ctx.down([["DATA", fn(ctx.depRecords[0].latest as S)]]);
		},
	};
}

/** filter: emit value only when pred(value) (else skip the wave). */
export function filter<S>(pred: (v: S) => boolean): Operator<S, S> {
	return {
		factory: "filter",
		body: (ctx) => {
			const v = ctx.depRecords[0].latest as S;
			if (pred(v)) ctx.down([["DATA", v]]);
		},
	};
}

/** scan: stateful accumulator over the upstream (acc seeded once, kept in ctx.state). */
export function scan<S, T>(reducer: (acc: T, v: S) => T, seed: T): Operator<S, T> {
	return {
		factory: "scan",
		body: (ctx) => {
			const acc = ctx.state.get<T>() ?? seed;
			const next = reducer(acc, ctx.depRecords[0].latest as S);
			ctx.state.set(next);
			ctx.down([["DATA", next]]);
		},
	};
}

/** take: emit the first n values, then COMPLETE (terminal-is-forever). */
export function take<S>(n: number): Operator<S, S> {
	return {
		factory: "take",
		body: (ctx) => {
			if (n <= 0) {
				ctx.down([["COMPLETE"]]);
				return;
			}
			const count = ctx.state.get<number>() ?? 0;
			if (count >= n) return; // already satisfied
			const v = ctx.depRecords[0].latest as S;
			const next = count + 1;
			ctx.state.set(next);
			ctx.down(next >= n ? [["DATA", v], ["COMPLETE"]] : [["DATA", v]]);
		},
	};
}

/** distinctUntilChanged: emit only when the value differs from the previous emit. */
export function distinctUntilChanged<S>(eq: (a: S, b: S) => boolean = Object.is): Operator<S, S> {
	return {
		factory: "distinctUntilChanged",
		body: (ctx) => {
			const v = ctx.depRecords[0].latest as S;
			const prev = ctx.state.get<{ v: S }>();
			if (prev && eq(prev.v, v)) return;
			ctx.state.set({ v });
			ctx.down([["DATA", v]]);
		},
	};
}

/**
 * merge: interleave several sources — emit each DATA from whichever dep fired. `partial:true`
 * (combine-family): fires on any single dep, not gated on all deps settling.
 */
export function merge<T>(): Operator<T, T> {
	return {
		factory: "merge",
		opts: { partial: true },
		body: (ctx) => {
			for (const r of ctx.depRecords) {
				if (r.batch && r.batch.length > 0) {
					for (const v of r.batch) ctx.down([["DATA", v]]);
				}
			}
		},
	};
}
