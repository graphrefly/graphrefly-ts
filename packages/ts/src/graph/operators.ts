/**
 * Operators as free-standing factory definitions (D43 / D6 / D40 Catalog-first).
 *
 * Operators are `node` sugar (D6), NOT verbs (D4) and NEVER in parity (D24). Each is a
 * pure {@link Operator} spec — `{factory, body, opts}` — built on the bare `node` primitive
 * (NOT the `derived` verb): `body` reads ctx dep slots positionally and emits via
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

import {
	type Ctx,
	depBatch,
	depCount,
	depLatest,
	depTerminal,
	isTerminalComplete,
	isTerminalError,
	type NodeFn,
	terminalErrorValue,
} from "../ctx/types.js";
import type { NodeCore } from "../node/core.js";
import { Node, type NodeOptions, withNodeCore } from "../node/node.js";
import { errorPayload } from "../protocol/messages.js";
import { type GraphCheckpointJson, toCheckpointJson } from "./checkpoint.js";
import type { GraphRestoreDefinition, GraphRestoreEntry, GraphRestoreRegistry } from "./restore.js";

/**
 * A free-standing operator definition (D43). `TIn` = the element type each dep delivers
 * (the operator reads `depLatest(ctx, i) as TIn`); `TOut` = the emitted value type.
 * `__in`/`__out` are phantom-only (never assigned) — they let `g.initNode` infer + check the
 * dep tuple against the operator without an explicit type argument.
 */
export interface Operator<TIn = unknown, TOut = unknown> {
	/** Real operator name shown in describe (D6/L1.5) — recorded at `_add` by `g.initNode`. */
	readonly factory: string;
	/** The ctx-body: reads ctx dep slots positionally, emits via `ctx.down`. */
	readonly body: (ctx: Ctx) => void;
	/** Behavioral node options the operator needs (e.g. `partial:true` for combine-family). */
	readonly opts?: Partial<NodeOptions<TOut>>;
	/**
	 * D97/D100 restore metadata derived from a named definition or static built-in config.
	 * This is semantic metadata only; dispatcher handles stay graph-local runtime state.
	 */
	readonly restore?: {
		ref: string;
		config?: GraphCheckpointJson;
		configVersion?: GraphCheckpointJson;
	};
	/** @internal phantom — never set; carries the dep element type for `g.initNode` inference. */
	readonly __in?: TIn;
	/** @internal phantom — never set; carries the output value type. */
	readonly __out?: TOut;
}

type MutableRestoreRegistry = Map<string, GraphRestoreEntry> | Record<string, GraphRestoreEntry>;

export type RestoreRegistryEntry = GraphRestoreEntry;

export interface Definition<S = unknown, T = unknown> extends GraphRestoreDefinition<S, T> {
	readonly ref: string;
	readonly fn: (v: S) => T;
}

export interface DefineOpts {
	registry?: MutableRestoreRegistry;
}

function registryHas(registry: MutableRestoreRegistry, ref: string): boolean {
	return registry instanceof Map ? registry.has(ref) : Object.hasOwn(registry, ref);
}

function registrySet(
	registry: MutableRestoreRegistry,
	ref: string,
	entry: GraphRestoreEntry,
): void {
	if (registryHas(registry, ref)) {
		throw new Error(`restoreRegistry: duplicate ref '${ref}'`);
	}
	if (registry instanceof Map) registry.set(ref, entry);
	else registry[ref] = entry;
}

export function addToRestoreRegistry(
	registry: MutableRestoreRegistry,
	entry: GraphRestoreEntry,
): void {
	registrySet(registry, entry.ref, entry);
}

