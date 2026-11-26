/**
 * A runner for the root's canonical operator traces (graphrefly operators/traces.jsonl), written
 * from operators/README.md "Running the traces in a package" (graphrefly:B150), for
 * graphrefly-ts:D191 (6). Test-only: nothing here is exported by the package.
 *
 * The runner builds each trace's nodes on one graph with the TS operators, runs its steps, and
 * compares what each sink received, receiver by receiver. It gives the operators a clock it owns
 * (the caller installs vitest fake timers; see report.trace.ts) and a registry for a `restore`
 * step, under which every node of a trace is rebuilt from its op and args.
 */
import { vi } from "vitest";
import { type Operator, operatorNodeFn } from "../../graph/operators.js";
import type { Ctx, NodeFn } from "../../index.js";
import {
	auditTime,
	buffer,
	bufferCount,
	bufferTime,
	concat,
	concatMap,
	debounce,
	delay,
	distinctUntilChanged,
	exhaustMap,
	filter,
	first,
	type Graph,
	type GraphRestoreEntry,
	graph,
	last,
	type Message,
	map,
	merge,
	mergeMap,
	type Node,
	pairwise,
	race,
	reduce,
	restoreGraph,
	type StateNode,
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
	valve,
	withLatestFrom,
	zip,
} from "../../index.js";

export type Wave = readonly Message[];

export interface TraceNode {
	readonly id: string;
	readonly state?: readonly unknown[];
	readonly op?: string;
	readonly deps?: readonly string[];
	readonly args?: Readonly<Record<string, unknown>>;
}

export type Step = readonly [string, ...unknown[]];

export interface Trace {
	readonly id: string;
	readonly name: string;
	readonly detail: string;
	readonly nodes: readonly TraceNode[];
	readonly steps: readonly Step[];
	readonly expect: readonly (readonly (readonly [string, string, Wave])[])[];
	readonly succeeded_by?: string;
}

/** The three not-run reasons of the README; anything else is a fail. */
export type NotRunReason = "operator-not-shipped" | "value-not-carried" | "step-not-taken";

/**
 * How a fail is classified for the baseline (graphrefly-ts:D191 (6)), not diagnosed:
 * framing: every step's DATA, INVALIDATE and terminals match, the arrays around them do not;
 * behavior: the occurrences themselves differ;
 * error: the runner hit a TS refusal or throw building the trace or at a restore;
 * refused: the trace or a step is one the runner cannot take as written, or TS's operator
 * cannot take it (such as a number of dependencies it does not take).
 */
export type FailClass = "framing" | "behavior" | "error" | "refused";

export type TraceResult =
	| { readonly id: string; readonly result: "pass" }
	| {
			readonly id: string;
			readonly result: "fail";
			readonly class: FailClass;
			readonly step?: number;
			readonly detail: string;
	  }
	| {
			readonly id: string;
			readonly result: "not-run";
			readonly reason: NotRunReason;
			readonly detail: string;
	  };

// ---------------------------------------------------------------------------------------------
// The table of operators/README.md: what each node kind takes.

type Arity = number | "1+" | "2+";
interface OpSpec {
	readonly deps: Arity;
	readonly args: readonly string[];
	readonly optional?: readonly string[];
	/** The callback keys, beside which a node takes the callback options. */
	readonly callbacks?: readonly string[];
}

const TABLE: Readonly<Record<string, OpSpec>> = {
	map: { deps: 1, args: ["f"], callbacks: ["f"] },
	tap: { deps: 1, args: ["f"], callbacks: ["f"] },
	filter: { deps: 1, args: ["p"], callbacks: ["p"] },
	takeWhile: { deps: 1, args: ["p"], callbacks: ["p"] },
	first: { deps: 1, args: [], optional: ["p"], callbacks: ["p"] },
	last: { deps: 1, args: [], optional: ["p"], callbacks: ["p"] },
	distinctUntilChanged: { deps: 1, args: [], optional: ["equal"], callbacks: ["equal"] },
	scan: { deps: 1, args: ["f", "seed"], callbacks: ["f"] },
	reduce: { deps: 1, args: ["f", "seed"], callbacks: ["f"] },
	pairwise: { deps: 1, args: [] },
	take: { deps: 1, args: ["n"] },
	skip: { deps: 1, args: ["n"] },
	bufferCount: { deps: 1, args: ["n"] },
	sample: { deps: 2, args: [] },
	takeUntil: { deps: 2, args: [] },
	buffer: { deps: 2, args: [] },
	valve: { deps: 2, args: [] },
	pause: { deps: 2, args: [] },
	withLatestFrom: { deps: "2+", args: [] },
	merge: { deps: "1+", args: [] },
	zip: { deps: "1+", args: [] },
	concat: { deps: "1+", args: [] },
	race: { deps: "1+", args: [] },
	derived: { deps: "1+", args: ["f"], callbacks: ["f"] },
	switchMap: { deps: 1, args: ["project"], callbacks: ["project"] },
	concatMap: { deps: 1, args: ["project"], callbacks: ["project"] },
	exhaustMap: { deps: 1, args: ["project"], callbacks: ["project"] },
	mergeMap: { deps: 1, args: ["project"], optional: ["capacity"], callbacks: ["project"] },
	debounce: { deps: 1, args: ["ms"] },
	throttle: { deps: 1, args: ["ms"] },
	auditTime: { deps: 1, args: ["ms"] },
	delay: { deps: 1, args: ["ms"] },
	bufferTime: { deps: 1, args: ["ms"] },
	timeout: { deps: 1, args: ["ms"] },
	latestAsync: { deps: 1, args: ["f"], callbacks: ["f"] },
	catchError: { deps: 1, args: ["handler", "to"], callbacks: ["handler"] },
	retry: {
		deps: "1+",
		args: ["of"],
		optional: ["maxAttempts", "initialMs", "factor", "maxMs"],
	},
	repeat: { deps: "1+", args: ["of"], optional: ["rounds", "retry"] },
	arrays: { deps: 1, args: [] },
	empty: { deps: 0, args: [] },
	once: { deps: 0, args: ["value"] },
};

/** The contracts' operators: the table without its three input-shaping kinds. */
export const CONTRACT_OPERATORS: readonly string[] = Object.keys(TABLE).filter(
	(op) => !["arrays", "empty", "once"].includes(op),
);

/** Options a callback takes, per the README's "Named callbacks". */
const CALLBACK_OPTIONS: Readonly<Record<string, readonly string[]>> = {
	f: ["into", "invalidates", "returns", "throwsOn", "nothingOn", "aborts"],
	p: ["into", "invalidates", "returns", "throwsOn", "nothingOn"],
	equal: ["into", "invalidates", "returns", "throwsOn", "nothingOn"],
	project: ["into", "throwsOn", "returnsOn"],
	handler: ["into", "throwsOn", "returnsOn"],
};

const CALLBACK_NAMES: Readonly<Record<string, readonly string[]>> = {
	f: ["double", "sum", "append", "tuple", "record", "job"],
	p: ["even", "small"],
	equal: ["atMost", "always"],
	project: ["follow"],
	handler: ["follow"],
};

/**
 * The contracts' operators TS does not ship. The report lists the ones it ships, once
 * (operators/README.md, root 313300e). An operator of TS that has a contract's name and is not
 * listed is named in the report as not the contract's.
 */
export const NOT_SHIPPED: Readonly<Record<string, string>> = {
	pause: "TS has no pause operator (the R-pause module of graphrefly:D828 is not ported yet)",
	retry: "TS has no retry operator (only retry-policy helpers in graph/resilience.ts)",
	catchError: "TS has no catchError (it ships rescue, which DS-20 dropped)",
	latestAsync: "TS has no latestAsync",
	repeat: "TS has no repeat of the contract's shape",
};

/** TS operators that have a contract's name and are not the contract's. */
export const NOT_THE_CONTRACTS: Readonly<Record<string, string>> = {
	repeat:
		"TS's repeat(factory, count) builds its inner from a factory, where the contract's repeats an inner `of` over its dependencies with rounds and a retry policy",
};

class Refused extends Error {}