export function restoreRegistry(
	entries: readonly GraphRestoreEntry[] = [],
	base?: GraphRestoreRegistry,
): Map<string, GraphRestoreEntry> {
	const out = new Map<string, GraphRestoreEntry>();
	if (base instanceof Map) {
		for (const [ref, entry] of base) registrySet(out, ref, entry);
	} else if (base !== undefined) {
		for (const [ref, entry] of Object.entries(base)) registrySet(out, ref, entry);
	}
	for (const entry of entries) addToRestoreRegistry(out, entry);
	return out;
}

function isDefinition<S, T>(fn: ((v: S) => T) | Definition<S, T>): fn is Definition<S, T> {
	return typeof fn === "object" && fn !== null && (fn as Definition<S, T>).kind === "definition";
}

export function define<S, T>(
	ref: string,
	fn: (v: S) => T,
	opts: DefineOpts = {},
): Definition<S, T> {
	const jsonRef = toCheckpointJson(ref, "define.ref");
	if (typeof jsonRef !== "string") throw new TypeError("define: ref must be a string");
	const definition: Definition<S, T> = {
		kind: "definition",
		ref: jsonRef,
		fn,
	};
	if (opts.registry !== undefined) addToRestoreRegistry(opts.registry, definition);
	return definition;
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
	return makeInitNode(op, deps, opts);
}

/** @internal Graph-bound operator instantiation into a graph-local B49 core. */
export function initNodeWithCore<TIn, TOut>(
	core: NodeCore,
	op: Operator<TIn, TOut>,
	deps: readonly Node<unknown>[],
	opts: NodeOptions<TOut> = {},
): Node<TOut> {
	return withNodeCore(core, () => makeInitNode(op, deps, opts));
}

function makeInitNode<TIn, TOut>(
	op: Operator<TIn, TOut>,
	deps: readonly Node<unknown>[],
	opts: NodeOptions<TOut>,
): Node<TOut> {
	const body = operatorNodeFn(op);
	// D43-reserved / D51: stamp the operator's real factory onto the bare node so a runtime *Map
	// inner (created here via fromAny, NOT registered in any graph) is named in describe's
	// auto-discovery. A graph-bound g.initNode also records it in `_entries` (entry.factory wins
	// there); this field is only read for a node absent from the graph index. Caller opts win.
	return new Node<TOut>([...deps], body, { factory: op.factory, ...op.opts, ...opts });
}

/** @internal Build the dispatcher body for an Operator spec. */
export function operatorNodeFn<TIn, TOut>(op: Operator<TIn, TOut>): NodeFn {
	return (ctx) => {
		try {
			op.body(ctx);
		} catch (e) {
			ctx.down([["ERROR", errorPayload(e, "operator threw without a valid error payload")]]); // D30: value-level throw → ERROR
		}
	};
}

// ── Slice 1 — single-dep map / take / control (CSP-2.7 catalog re-derive, D40) ──
// All read dep 0 positionally + emit via ctx.down. Under D49 every occurrence is DATA (no
// equals-absorption); a body that returns WITHOUT emitting gets a substrate-synthesized undirty
// RESOLVED (R-resolved-undirty) — so a "skip this wave" is a bare `return`. Terminal-emitting
// operators (reduce/last/find/elementAt) read `depTerminal(ctx, 0)` via the
// `completeWhenDepsComplete:false + terminalAsRealInput:true` flags (R-deps-terminal): the fn fires
// on the source's COMPLETE and emits its final value. NOT 1:1 pure-ts ports — the frozen reference
// (D41) uses a producer + internal `subscribeOr`, the D45-banned describe island; these are
// declared-dep nodes whose single edge `describe` shows truthfully.

/** map: emit fn(value). A named {@link define} makes the map restorable via the map descriptor (D101). */
export function map<S, T>(fn: ((v: S) => T) | Definition<S, T>): Operator<S, T> {
	if (isDefinition(fn)) {
		return mapFromFunction(fn.fn, {
			ref: "map",
			config: { fn: toCheckpointJson(fn.ref, `map.fn`) },
		});
	}
	return mapFromFunction(fn);
}