/** The runner's own error, thrown by a callback made to throw (README). */
export class TraceCallbackError extends Error {
	constructor(value: unknown) {
		super(`trace callback threw on ${JSON.stringify(value)}`);
	}
}

function arityOk(arity: Arity, n: number): boolean {
	if (arity === "1+") return n >= 1;
	if (arity === "2+") return n >= 2;
	return n === arity;
}

/** Refuse a trace the runner cannot take as written (README "A runner refuses"). */
export function checkTrace(trace: Trace): void {
	const ids = new Set<string>();
	for (const node of trace.nodes) {
		for (const key of Object.keys(node)) {
			if (!["id", "state", "op", "deps", "args"].includes(key)) {
				throw new Refused(`node ${node.id}: key ${key}`);
			}
		}
		ids.add(node.id);
		if (node.op === undefined) continue;
		const spec = TABLE[node.op];
		if (spec === undefined) throw new Refused(`node ${node.id}: op ${node.op}`);
		if (!arityOk(spec.deps, node.deps?.length ?? 0)) {
			throw new Refused(`node ${node.id}: ${node.deps?.length ?? 0} dependencies for ${node.op}`);
		}
		const args = node.args ?? {};
		const allowed = new Set([...spec.args, ...(spec.optional ?? [])]);
		for (const cb of spec.callbacks ?? [])
			for (const o of CALLBACK_OPTIONS[cb] ?? []) allowed.add(o);
		for (const key of Object.keys(args)) {
			if (!allowed.has(key)) throw new Refused(`node ${node.id}: option ${key} for ${node.op}`);
		}
		for (const key of spec.args) {
			if (!(key in args)) throw new Refused(`node ${node.id}: missing ${key} for ${node.op}`);
		}
		for (const cb of spec.callbacks ?? []) {
			const name = args[cb];
			if (name === undefined) continue;
			if (!(CALLBACK_NAMES[cb] ?? []).includes(name as string)) {
				throw new Refused(`node ${node.id}: callback ${String(name)} for ${cb}`);
			}
		}
	}
	const subscribed = new Set<string>();
	const walk = (steps: readonly Step[], inBatch: boolean) => {
		for (const step of steps) {
			const [kind] = step;
			if (inBatch && ["advance", "restore", "resolve", "reject"].includes(kind)) {
				throw new Refused(`a batch holds ${kind}`);
			}
			if (kind === "subscribe") subscribed.add(`${step[1]}\u0000${step[2]}`);
			if (kind === "unsubscribe" && !subscribed.has(`${step[1]}\u0000${step[2]}`)) {
				throw new Refused(
					`unsubscribe of ${String(step[1])} from ${String(step[2])} never subscribed`,
				);
			}
			if (kind === "replace") {
				const target = trace.nodes.find((n) => n.id === step[1]);
				if (target?.op === undefined || ["arrays", "empty", "once"].includes(target.op)) {
					throw new Refused(`replace of ${String(step[1])}, not an operator node`);
				}
			}
			if (kind === "batch") walk(step[1] as readonly Step[], true);
		}
	};
	walk(trace.steps, false);
}

// ---------------------------------------------------------------------------------------------
// Callbacks.

function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

interface Env {
	/** The graph the trace currently runs on (it changes at a restore). */
	readonly graph: () => Graph;
}

function stateOf(env: Env, id: string): StateNode<unknown> {
	const node = env.graph().find(id);
	if (node === undefined) throw new Error(`trace: no node ${id}`);
	return node as unknown as StateNode<unknown>;
}

const BASE: Readonly<Record<string, (...xs: unknown[]) => unknown>> = {
	double: (v) => (v as number) * 2,
	even: (v) => (v as number) % 2 === 0,
	small: (v) => (v as number) < 3,
	sum: (acc, v) => (acc as number) + (v as number),
	append: (acc, v) => [...(acc as unknown[]), v],
	atMost: (previous, current) => (current as number) <= (previous as number),
	always: () => true,
	tuple: (...vs) => vs,
	record: () => ({ recorded: true }),
};

/** A value-level callback with the README's options around it. */
function callback(
	name: string,
	args: Readonly<Record<string, unknown>>,
	env: Env,
): (...xs: unknown[]) => unknown {
	const base = BASE[name];
	if (base === undefined) throw new Refused(`callback ${name}`);
	return (...xs) => {
		// The value the call is given: for a reducer or an equality the incoming one, for a
		// derived its last dependency's, otherwise its argument; that is the last argument.
		const given = xs[xs.length - 1];
		if ("throwsOn" in args && same(given, args.throwsOn)) throw new TraceCallbackError(given);
		if (typeof args.into === "string") stateOf(env, args.into).set(given);
		if (typeof args.invalidates === "string") stateOf(env, args.invalidates).invalidate();
		if ("nothingOn" in args && same(given, args.nothingOn)) return undefined;
		if ("returns" in args) return args.returns;
		return base(...xs);
	};
}

/** A higher-order project `follow`: the node its argument names. */
function follow(args: Readonly<Record<string, unknown>>, env: Env): (v: unknown) => never {
	return ((v: unknown) => {
		if ("throwsOn" in args && same(v, args.throwsOn)) throw new TraceCallbackError(v);
		if (typeof args.into === "string") stateOf(env, args.into).set(v);
		const returnsOn = args.returnsOn as readonly [unknown, unknown] | undefined;
		if (returnsOn !== undefined && same(v, returnsOn[0])) return returnsOn[1];
		return env.graph().find(v as string);
	}) as (v: unknown) => never;
}

// ---------------------------------------------------------------------------------------------
// Building a node.

/** The trace's node kinds that only shape input (README): arrays, empty and once. */
function helperFn(node: TraceNode): NodeFn {
	switch (node.op) {
		case "arrays":
			return (ctx: Ctx) => {
				for (const wave of ctx.deps[0]?.waves ?? []) {
					for (const value of wave) {
						for (const element of value as readonly unknown[]) {
							if (Array.isArray(element)) {
								ctx.down(element.map((v) => ["DATA", v] as Message));
							} else if (element === "INVALIDATE") ctx.down([["INVALIDATE"]]);
							else if (element === "COMPLETE") ctx.down([["COMPLETE"]]);
							else ctx.down([["ERROR", (element as { error: unknown }).error]]);
						}
					}
				}
			};
		case "empty":
			return (ctx: Ctx) => ctx.down([["COMPLETE"]]);
		case "once": {
			const value = node.args?.value;
			return (ctx: Ctx) => {
				if (ctx.state.get() === undefined) {
					ctx.state.set(true);
					ctx.down([["DATA", value]]);
				}
			};
		}
		default:
			throw new Refused(`helper ${String(node.op)}`);
	}
}

/** The TS operator for a trace node; time operators that are not operators come back as null. */
function operatorFor(node: TraceNode, env: Env): Operator<unknown, unknown> | null {
	const a = node.args ?? {};
	const cb = (key: string) => callback(a[key] as string, a, env);
	switch (node.op) {
		case "map":
			return map(cb("f"));
		case "tap":
			return tap(cb("f") as (v: unknown) => void);
		case "filter":
			return filter(cb("p") as (v: unknown) => boolean);
		case "takeWhile":
			return takeWhile(cb("p") as (v: unknown) => boolean);
		case "first":
			return first(a.p === undefined ? undefined : (cb("p") as (v: unknown) => boolean));
		case "last":
			return last(a.p === undefined ? undefined : (cb("p") as (v: unknown) => boolean));
		case "distinctUntilChanged":
			return a.equal === undefined
				? distinctUntilChanged()
				: distinctUntilChanged(cb("equal") as (x: unknown, y: unknown) => boolean);
		case "scan":
			return scan(cb("f"), a.seed);
		case "reduce":
			return reduce(cb("f"), a.seed);
		case "pairwise":
			return pairwise() as Operator<unknown, unknown>;
		case "take":
			return take(a.n as number);
		case "skip":
			return skip(a.n as number);
		case "bufferCount":
			return bufferCount(a.n as number) as Operator<unknown, unknown>;
		case "sample":
			return sample();
		case "takeUntil":
			return takeUntil();
		case "buffer":
			return buffer() as Operator<unknown, unknown>;
		case "valve":
			return valve();
		case "withLatestFrom":
			return withLatestFrom() as Operator<unknown, unknown>;
		case "merge":
			return merge();
		case "zip":
			return zip() as Operator<unknown, unknown>;
		case "concat":
			return concat();
		case "race":
			return race();
		case "switchMap":
			return switchMap(follow(a, env));
		case "concatMap":
			return concatMap(follow(a, env));
		case "exhaustMap":
			return exhaustMap(follow(a, env));
		case "mergeMap":
			return mergeMap(
				follow(a, env),
				a.capacity === undefined ? undefined : { concurrent: a.capacity as number },
			);
		case "debounce":
			return debounce(a.ms as number);
		case "throttle":
			return throttle(a.ms as number);
		case "auditTime":
			return auditTime(a.ms as number);
		case "delay":
			return delay(a.ms as number);
		case "bufferTime":
		case "timeout":
			return null;
		default:
			throw new Refused(`op ${String(node.op)}`);
	}
}