function mapFromFunction<S, T>(
	fn: (v: S) => T,
	restore?: {
		ref: string;
		config?: GraphCheckpointJson;
		configVersion?: GraphCheckpointJson;
	},
): Operator<S, T> {
	return {
		factory: "map",
		...(restore ? { restore } : {}),
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (!b) return;
			for (const v of b) ctx.down([["DATA", fn(v as S)]]);
		},
	};
}

/** filter: emit value only when pred(value) (else skip the wave). */
export function filter<S>(pred: (v: S) => boolean): Operator<S, S> {
	return {
		factory: "filter",
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (!b) return;
			for (const v of b) if (pred(v as S)) ctx.down([["DATA", v]]);
		},
	};
}

/** scan: stateful accumulator over the upstream (acc seeded once, kept in ctx.state). */
export function scan<S, T>(reducer: (acc: T, v: S) => T, seed: T): Operator<S, T> {
	return {
		factory: "scan",
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (!b) return;
			let acc = ctx.state.get<T>() ?? seed;
			for (const v of b) {
				acc = reducer(acc, v as S);
				ctx.down([["DATA", acc]]);
			}
			ctx.state.set(acc);
		},
	};
}

/** take: emit the first n values, then COMPLETE (terminal-is-forever). */
export function take<S>(n: number): Operator<S, S> {
	return {
		factory: "take",
		restore: { ref: "take", config: { n: toCheckpointJson(n, "take.n") } },
		body: (ctx) => {
			if (n <= 0) {
				ctx.down([["COMPLETE"]]);
				return;
			}
			const b = depBatch(ctx, 0);
			if (!b) return;
			let count = ctx.state.get<number>() ?? 0;
			if (count >= n) return; // already satisfied
			for (const v of b) {
				if (count >= n) break;
				count += 1;
				ctx.down(count >= n ? [["DATA", v], ["COMPLETE"]] : [["DATA", v]]);
			}
			ctx.state.set(count);
		},
	};
}

/** distinctUntilChanged: emit only when the value differs from the previous emit. */
export function distinctUntilChanged<S>(eq: (a: S, b: S) => boolean = Object.is): Operator<S, S> {
	return {
		factory: "distinctUntilChanged",
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (!b) return;
			const prev = ctx.state.get<{ v: S }>();
			let last = prev?.v;
			let hasLast = prev !== undefined;
			for (const v of b as readonly S[]) {
				if (hasLast && eq(last as S, v)) continue;
				last = v;
				hasLast = true;
				ctx.down([["DATA", v]]);
			}
			if (hasLast) ctx.state.set({ v: last as S });
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
			for (let i = 0; i < depCount(ctx); i++) {
				const b = depBatch(ctx, i);
				if (b && b.length > 0) {
					for (const v of b) ctx.down([["DATA", v]]);
				}
			}
		},
	};
}

/**
 * reduce: accumulate over the whole source, emit ONE final value on the source's COMPLETE
 * (RxJS `reduce`). Unlike {@link scan} (which emits every step), reduce stays quiet until the
 * source terminates. `completeWhenDepsComplete:false + terminalAsRealInput:true`: the fn fires on
 * the source COMPLETE (reading `terminal===true`) and emits the accumulator + COMPLETE. An empty
 * source emits the seed (RxJS parity). A source ERROR auto-forwards (errorWhenDepsError default).
 */
export function reduce<S, T>(reducer: (acc: T, v: S) => T, seed: T): Operator<S, T> {
	return {
		factory: "reduce",
		opts: { completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			let acc = ctx.state.get<T>() ?? seed;
			if (b) for (const v of b) acc = reducer(acc, v as S);
			ctx.state.set(acc);
			if (isTerminalComplete(depTerminal(ctx, 0))) ctx.down([["DATA", acc], ["COMPLETE"]]);
			// else (live DATA wave): no emit → substrate-synthesized undirty RESOLVED (D49).
		},
	};
}