const recipeRef = (node: TraceNode) => `trace/${node.op}`;
const recipeOf = (node: TraceNode) => ({
	ref: recipeRef(node),
	config: { id: node.id, args: (node.args ?? {}) as Record<string, never> },
});

/** Build one trace node on g. */
function build(g: Graph, node: TraceNode, env: Env): Node<unknown> {
	if (node.op === undefined) {
		const initial = node.state && node.state.length > 0 ? node.state[0] : undefined;
		return g.state<unknown>(initial, { name: node.id });
	}
	const deps = (node.deps ?? []).map((id) => {
		const dep = g.find(id);
		if (dep === undefined) throw new Error(`trace: dependency ${id} of ${node.id} not built`);
		return dep;
	});
	if (["arrays", "empty", "once"].includes(node.op)) {
		return g.node(deps, helperFn(node), { name: node.id, recipe: recipeOf(node) });
	}
	if (node.op === "derived") {
		const fn = callback(node.args?.f as string, node.args ?? {}, env);
		return g.derived(deps, fn as never, { name: node.id, recipe: recipeOf(node) });
	}
	const op = operatorFor(node, env);
	if (op === null) {
		// TS's timeout and bufferTime take the source node and give a node of their own; they
		// carry no name or recipe a trace could give them.
		const ms = node.args?.ms as number;
		const made =
			node.op === "timeout"
				? timeout(deps[0] as Node<unknown>, ms)
				: (bufferTime(deps[0] as Node<unknown>, ms) as Node<unknown>);
		return made;
	}
	return g.initNode(op, deps, { name: node.id, recipe: recipeOf(node) });
}

/** The restore registry: every trace node kind rebuilt from its op and args (README). */
function registryFor(trace: Trace, env: Env): Record<string, GraphRestoreEntry> {
	const registry: Record<string, GraphRestoreEntry> = {};
	for (const node of trace.nodes) {
		if (node.op === undefined || registry[recipeRef(node)] !== undefined) continue;
		const op = node.op;
		registry[recipeRef(node)] = {
			ref: recipeRef(node),
			build(config: unknown) {
				const { id, args } = config as { id: string; args: Record<string, unknown> };
				const n: TraceNode = { id, op, args };
				if (["arrays", "empty", "once"].includes(op)) return { fn: helperFn(n) };
				if (op === "derived") return { fn: callback(args.f as string, args, env) };
				const operator = operatorFor(n, env);
				if (operator === null) throw new Error(`trace: ${op} has no recipe in TS`);
				const setup = operator.opts?.setup;
				return setup === undefined
					? { fn: operatorNodeFn(operator) }
					: { fn: operatorNodeFn(operator), setup };
			},
		} as GraphRestoreEntry;
	}
	return registry;
}

// ---------------------------------------------------------------------------------------------
// Comparing.

type Received = Array<readonly [string, string, Wave]>;

function messageMatches(expected: Message, actual: Message): boolean {
	// A trace writes ["ERROR"] without a payload for an ERROR a throw produced (README).
	const e = expected as readonly unknown[];
	const a = actual as readonly unknown[];
	if (e[0] !== a[0]) return false;
	if (e[0] === "ERROR" && e.length === 1) return true;
	if (e.length !== a.length) return false;
	return e.length === 1 || deepEqual(e[1], a[1]);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
	}
	if (
		a !== null &&
		b !== null &&
		typeof a === "object" &&
		typeof b === "object" &&
		!Array.isArray(a) &&
		!Array.isArray(b) &&
		Object.getPrototypeOf(a) === Object.prototype &&
		Object.getPrototypeOf(b) === Object.prototype
	) {
		const ka = Object.keys(a);
		const kb = Object.keys(b);
		return (
			ka.length === kb.length &&
			ka.every((k) =>
				deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
			)
		);
	}
	return false;
}

function group(entries: readonly (readonly [string, string, Wave])[]): Map<string, Wave[]> {
	const out = new Map<string, Wave[]>();
	for (const [sink, node, wave] of entries) {
		const key = `${sink} <- ${node}`;
		const list = out.get(key) ?? [];
		list.push(wave);
		out.set(key, list);
	}
	return out;
}

function wavesMatch(expected: readonly Wave[], actual: readonly Wave[]): boolean {
	return (
		expected.length === actual.length &&
		expected.every(
			(w, i) =>
				w.length === (actual[i] as Wave).length &&
				w.every((m, j) => messageMatches(m, (actual[i] as Wave)[j] as Message)),
		)
	);
}

const OCCURRENCE = new Set(["DATA", "INVALIDATE", "COMPLETE", "ERROR"]);

function occurrencesMatch(expected: readonly Wave[], actual: readonly Wave[]): boolean {
	const e = expected.flat().filter((m) => OCCURRENCE.has(m[0]));
	const a = actual.flat().filter((m) => OCCURRENCE.has(m[0]));
	return e.length === a.length && e.every((m, i) => messageMatches(m, a[i] as Message));
}

function show(v: unknown): string {
	return JSON.stringify(v, (_k, x) => (x instanceof Error ? { error: x.message } : x));
}

/** "" when the step matches; otherwise "framing:" or "behavior:" and what differed. */
function compareStep(
	expected: readonly (readonly [string, string, Wave])[],
	actual: Received,
): string {
	const e = group(expected);
	const a = group(actual);
	const keys = new Set([...e.keys(), ...a.keys()]);
	let framingOnly = true;
	const diffs: string[] = [];
	for (const key of keys) {
		const ew = e.get(key) ?? [];
		const aw = a.get(key) ?? [];
		if (wavesMatch(ew, aw)) continue;
		if (!occurrencesMatch(ew, aw)) framingOnly = false;
		diffs.push(`${key}: expected ${show(ew)} got ${show(aw)}`);
	}
	if (diffs.length === 0) return "";
	return `${framingOnly ? "framing" : "behavior"}: ${diffs.join("; ")}`;
}