/**
 * pairwise: emit `[previous, current]` for each consecutive pair; the very first value produces no
 * pair (quiet → undirty RESOLVED). Previous value is kept in `ctx.state`.
 */
export function pairwise<S>(): Operator<S, readonly [S, S]> {
	return {
		factory: "pairwise",
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (!b) return;
			const st = ctx.state.get<{ prev: S }>();
			let prev = st?.prev;
			let hasPrev = st !== undefined;
			for (const v of b as readonly S[]) {
				if (hasPrev) ctx.down([["DATA", [prev as S, v] as const]]);
				prev = v;
				hasPrev = true;
			}
			if (hasPrev) ctx.state.set({ prev: prev as S });
		},
	};
}

/** skip: drop the first `n` DATA values, then pass the rest through. */
export function skip<S>(n: number): Operator<S, S> {
	return {
		factory: "skip",
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (!b) return;
			let count = ctx.state.get<number>() ?? 0;
			for (const v of b) {
				if (count < n) {
					count += 1;
					continue;
				}
				ctx.down([["DATA", v]]);
			}
			ctx.state.set(count);
		},
	};
}

/**
 * takeWhile: emit values while `pred` holds; on the first value that fails `pred`, COMPLETE
 * WITHOUT emitting it (RxJS default, non-inclusive). Terminal-is-forever once it completes.
 */
export function takeWhile<S>(pred: (v: S) => boolean): Operator<S, S> {
	return {
		factory: "takeWhile",
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (!b) return;
			for (const v of b as readonly S[]) {
				if (pred(v)) ctx.down([["DATA", v]]);
				else {
					ctx.down([["COMPLETE"]]);
					return;
				}
			}
		},
	};
}

/**
 * first: emit the first value matching `pred` (or simply the first value), then COMPLETE. EDGE
 * (RxJS divergence, flagged — same class as last/find/elementAt): if the source COMPLETEs with no
 * matching value, the substrate auto-cascades a bare COMPLETE (no value); RxJS `first()` throws
 * EmptyError. Could align to `[[ERROR, EmptyError]]` (expressible) if strict RxJS parity is wanted.
 */
export function first<S>(pred?: (v: S) => boolean): Operator<S, S> {
	return {
		factory: "first",
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (!b) return;
			for (const v of b as readonly S[]) {
				if (!pred || pred(v)) {
					ctx.down([["DATA", v], ["COMPLETE"]]);
					return;
				}
			}
			// no match in this wave → undirty RESOLVED (await next match)
		},
	};
}

/**
 * last: emit the last value matching `pred` (or the last value) on the source's COMPLETE.
 * `completeWhenDepsComplete:false + terminalAsRealInput:true`. EDGE (RxJS divergence, flagged):
 * RxJS `last()` throws EmptyError when no value matched; we COMPLETE without a value (no throw) —
 * the clean-slate substrate has no "complete-or-throw" terminal and SENTINEL forbids emitting a
 * placeholder.
 */
export function last<S>(pred?: (v: S) => boolean): Operator<S, S> {
	return {
		factory: "last",
		opts: { completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (b) for (const v of b) if (!pred || pred(v as S)) ctx.state.set({ v });
			if (isTerminalComplete(depTerminal(ctx, 0))) {
				const st = ctx.state.get<{ v: S }>();
				ctx.down(st ? [["DATA", st.v], ["COMPLETE"]] : [["COMPLETE"]]);
			}
		},
	};
}

/**
 * find: emit the first value matching `pred`, then COMPLETE. EDGE (RxJS divergence, flagged): RxJS
 * `find` emits `undefined` then COMPLETE when nothing matched — but `undefined` IS the SENTINEL
 * (R-sentinel), so a not-found source COMPLETE here emits a bare COMPLETE (no value).
 */
export function find<S>(pred: (v: S) => boolean): Operator<S, S> {
	return {
		factory: "find",
		opts: { completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (b) {
				for (const v of b) {
					if (pred(v as S)) {
						ctx.down([["DATA", v], ["COMPLETE"]]);
						return;
					}
				}
			}
			if (isTerminalComplete(depTerminal(ctx, 0))) ctx.down([["COMPLETE"]]); // not found → bare COMPLETE
		},
	};
}

/**
 * elementAt: emit the value at zero-based `index`, then COMPLETE. EDGE (RxJS divergence, flagged):
 * RxJS throws ArgumentOutOfRangeError if the source completes before `index`; we COMPLETE without
 * a value (no throw), consistent with last/find.
 */
export function elementAt<S>(index: number): Operator<S, S> {
	return {
		factory: "elementAt",
		opts: { completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			let count = ctx.state.get<number>() ?? 0;
			if (b) {
				for (const v of b) {
					if (count === index) {
						ctx.down([["DATA", v], ["COMPLETE"]]);
						return;
					}
					count++;
				}
				ctx.state.set(count);
			}
			if (isTerminalComplete(depTerminal(ctx, 0))) ctx.down([["COMPLETE"]]); // index out of range → bare COMPLETE
		},
	};
}

/** Observer object for {@link tap} — lifecycle-aware side effects (RxJS tap observer form). */
export interface TapObserver<T> {
	data?: (value: T) => void;
	error?: (err: unknown) => void;
	complete?: () => void;
}

/**
 * tap: invoke a side effect on each DATA (function form) or on data/error/complete (observer form);
 * values pass through unchanged. The observer form reads source terminals
 * (`completeWhenDepsComplete:false + errorWhenDepsError:false + terminalAsRealInput:true`) so it can
 * call `error`/`complete` then forward the terminal; the function form lets the substrate
 * auto-cascade terminals.
 */
export function tap<S>(fnOrObserver: ((v: S) => void) | TapObserver<S>): Operator<S, S> {
	if (typeof fnOrObserver === "function") {
		const fn = fnOrObserver;
		return {
			factory: "tap",
			body: (ctx) => {
				const b = depBatch(ctx, 0);
				if (b)
					for (const v of b) {
						fn(v as S);
						ctx.down([["DATA", v]]);
					}
			},
		};
	}
	const obs = fnOrObserver;
	return {
		factory: "tap",
		opts: {
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			terminalAsRealInput: true,
		},
		body: (ctx) => {
			const terminal = depTerminal(ctx, 0);
			if (isTerminalComplete(terminal)) {
				obs.complete?.();
				ctx.down([["COMPLETE"]]);
				return;
			}
			if (isTerminalError(terminal)) {
				const err = terminalErrorValue(terminal);
				obs.error?.(err);
				ctx.down([["ERROR", err]]);
				return;
			}
			const b = depBatch(ctx, 0);
			if (b)
				for (const v of b) {
					obs.data?.(v as S);
					ctx.down([["DATA", v]]);
				}
		},
	};
}

/**
 * onFirstData (alias `tapFirst`): invoke `fn` exactly once on the first qualifying value (default
 * `where: v => v != null` — null/undefined pass through without counting as "first"), then pass all
 * values through unchanged. The one-shot guard is per-node `ctx.state` (NOT a factory closure, so a
 * second instantiation of the same factory re-arms — R-ctx-state).
 */
export function onFirstData<S>(
	fn: (v: S) => void,
	opts?: { where?: (v: S) => boolean },
): Operator<S, S> {
	const where = opts?.where ?? ((v: S) => v != null);
	return {
		factory: "onFirstData",
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			if (!b) return;
			let fired = ctx.state.get<boolean>() ?? false;
			for (const v of b) {
				if (!fired && where(v as S)) {
					fired = true;
					fn(v as S);
				}
				ctx.down([["DATA", v]]);
			}
			ctx.state.set(fired);
		},
	};
}