// ---------------------------------------------------------------------------------------------
// Running.

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Run one trace. The caller installs fake timers (vi.useFakeTimers) before and resets after. */
export async function runTrace(trace: Trace): Promise<TraceResult> {
	const id = trace.id;
	try {
		checkTrace(trace);
	} catch (e) {
		if (e instanceof Refused) return { id, result: "fail", class: "refused", detail: e.message };
		throw e;
	}
	const ops = new Set<string>();
	for (const n of trace.nodes) {
		if (n.op !== undefined) ops.add(n.op);
		const of = n.args?.of as { op?: string } | undefined;
		if (of?.op !== undefined) ops.add(of.op);
	}
	const missing = [...ops].filter((op) => NOT_SHIPPED[op] !== undefined);
	if (missing.length > 0) {
		return {
			id,
			result: "not-run",
			reason: "operator-not-shipped",
			detail: missing.map((op) => `${op}: ${NOT_SHIPPED[op]}`).join("; "),
		};
	}

	let g = graph({ name: "trace", report: () => {} });
	const env: Env = { graph: () => g };
	const registry = registryFor(trace, env);
	const subscriptions = new Map<string, () => void>();
	let received: Received = [];
	/** Only deliveries from the graph the trace currently runs on are recorded. */
	let generation = 0;

	try {
		for (const node of trace.nodes) build(g, node, env);
	} catch (e) {
		return { id, result: "fail", class: "error", detail: `build: ${show(errorText(e))}` };
	}

	const nodeOf = (nodeId: string): Node<unknown> => {
		const n = g.find(nodeId);
		if (n === undefined) throw new Error(`trace: no node ${nodeId} in the graph`);
		return n;
	};

	const hostRefusals: string[] = [];
	/** A host request; a TS refusal of it goes to its caller, which the trace does not watch. */
	const request = (step: Step): void => {
		const [kind, a, b] = step;
		try {
			switch (kind) {
				case "subscribe": {
					const gen = generation;
					const unsubscribe = nodeOf(b as string).subscribe((wave) => {
						if (gen === generation) received.push([a as string, b as string, wave]);
					});
					subscriptions.set(`${a}\u0000${b}`, unsubscribe);
					return;
				}
				case "unsubscribe": {
					const key = `${a}\u0000${b}`;
					subscriptions.get(key)?.();
					subscriptions.delete(key);
					return;
				}
				case "set":
					stateOf(env, a as string).set(b);
					return;
				case "invalidate":
					stateOf(env, a as string).invalidate();
					return;
				case "complete":
					stateOf(env, a as string).complete();
					return;
				case "error":
					stateOf(env, a as string).error(b);
					return;
				case "batch":
					g.batch(() => {
						for (const inner of a as readonly Step[]) request(inner);
					});
					return;
				case "replace": {
					const node = trace.nodes.find((n) => n.id === a) as TraceNode;
					const deps = (b as readonly string[]).map(nodeOf);
					if (node.op === "derived") throw new Refused("replace of a derived node");
					const op = operatorFor(node, env);
					if (op === null) throw new Refused(`replace of ${node.op}`);
					const setup = op.opts?.setup;
					g.replace(a as string, deps, operatorNodeFn(op), {
						recipe: recipeOf(node),
						...(setup === undefined ? {} : { setup }),
					});
					return;
				}
				default:
					throw new Refused(`step ${kind}`);
			}
		} catch (e) {
			if (e instanceof Refused) throw e;
			hostRefusals.push(`${kind}: ${errorText(e)}`);
		}
	};

	for (let i = 0; i < trace.steps.length; i++) {
		const step = trace.steps[i] as Step;
		received = [];
		try {
			if (step[0] === "advance") {
				vi.advanceTimersByTime(step[1] as number);
			} else if (step[0] === "restore") {
				const checkpoint = JSON.parse(JSON.stringify(g.checkpoint()));
				for (const unsubscribe of subscriptions.values()) unsubscribe();
				subscriptions.clear();
				generation++;
				g = restoreGraph(checkpoint, { registry });
			} else if (step[0] === "resolve" || step[0] === "reject") {
				throw new Refused(`step ${step[0]}: no job of this trace was started`);
			} else {
				request(step);
			}
			await settle();
		} catch (e) {
			if (e instanceof Refused) {
				return { id, result: "fail", class: "refused", step: i, detail: e.message };
			}
			return { id, result: "fail", class: "error", step: i, detail: `${step[0]}: ${errorText(e)}` };
		}
		const diff = compareStep(trace.expect[i] ?? [], received);
		if (diff !== "") {
			const cls = diff.startsWith("framing") ? "framing" : "behavior";
			const refusals = hostRefusals.length > 0 ? ` (TS refused: ${hostRefusals.join("; ")})` : "";
			return {
				id,
				result: "fail",
				class: cls,
				step: i,
				detail: `step ${i} ${show(step)}: ${diff.slice(cls.length + 2)}${refusals}`,
			};
		}
	}
	// Nothing arrives after the last step: a promise, or a timer due at once.
	received = [];
	await settle();
	vi.advanceTimersByTime(0);
	await settle();
	if (received.length > 0) {
		return {
			id,
			result: "fail",
			class: "behavior",
			step: trace.steps.length,
			detail: `after the last step: ${show(received)}`,
		};
	}
	for (const unsubscribe of subscriptions.values()) unsubscribe();
	return { id, result: "pass" };
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