/** tapFirst: alias of {@link onFirstData} (the one-shot companion to {@link tap}). */
export const tapFirst = onFirstData;

/** Options for {@link settle}. */
export interface SettleOpts<S> {
	/** Consecutive no-change waves before declaring convergence + COMPLETE. */
	quietWaves: number;
	/** Optional hard cap on total waves before forced COMPLETE. */
	maxWaves?: number;
	/** Optional comparator; a DATA equal to the previous one does NOT reset the quiet counter. */
	equals?: (a: S, b: S) => boolean;
}

/** Internal settle accumulator state (per-node, R-ctx-state). */
interface SettleState<S> {
	last: S | undefined;
	hasValue: boolean;
	quiet: number;
	waves: number;
	done: boolean;
}

/**
 * settle: forward each DATA unchanged, watch for convergence, COMPLETE once the source has been
 * quiet for `quietWaves` consecutive waves (or `maxWaves` elapsed). "Wave" = one fn invocation
 * (a DATA batch OR a bare undirty RESOLVED end-of-wave). No polling (R-no-polling) — the counter
 * advances only on real upstream waves. `settle`'s own `equals` is a body comparator, NOT the
 * removed substrate `equals` (D49).
 */
export function settle<S>(opts: SettleOpts<S>): Operator<S, S> {
	const { quietWaves, maxWaves, equals } = opts;
	if (!Number.isInteger(quietWaves) || quietWaves < 1) {
		throw new RangeError(`settle: quietWaves must be a positive integer (got ${quietWaves})`);
	}
	if (maxWaves != null && (!Number.isInteger(maxWaves) || maxWaves < 1)) {
		throw new RangeError(`settle: maxWaves must be a positive integer when set (got ${maxWaves})`);
	}
	return {
		factory: "settle",
		body: (ctx) => {
			const st: SettleState<S> = ctx.state.get<SettleState<S>>() ?? {
				last: undefined,
				hasValue: false,
				quiet: 0,
				waves: 0,
				done: false,
			};
			if (st.done) return;
			st.waves++;
			const b = depBatch(ctx, 0);
			let sawChange = false;
			if (b && b.length > 0) {
				for (const v of b) {
					const next = v as S;
					const isChange = !st.hasValue || equals == null || !equals(st.last as S, next);
					if (isChange) sawChange = true;
					st.last = next;
					st.hasValue = true;
					ctx.down([["DATA", next]]);
				}
			}
			st.quiet = sawChange ? 0 : st.quiet + 1;
			const settled = st.hasValue && st.quiet >= quietWaves;
			const exhausted = maxWaves != null && st.waves >= maxWaves;
			if (settled || exhausted) {
				st.done = true;
				ctx.state.set(st);
				ctx.down([["COMPLETE"]]);
				return;
			}
			ctx.state.set(st);
			// A no-DATA wave that didn't converge → bare undirty RESOLVED is synthesized by the
			// substrate (D49); nothing to emit here.
		},
	};
}

// ── Slice 3 — error-handling control (CSP-2.7, D40) ──
// rescue/catchError ABSORB the source ERROR (errorWhenDepsError:false) and read the error payload
// from `depTerminal(ctx, 0)` (R-deps-terminal). They set completeWhenDepsComplete:false so a
// normal source COMPLETE is forwarded explicitly — which ALSO sidesteps B40 (the
// completeWhenDepsComplete:true × absorbed-errored-dep auto-complete gap): there is no auto-complete
// to block. valve is a [source, control] gate (state-verb-legitimate control input).

/**
 * rescue (alias `catchError`): replace an upstream ERROR with a recovered value. On source DATA →
 * forward; on source ERROR → emit `recover(err)` as DATA (if `recover` throws, forward THAT as
 * ERROR); on source COMPLETE → COMPLETE. After recovery the source is terminal-errored (dead) so no
 * further values flow — the recovered value is the final cached value (matches the frozen pure-ts
 * reference; it does NOT auto-COMPLETE, RxJS-`catchError(()=>of(x))` divergence, flagged).
 */
export function rescue<S>(recover: (err: unknown) => S): Operator<S, S> {
	return {
		factory: "rescue",
		opts: {
			errorWhenDepsError: false,
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		},
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			const terminal = depTerminal(ctx, 0);
			if (b) for (const v of b) ctx.down([["DATA", v]]);
			if (isTerminalComplete(terminal)) {
				ctx.down([["COMPLETE"]]);
			} else if (isTerminalError(terminal)) {
				// ERROR payload absorbed → recover.
				try {
					ctx.down([["DATA", recover(terminalErrorValue(terminal))]]);
				} catch (e) {
					ctx.down([["ERROR", errorPayload(e, "rescue threw without a valid error payload")]]);
				}
			}
		},
	};
}

/** catchError: RxJS-named alias of {@link rescue}. */
export const catchError = rescue;

/** Options for {@link valve}. */
export interface ValveOpts {
	/**
	 * Optional AbortController (or a `() => AbortController | undefined` factory): on the control's
	 * truthy→falsy edge, `valve` calls `controller.abort()` — cancel an in-flight async boundary
	 * (LLM/fetch) the caller threaded `controller.signal` into. An external-resource cleanup (like
	 * `ctx.onDeactivation`), NOT an imperative reactive trigger (R-no-imperative).
	 */
	abortInFlight?: AbortController | (() => AbortController | undefined);
}

/**
 * valve: forward the source's DATA only while `control` (dep 1) is truthy; when closed, stay quiet
 * (undirty RESOLVED). `[source, control]` declared deps + `partial:true` (the control wave can fire
 * before the source ever delivers). `completeWhenDepsComplete:false` — closing the gate (control
 * terminating) does NOT complete the valve; only the SOURCE's terminal (read via
 * `terminalAsRealInput`) is forwarded. The `state`-verb control input is a legitimate external
 * boundary (D4 / D54), not a forbidden imperative trigger.
 */
export function valve<S>(opts?: ValveOpts): Operator<S, S> {
	const abortInFlight = opts?.abortInFlight;
	return {
		factory: "valve",
		opts: { partial: true, completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const srcBatch = depBatch(ctx, 0);
			const ctlBatch = depBatch(ctx, 1);
			const srcTerminal = depTerminal(ctx, 0);
			const controlValue = depLatest(ctx, 1) as boolean | undefined;

			if (abortInFlight != null) {
				// Fire abort on the truthy→falsy edge only (never on activation / no prior state).
				const prev = ctx.state.get<{ ctl: boolean | undefined }>();
				if (prev?.ctl === true && !controlValue) {
					const c = typeof abortInFlight === "function" ? abortInFlight() : abortInFlight;
					c?.abort();
				}
				ctx.state.set({
					ctl: controlValue === true ? true : controlValue == null ? undefined : false,
				});
			}

			// Source terminal forwarding (control terminal is absorbed by completeWhenDepsComplete:false).
			if (isTerminalComplete(srcTerminal)) {
				ctx.down([["COMPLETE"]]);
				return;
			}
			if (isTerminalError(srcTerminal)) {
				ctx.down([["ERROR", terminalErrorValue(srcTerminal)]]);
				return;
			}

			if (!controlValue) return; // gate closed → quiet (undirty RESOLVED)

			if (srcBatch && srcBatch.length > 0) {
				for (const v of srcBatch) ctx.down([["DATA", v]]);
				return;
			}
			// Gate just opened this wave (control fired, source didn't): re-emit the last source value.
			const srcLatest = depLatest(ctx, 0);
			if (ctlBatch && ctlBatch.length > 0 && srcLatest !== undefined) {
				ctx.down([["DATA", srcLatest as S]]);
			}
		},
	};
}
