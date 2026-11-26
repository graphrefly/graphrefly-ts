/**
 * The TS kernel, re-ported from the root reference kernel (graphrefly reference/kernel/kernel.mjs)
 * under graphrefly:D817 and graphrefly-ts:D191 (1): its structure and algorithms follow the
 * reference, section by section and with its names, over TS objects in place of string ids.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl, `npm run rules:current` (R-messages@1,
 * R-wave@4, R-subscription@5, R-invocation@4, R-terminals@2, R-invalidation@2, R-lifetime@2,
 * R-request-order@7, R-node@4, R-failure@5, R-graph-domain@3).
 *
 * One Kernel is one graph's domain (R-graph-domain@3): its wave, request queue and batch. A KNode
 * is one node's kernel record; the package's Node object is its handle.
 *
 * The kernel holds only what a rule or TypeScript requires (graphrefly-ts:D193): no dispatcher
 * table, no node removal, and a ctx that carries what R-invocation and R-lifetime give it. The
 * graph's environment drivers sit on its Kernel, for the operators and sources built on it.
 */
import type { Ctx, CtxDep, DepTerminal, NodeFn, Sink } from "../ctx/types.js";
import { EnvironmentDrivers } from "../graph/environment.js";
import type { Message, Wave } from "../protocol/messages.js";
import type { Node } from "./node.js";

export class KernelError extends Error {}

type Terminal = readonly ["COMPLETE"] | readonly ["ERROR", unknown];
type Frame = readonly Message[];

/** R-failure@3: what the host reporter receives. */
export interface HostFailure {
	readonly source: string;
	readonly error: unknown;
}

const isValue = (m: Message) => m[0] === "DATA" || m[0] === "RESOLVED";
const isTerminal = (m: Message): m is Terminal => m[0] === "COMPLETE" || m[0] === "ERROR";
// R-wave: each of these settles a connection's pending mark.
const settles = (m: Message) => isValue(m) || isTerminal(m) || m[0] === "INVALIDATE";
// R-wave: every array that carries DATA, RESOLVED, INVALIDATE or a terminal marks the cone pending.
const marks = settles;
const hasMark = (frames: readonly Frame[]) => frames.some((f) => f.some(marks));
const TYPES = new Set(["START", "PENDING", "DATA", "RESOLVED", "INVALIDATE", "COMPLETE", "ERROR"]);

/**
 * R-messages@1, R-failure@5 (graphrefly:D814): DATA carries exactly one payload, ERROR one that is
 * not a boolean, and the other types none. Refused where a message is given.
 */
function assertPayload(m: readonly unknown[]): void {
	const one = m.length === 2 && m[1] !== undefined;
	if (m[0] === "DATA") {
		if (!one)
			throw new KernelError(
				m.length === 2
					? "down: DATA requires a non-SENTINEL payload (R-messages)"
					: "down: DATA carries exactly one payload (R-messages)",
			);
		return;
	}
	if (m[0] === "ERROR") {
		if (!one || typeof m[1] === "boolean")
			throw new KernelError(
				m.length === 2
					? "down: ERROR requires a non-SENTINEL, non-boolean payload (R-messages)"
					: "down: ERROR carries exactly one payload (R-messages)",
			);
		return;
	}
	if (m.length !== 1)
		throw new KernelError(`down: ${String(m[0])} carries no payload (R-messages)`);
}

const messageOf = (e: unknown): unknown => (e instanceof Error ? e.message : e);

/**
 * R-failure@5: a throw's ERROR payload is the message of the error thrown, or the thrown value
 * itself; a value that cannot be an ERROR payload gives the empty string.
 */
function errorPayloadOf(e: unknown): unknown {
	const payload = messageOf(e);
	return payload === undefined || typeof payload === "boolean" ? "" : payload;
}

/**
 * R-node@4 (graphrefly:D823): the kernel keeps a recipe as it was given, in a copy of its own, and
 * hands out a copy. Plain objects and arrays are copied; anything else is kept as it is.
 */
export function copyData<T>(value: T, seen = new Map<unknown, unknown>()): T {
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value)) return seen.get(value) as T;
	if (Array.isArray(value)) {
		const out: unknown[] = [];
		seen.set(value, out);
		for (const item of value) out.push(copyData(item, seen));
		return out as T;
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return value;
	const out: Record<string, unknown> = {};
	seen.set(value, out);
	for (const [key, item] of Object.entries(value)) out[key] = copyData(item, seen);
	return out as T;
}

interface Input {
	has: boolean;
	value: unknown;
	ended: Terminal | null;
	frames: Frame[];
	invalidated: boolean;
	/** R-invocation@4: the dependency got a new instance and the function has not run since. */
	replaced: boolean;
}

const freshInput = (): Input => ({
	has: false,
	value: undefined,
	ended: null,
	frames: [],
	invalidated: false,
	replaced: false,
});

/**
 * One submitted array, checked and split into the arrays that are published (R-wave): written
 * order kept, a terminal last, split at the last INVALIDATE, which goes out alone. Rejections
 * throw before anything is accepted.
 */
function prepare(msgs: Wave): Frame[] {
	for (const m of msgs as unknown as readonly unknown[][]) {
		if (!Array.isArray(m) || !TYPES.has(m[0] as string))
			throw new KernelError(
				`down: ${String(Array.isArray(m) ? m[0] : m)} is not in the closed message-type set (R-messages)`,
			);
		assertPayload(m);
	}
	const end = msgs.findIndex(isTerminal);
	if (end >= 0 && end < msgs.length - 1)
		throw new KernelError("down: a terminal must be the last message of its array (R-wave)");
	const cut = msgs.map((m) => m[0]).lastIndexOf("INVALIDATE");
	const rest = msgs.slice(cut + 1);
	const frames: Frame[] = cut >= 0 ? [[["INVALIDATE"]]] : [];
	if (rest.length > 0) frames.push(rest);
	return frames;
}

export type Policy = "auto" | "manual";

type Sub =
	| { readonly kind: "sink"; readonly fn: Sink }
	| { readonly kind: "node"; readonly node: KNode; dep: number };

interface Lifetime {
	open: boolean;
	controller: AbortController | null;
	setupDone: boolean;
	cleanup: (() => void) | null;
}

// biome-ignore lint/suspicious/noConfusingVoidType: a setup returns its cleanup or nothing.
export type Setup = (ctx: Ctx) => (() => void) | undefined | void;

/** One node's kernel record (R-node: the node, its instance and its lifetime). */
export interface KNode {
	readonly kernel: Kernel;
	/** The package's handle for this record. */
	readonly node: Node<unknown>;
	readonly kind: "state" | "node";
	/** The current lifetime's dependencies; ctx.rewire may change them. */
	deps: KNode[];
	/** The instance's declared dependencies; a closing lifetime goes back to them. */
	declaredDeps: KNode[];
	/** The ids a seed gives the first lifetime (R-subscription@5); resolved at activation. */
	seedDeps: string[] | null;
	fn: NodeFn | null;
	setup: Setup | null;
	recipe: unknown;
	seedNote: unknown;
	readonly policy: { complete: Policy; error: Policy };
	readonly invalidate: Policy;
	readonly quiet: boolean;
	subs: Sub[];
	active: boolean;
	lifetime: Lifetime | null;
	/** R-subscription: the DATA values of the last array that had any. */
	values: unknown[];
	has: boolean;
	cache: unknown;
	ended: Terminal | null;
	privateState: unknown;
	pending: boolean;
	pendingDeps: Set<number>;
	inputs: Input[];
	/** Its place in creation order (R-request-order@7). */
	readonly created: number;
	readonly name: string | undefined;
	readonly factory: string | undefined;
	/** Graph-layer topology hook (D145): called when the current dependencies change. */
	onDepsChanged: ((prev: readonly KNode[], next: readonly KNode[]) => void) | undefined;
}

type Req = (() => void) & { askedIn?: number; by?: KNode | null; batchToken?: object };

interface Staged {
	msgs: Message[];
	lifetime: Lifetime | null;
	/** A terminal is staged: nothing may follow it. */
	ended: boolean;
}

/** R-request-order: set(fn) is resolved when the write takes its place in request order. */
class Deferred {
	constructor(readonly fn: (prev: unknown) => unknown) {}
}

/** One graph's domain (R-graph-domain@3). */
export class Kernel {
	/** The graph's environment drivers (D130/D131), for the sources built on it. */
	environment: EnvironmentDrivers = EnvironmentDrivers.empty();
	report: ((failure: HostFailure) => void) | undefined;
	/** R-node@4 (graphrefly:D812): require a recipe on every computed instance. */
	requireRecipe = false;
	/** The graph layer: a node by its graph id, for a seed's dependencies. */
	resolveId: ((id: string) => KNode | undefined) | undefined;
	/** The graph layer: a node's graph id (R-invocation: ctx.deps[i].id). */
	idOf: ((n: KNode) => string) | undefined;
	/** The graph layer: a node's registered id, without allocating one (for the cycle checks). */
	registeredIdOf: ((n: KNode) => string | undefined) | undefined;
	readonly failureObservers: Array<(source: string, error: unknown) => void> = [];
	created = 0;
	staging: Map<KNode, Staged> | null = null;
	batchRequests: Req[] | null = null;
	busy = false;
	queue: Req[] = [];
	serial = 0;
	running: KNode | null = null;
	/** The running task stack (see exec), or null when no task runs. */
	tasks: Task[] | null = null;
}

// ---- Failure reporting (R-failure@5) ---------------------------------------------------------

/** A failure with no caller goes to the host reporter; without one it is logged, and kept nowhere. */
export function reportFailure(k: Kernel, source: string, error: unknown): void {
	for (const observe of k.failureObservers) observe(source, error);
	if (k.report === undefined) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`graphrefly: ${source} failed: ${message}`, error);
		return;
	}
	try {
		k.report({ source, error });
	} catch {
		// the reporter's own failure has nowhere to go
	}
}

/** Observe the failures this graph reports while `run` runs; they are still reported. */
export function observeFailures<R>(
	k: Kernel,
	observer: (source: string, error: unknown) => void,
	run: () => R,
): R {
	k.failureObservers.push(observer);
	try {
		return run();
	} finally {
		const at = k.failureObservers.lastIndexOf(observer);
		if (at >= 0) k.failureObservers.splice(at, 1);
	}
}

const idOf = (n: KNode): string => n.kernel.idOf?.(n) ?? n.name ?? n.factory ?? "node";
/** A node's registered id, or undefined; a seed names only registered nodes. */
const registeredIdOf = (n: KNode): string | undefined => n.kernel.registeredIdOf?.(n);

// ---- Cycle checks (R-request-order@7) ----------------------------------------------------------

/**
 * Whether n depends on target, through current, declared or seed dependencies (graphrefly:D822).
 * A seed may name a node not made yet: its id still counts (graphrefly:D826), and there is nothing
 * to follow from it until it is made.
 */
function dependsOn(from: KNode, target: KNode | string): boolean {
	const k = from.kernel;
	const targetId = typeof target === "string" ? target : undefined;
	const seen = new Set<KNode>();
	const stack = [from];
	while (stack.length > 0) {
		const n = stack.pop() as KNode;
		if (seen.has(n)) continue;
		seen.add(n);
		for (const d of n.deps) {
			if (d === target || (targetId !== undefined && registeredIdOf(d) === targetId)) return true;
			stack.push(d);
		}
		for (const d of n.declaredDeps) {
			if (d === target || (targetId !== undefined && registeredIdOf(d) === targetId)) return true;
			stack.push(d);
		}
		for (const id of n.seedDeps ?? []) {
			if (id === targetId || (typeof target !== "string" && registeredIdOf(target) === id))
				return true;
			const d = k.resolveId?.(id);
			if (d !== undefined) {
				if (d === target) return true;
				stack.push(d);
			}
		}
	}
	return false;
}

function assertAcyclic(op: string, n: KNode, deps: readonly KNode[]): void {
	for (const d of deps) {
		if (d === n || dependsOn(d, n))
			throw new KernelError(
				`${op}: a dependency is the node itself or depends on it (R-request-order)`,
			);
	}
}

/**
 * R-subscription@5 (graphrefly:D827): what a request would activate must be able to start. Checked
 * before anything changes.
 */
function assertStartable(from: KNode): void {
	const seen = new Set<KNode>();
	const stack = [from];
	while (stack.length > 0) {
		const n = stack.pop() as KNode;
		if (n.active || n.kind === "state" || n.ended || seen.has(n)) continue;
		seen.add(n);
		if (n.seedDeps === null) {
			for (const d of n.deps) stack.push(d);
			continue;
		}
		for (const id of n.seedDeps) {
			const d = n.kernel.resolveId?.(id);
			if (d === undefined)
				throw new KernelError(
					`${idOf(n)} cannot start: its seed names ${id}, which does not exist (R-subscription)`,
				);
			stack.push(d);
		}
	}
}

// ---- Creation (R-node@4) ---------------------------------------------------------------------

export interface MakeNodeSpec {
	readonly node: Node<unknown>;
	readonly kind: "state" | "node";
	readonly deps: readonly KNode[];
	readonly fn: NodeFn | null;
	readonly id?: string;
	readonly complete?: Policy;
	readonly error?: Policy;
	readonly invalidate?: Policy;
	readonly quiet?: boolean;
	readonly setup?: Setup;
	readonly recipe?: unknown;
	readonly initial?: unknown;
	readonly seed?: KernelSeed;
	readonly name?: string;
	readonly factory?: string;
}

/** R-subscription@5: what a node may be given at construction and holds as if it had produced it. */
export interface KernelSeed {
	readonly values?: readonly unknown[];
	/** `true` for COMPLETE, the payload for ERROR, `undefined` when open. */
	readonly terminal?: unknown;
	readonly privateState?: unknown;
	/** The graph ids of the first lifetime's dependencies; they may be made after this node. */
	readonly deps?: readonly string[];
	readonly note?: unknown;
}

const terminalOf = (t: unknown): Terminal | null =>
	t === undefined ? null : t === true ? ["COMPLETE"] : ["ERROR", t];

/** `true` for COMPLETE, the payload for ERROR, `undefined` when open: the package's shape. */
export const terminalValue = (t: Terminal | null): unknown =>
	t === null ? undefined : t[0] === "COMPLETE" ? true : t[1];

export function makeKNode(k: Kernel, spec: MakeNodeSpec): KNode {
	if (spec.kind === "node" && k.requireRecipe && spec.recipe == null)
		throw new KernelError(
			`node: ${spec.id ?? spec.name ?? "node"}: this graph requires a recipe on every computed node (R-node)`,
		);
	const seed = spec.seed;
	// R-request-order@7 (graphrefly:D826): nothing depends on a node that does not exist yet, except
	// through a seed that named it.
	if (spec.id !== undefined) {
		for (const d of spec.deps)
			if (dependsOn(d, spec.id))
				throw new KernelError(
					`node: ${spec.id} would depend on itself through ${idOf(d)} (R-request-order)`,
				);
		for (const id of seed?.deps ?? []) {
			if (id === spec.id)
				throw new KernelError(
					`node: ${spec.id} would depend on itself through ${id} (R-request-order)`,
				);
			const d = k.resolveId?.(id);
			if (d !== undefined && dependsOn(d, spec.id))
				throw new KernelError(
					`node: ${spec.id} would depend on itself through ${id} (R-request-order)`,
				);
		}
	}
	for (const v of seed?.values ?? []) assertPayload(["DATA", v]);
	const ended = terminalOf(seed?.terminal);
	if (ended !== null) assertPayload(ended);
	const values: unknown[] =
		seed !== undefined
			? [...(seed.values ?? [])]
			: spec.initial !== undefined
				? [spec.initial]
				: [];
	const deps = [...spec.deps];
	const n: KNode = {
		kernel: k,
		node: spec.node,
		kind: spec.kind,
		deps,
		declaredDeps: deps,
		seedDeps: seed?.deps !== undefined ? [...seed.deps] : null,
		fn: spec.fn,
		setup: spec.setup ?? null,
		recipe: copyData(spec.recipe),
		seedNote: seed?.note,
		policy: { complete: spec.complete ?? "auto", error: spec.error ?? "auto" },
		invalidate: spec.invalidate ?? "auto",
		quiet: spec.quiet ?? false,
		subs: [],
		active: false,
		lifetime: null,
		values,
		has: values.length > 0,
		cache: values.at(-1),
		ended,
		privateState: seed?.privateState,
		pending: false,
		pendingDeps: new Set(),
		inputs: deps.map(freshInput),
		created: k.created++,
		name: spec.name,
		factory: spec.factory,
		onDepsChanged: undefined,
	};
	return n;
}

/**
 * R-checkpoint (restore): give a node that has never been activated a seed, as if it had been
 * built with it. Kept for the restore of phase 1; phase 2 builds restored nodes with their seed.
 */
export function seedKNode(n: KNode, seed: KernelSeed): void {
	// Phase 1 only (phase 2 builds restored nodes with their seed): a collection holds its apply
	// node from construction, so it and its input state may be active here. A restored graph has
	// no subscribers (R-checkpoint), so an active computed node drops its holds and deactivates
	// before it is seeded; a state has no lifetime and takes its values as at construction, its
	// dependents' records of it following.
	if (n.active && n.kind !== "state") {
		n.subs = [];
		exec(n.kernel, deactivateTask(n));
	}
	for (const v of seed.values ?? []) assertPayload(["DATA", v]);
	const ended = terminalOf(seed.terminal);
	if (ended !== null) assertPayload(ended);
	n.values = [...(seed.values ?? [])];
	n.has = n.values.length > 0;
	n.cache = n.values.at(-1);
	n.ended = ended;
	n.privateState = seed.privateState;
	n.seedDeps = seed.deps !== undefined ? [...seed.deps] : null;
	n.seedNote = n.kind === "state" || ended !== null ? undefined : seed.note;
	if (!n.active) n.inputs = n.deps.map(freshInput);
	for (const sub of n.subs) {
		if (sub.kind !== "node") continue;
		const input = sub.node.inputs[sub.dep] as Input;
		input.has = n.has;
		input.value = n.cache;
		input.ended = n.ended;
	}
}

// ---- Batch staging (R-request-order) ---------------------------------------------------------

/**
 * One accumulated array per node (R-request-order). Each submission is checked on its own and
 * against what is staged (a terminal staged before it), so a batch of many writes stays linear.
 */
function stage(
	k: Kernel,
	n: KNode,
	lifetime: Lifetime | null,
	msgs: readonly Message[],
	label = "down",
): void {
	const staging = k.staging as Map<KNode, Staged>;
	const entry = staging.get(n) ?? { msgs: [], lifetime, ended: false };
	try {
		prepare(msgs);
		if (entry.ended && msgs.length > 0)
			throw new KernelError("down: a terminal must be the last message of its array (R-wave)");
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		throw new KernelError(message.replace(/^down:/, `${label}:`));
	}
	for (const m of msgs) entry.msgs.push(m);
	if (msgs.some(isTerminal)) entry.ended = true;
	staging.set(n, entry);
}

// ---- Out-of-wave requests (R-request-order@7) --------------------------------------------------

/** Run a request now, or after the current wave when the kernel is busy. */
export function request(k: Kernel, run: () => void, batchToken?: object): void {
	const op = run as Req;
	if (batchToken !== undefined) op.batchToken = batchToken;
	if (k.batchRequests !== null) {
		k.batchRequests.push(op);
		return;
	}
	if (k.busy) {
		op.askedIn = k.serial;
		op.by = k.running;
		k.queue.push(op);
		return;
	}
	k.busy = true;
	k.serial += 1;
	try {
		op();
	} finally {
		k.busy = false;
		while (k.queue.length > 0) {
			functionsInCreationOrder(k);
			const next = k.queue.shift() as Req;
			k.busy = true;
			k.serial += 1;
			try {
				next();
			} catch (e) {
				reportFailure(k, "queued request", e);
			} finally {
				k.busy = false;
			}
		}
	}
}

/**
 * R-request-order@7 (graphrefly:D818): the requests node functions made during the request that
 * just ended run in their nodes' creation order, each node's own in the order it made them, at the
 * places in the queue that such requests were made at.
 */
function functionsInCreationOrder(k: Kernel): void {
	const slots: number[] = [];
	k.queue.forEach((op, i) => {
		if (op.by && op.askedIn === k.serial) slots.push(i);
	});
	const sorted = slots
		.map((i) => k.queue[i] as Req)
		.sort((x, y) => (x.by as KNode).created - (y.by as KNode).created);
	slots.forEach((i, j) => {
		k.queue[i] = sorted[j] as Req;
	});
}

/** True at a wave boundary: no request running and no batch body open (R-checkpoint). */
export function idle(k: Kernel): boolean {
	return !k.busy && k.staging === null;
}

// ---- Tasks ---------------------------------------------------------------------------------
//
// TypeScript has no deep recursion: a chain of thousands of nodes (graphrefly-ts Q15) overflows the
// JS stack where the reference recurses. Activation, delivery and closing therefore run as tasks on
// an explicit stack: a task is a generator that, after each step that may start another task,
// yields, so the started task runs to its end first. That visits nodes in the order the
// reference's recursion does.

type Task = Generator<undefined, void, undefined>;

/** Run a task now, or, when a task of this kernel is running, as its next step. */
function exec(k: Kernel, task: Task): void {
	if (k.tasks !== null) {
		k.tasks.push(task);
		return;
	}
	const tasks: Task[] = [task];
	k.tasks = tasks;
	try {
		while (tasks.length > 0) {
			const top = tasks[tasks.length - 1] as Task;
			if (top.next().done) tasks.splice(tasks.lastIndexOf(top), 1);
		}
	} finally {
		k.tasks = null;
	}
}

// ---- Lifetimes (R-lifetime@2) ----------------------------------------------------------------

function openLifetime(n: KNode): void {
	n.lifetime = { open: true, controller: null, setupDone: false, cleanup: null };
}

function runCleanup(n: KNode, f: () => void): void {
	try {
		f();
	} catch (e) {
		reportFailure(n.kernel, `cleanup of ${idOf(n)}`, e);
	}
}

/** Closing aborts the signal, releases the dependencies, runs the cleanup, drops private state. */
function closeLifetime(n: KNode): void {
	exec(n.kernel, closeTask(n));
}

function* closeTask(n: KNode): Task {
	const lifetime = n.lifetime;
	if (!lifetime?.open) return;
	lifetime.open = false;
	lifetime.controller?.abort();
	const deps = n.deps;
	for (let i = 0; i < deps.length; i++) {
		const dep = deps[i] as KNode;
		const sub = dep.subs.find((s) => s.kind === "node" && s.node === n && s.dep === i);
		if (sub === undefined) continue;
		release(dep, sub);
		yield;
	}
	const prev = n.deps;
	n.deps = n.declaredDeps;
	n.inputs = n.deps.map(freshInput);
	if (prev !== n.deps) n.onDepsChanged?.(prev, n.deps);
	const { cleanup } = lifetime;
	lifetime.cleanup = null;
	if (cleanup) runCleanup(n, cleanup);
	n.privateState = undefined;
	n.lifetime = null;
}

function activate(n: KNode): void {
	exec(n.kernel, activateTask(n));
}

/** Activating acquires the dependencies, activating them, then runs the function once. */
function* activateTask(n: KNode): Task {
	n.active = true;
	if (n.kind === "state" || n.ended) return;
	openLifetime(n);
	if (n.seedDeps !== null) {
		const k = n.kernel;
		const prev = n.deps;
		n.deps = n.seedDeps.map((id) => k.resolveId?.(id) as KNode);
		n.inputs = n.deps.map(freshInput);
		n.seedDeps = null;
		n.onDepsChanged?.(prev, n.deps);
	}
	for (let i = 0; i < n.deps.length; i++) {
		const dep = n.deps[i] as KNode;
		if (!dep.active) {
			activate(dep);
			yield;
		}
		dep.subs.push({ kind: "node", node: n, dep: i });
		n.inputs[i] = snapshotInput(dep);
	}
	down(n, firstRun(n));
}

/** R-lifetime: the first run of a lifetime sees each dependency's snapshot as its input. */
function firstRun(n: KNode): Frame[] {
	const depError = n.inputs.map((input) => input.ended).find((t) => t?.[0] === "ERROR");
	const out = depError && n.policy.error === "auto" ? [[depError] as Frame] : invoke(n);
	for (const input of n.inputs) input.frames = [];
	const allEnded = n.deps.length > 0 && n.inputs.every((input) => input.ended);
	return n.policy.complete === "auto" && allEnded && !out.flat().some(isTerminal)
		? [...out, [["COMPLETE"]]]
		: out;
}

/** Acquire the dependency at place i (a rewire's or a replace's added one), outside any task. */
function acquire(n: KNode, i: number): void {
	const dep = n.deps[i] as KNode;
	if (!dep.active) activate(dep);
	dep.subs.push({ kind: "node", node: n, dep: i });
	n.inputs[i] = snapshotInput(dep);
}

function snapshotOf(n: KNode): Message[] {
	return [...n.values.map((v) => ["DATA", v] as Message), ...(n.ended ? [n.ended as Message] : [])];
}

function snapshotInput(dep: KNode): Input {
	const snapshot = snapshotOf(dep);
	return {
		...freshInput(),
		has: dep.has,
		value: dep.cache,
		ended: dep.ended,
		frames: snapshot.length > 0 ? [snapshot] : [],
	};
}

function release(dep: KNode, sub: Sub): void {
	const i = dep.subs.indexOf(sub);
	if (i >= 0) dep.subs.splice(i, 1);
	if (dep.subs.length === 0 && dep.active) exec(dep.kernel, deactivateTask(dep));
}

function* deactivateTask(n: KNode): Task {
	n.active = false;
	if (n.kind === "state") return;
	closeLifetime(n);
	yield;
	n.privateState = undefined;
	n.inputs = n.deps.map(freshInput);
	if (!n.ended) {
		n.has = false;
		n.cache = undefined;
		n.values = [];
	}
}

// ---- Invocation (R-invocation@4) -------------------------------------------------------------

const depTerminalOf = (t: Terminal | undefined): DepTerminal | undefined =>
	t === undefined
		? undefined
		: t[0] === "COMPLETE"
			? { kind: "complete" }
			: { kind: "error", error: t[1] };

function invoke(n: KNode): Frame[] {
	const lifetime = n.lifetime as Lifetime;
	const k = n.kernel;
	const out: Frame[] = [];
	let invoking = true;
	const assertInvocation = () => {
		if (!invoking)
			throw new KernelError("ctx.deps is only available during setup or function invocation");
	};
	const deps = n.inputs.map((input, i) => {
		const valueFrames = input.frames.filter((f) => f.some(isValue));
		const view = {
			id: () => idOf(n.deps[i] as KNode),
			waves: valueFrames.map((f) => f.filter((m) => m[0] === "DATA").map((m) => m[1])),
			terminal: depTerminalOf(input.frames.flat().find(isTerminal)),
			invalidated: n.invalidate === "manual" && input.invalidated,
			replaced: input.replaced,
			has: input.has,
			value: input.value,
		};
		return {
			get id() {
				assertInvocation();
				return view.id();
			},
			get waves() {
				assertInvocation();
				return view.waves;
			},
			get terminal() {
				assertInvocation();
				return view.terminal;
			},
			get invalidated() {
				assertInvocation();
				return view.invalidated;
			},
			get replaced() {
				assertInvocation();
				return view.replaced;
			},
			get has() {
				assertInvocation();
				return view.has;
			},
			get value() {
				assertInvocation();
				return view.value;
			},
		} satisfies CtxDep;
	});
	// R-invocation@4: this run is told, and no later one.
	for (const input of n.inputs) input.replaced = false;
	let seed: unknown;
	if (n.seedNote !== undefined) {
		seed = n.seedNote;
		n.seedNote = undefined;
	}
	const ctx: Ctx = {
		get deps() {
			assertInvocation();
			return deps;
		},
		state: {
			get: <S>() => (n.lifetime === lifetime ? (n.privateState as S | undefined) : undefined),
			set: (v) => {
				if (n.lifetime === lifetime && lifetime.open) n.privateState = v;
			},
		},
		down(msgs) {
			const kernelOnly = (msgs as unknown as readonly unknown[][]).find(
				(m) => Array.isArray(m) && (m[0] === "START" || m[0] === "PENDING" || m[0] === "RESOLVED"),
			);
			if (kernelOnly)
				throw new KernelError(
					`down: ${String(kernelOnly[0])} is sent only by the kernel; node output cannot carry it (R-wave)`,
				);
			const frames = prepare(msgs);
			if (invoking) {
				out.push(...frames);
				return;
			}
			later(n, lifetime, frames);
		},
		get signal() {
			if (!lifetime.controller) {
				lifetime.controller = new AbortController();
				if (!lifetime.open) lifetime.controller.abort();
			}
			return lifetime.controller.signal;
		},
		rewire(list) {
			if (!lifetime.open) return;
			const next = list.map(kOf); // R-node@4: the list as it is now
			for (const d of next)
				if (d.kernel !== k)
					throw new KernelError(
						"rewire: dep belongs to a different graph; cross-graph deps require a wire bridge (D22 / R-graph-domain)",
					);
			assertAcyclic("rewire", n, next);
			request(k, () => {
				if (!lifetime.open || n.lifetime !== lifetime) return;
				assertAcyclic("rewire", n, next);
				for (const d of next) assertStartable(d);
				rewireNode(n, next);
			});
		},
		seed,
	};
	const prevRunning = k.running;
	k.running = n;
	try {
		if (!lifetime.setupDone) {
			lifetime.setupDone = true;
			const cleanup = n.setup?.(ctx);
			if (typeof cleanup === "function") lifetime.cleanup = cleanup;
		}
		(n.fn as NodeFn)(ctx);
	} catch (e) {
		return [[["ERROR", errorPayloadOf(e)]]]; // R-failure@5: what it sent is dropped
	} finally {
		k.running = prevRunning;
		invoking = false;
	}
	return out;
}

/** Output that is not part of the current wave: a new wave from n, its arrays together. */
function later(n: KNode, lifetime: Lifetime | null, frames: Frame[], stageWithBatch = false): void {
	if (frames.length === 0) return;
	const k = n.kernel;
	if (stageWithBatch && k.staging !== null && lifetime?.open) {
		stage(k, n, lifetime, frames.flat());
		return;
	}
	request(k, () => {
		if (lifetime === null || !lifetime.open || n.lifetime !== lifetime) return;
		runWave([{ node: n, frames }]);
	});
}

// ---- Waves (R-wave@4) ------------------------------------------------------------------------

/** Marks every node reachable from n pending, before any settlement runs (R-wave). */
function markPending(from: KNode): void {
	const stack = [from];
	while (stack.length > 0) {
		const n = stack.pop() as KNode;
		for (const sub of n.subs) {
			if (sub.kind !== "node") continue;
			const m = sub.node;
			if (m.ended) continue;
			m.pendingDeps.add(sub.dep);
			if (!m.pending) {
				m.pending = true;
				if (!m.quiet) stack.push(m);
			}
		}
	}
}

function deliverToSink(n: KNode, sink: Sink, msgs: Wave): void {
	try {
		sink(msgs);
	} catch (e) {
		reportFailure(n.kernel, `sink of ${idOf(n)}`, e);
	}
}

const down = (n: KNode, frames: Frame[]) => deliver(n, apply(n, frames));

function apply(n: KNode, frames: readonly Frame[]): Frame[] {
	const out: Frame[] = [];
	for (const frame of frames) {
		if (n.ended) break;
		const f: Message[] = [];
		const values: unknown[] = [];
		for (const m of frame) {
			if (m[0] === "DATA") {
				n.has = true;
				n.cache = m[1];
				values.push(m[1]);
			}
			if (m[0] === "INVALIDATE") {
				if (!n.has) continue;
				n.has = false;
				n.cache = undefined;
				n.values = [];
			}
			if (isTerminal(m)) n.ended = m;
			f.push(m);
		}
		if (values.length > 0) n.values = values;
		if (f.length > 0) out.push(f);
	}
	return out;
}

/** Sends arrays already applied to n: all of them to one subscriber, then the next (R-wave). */
function deliver(n: KNode, out: Frame[], after?: () => void): void {
	if (n.pending && !out.some((f) => f.some(settles))) out = [...out, [["RESOLVED"]]];
	if (out.length === 0) {
		after?.();
		return;
	}
	if (hasMark(out) && !n.pending) {
		n.pending = true;
		markPending(n);
	}
	n.pending = false;
	const sent = out.map((f) => (f.some(marks) ? ([["PENDING"], ...f] as Frame) : f));
	exec(n.kernel, deliverTask(n, sent, [...n.subs], after));
}

function* deliverTask(n: KNode, sent: Frame[], subs: Sub[], after?: () => void): Task {
	for (const sub of subs) {
		if (sub.kind === "sink") for (const f of sent) deliverToSink(n, sub.fn, f);
		else if (n.subs.includes(sub)) {
			// A dependent released while this delivery ran (an earlier subscriber ended and let go
			// of the chain that held it) has closed its lifetime, and receives nothing more.
			receive(sub.node, sub.dep, sent);
			yield;
		}
	}
	if (n.ended) {
		closeLifetime(n);
		yield;
	}
	after?.();
}

function receive(m: KNode, i: number, frames: readonly Frame[]): void {
	if (m.ended) return;
	const input = m.inputs[i] as Input;
	for (const frame of frames) {
		const f = frame.filter((msg) => msg[0] !== "PENDING");
		for (const msg of f) {
			if (msg[0] === "DATA") {
				input.has = true;
				input.value = msg[1];
			}
			if (msg[0] === "INVALIDATE") {
				input.has = false;
				input.value = undefined;
			}
			if (isTerminal(msg)) input.ended = msg;
		}
		input.frames.push(f);
	}
	if (frames.some((f) => f.some(settles))) m.pendingDeps.delete(i);
	if (m.pendingDeps.size === 0) settle(m);
}

function lastIndexWhere<T>(list: readonly T[], pred: (x: T) => boolean): number {
	for (let i = list.length - 1; i >= 0; i--) if (pred(list[i] as T)) return i;
	return -1;
}

function settle(m: KNode): void {
	if (!m.inputs.some((input) => input.frames.length > 0)) return;
	const clear = () => {
		for (const input of m.inputs) {
			input.frames = [];
			input.invalidated = false;
		}
	};
	// R-terminals@2, auto ERROR: an INVALIDATE that reached the node in that wave takes effect first.
	const depError = m.inputs.flatMap((input) => input.frames.flat()).find((x) => x[0] === "ERROR");
	if (depError && m.policy.error === "auto") {
		const invalidatedFirst = m.inputs.some((input) =>
			input.frames.some((f) => f[0]?.[0] === "INVALIDATE"),
		);
		clear();
		const lead = invalidatedFirst ? apply(m, [[["INVALIDATE"]]]) : [];
		settleOutput(m, lead, [[depError]]);
		return;
	}
	// R-invalidation@2: what came before an INVALIDATE on an input is gone.
	const isInvalidate = (f: Frame) => f[0]?.[0] === "INVALIDATE";
	let lead: Frame[] = [];
	let invalidated = false;
	for (const input of m.inputs) {
		const at = lastIndexWhere(input.frames, isInvalidate);
		if (at < 0) continue;
		input.frames = input.frames.slice(at + 1);
		input.invalidated = true;
		invalidated = true;
	}
	if (invalidated && m.invalidate === "auto") lead = apply(m, [[["INVALIDATE"]]]);
	const rest = m.inputs.flatMap((input) => input.frames.flat());
	const manualTerminal = rest.some(
		(x) => isTerminal(x) && (x[0] === "COMPLETE" ? m.policy.complete : m.policy.error) === "manual",
	);
	const allEnded = m.inputs.every((input) => input.ended);
	const lastAutoComplete = m.policy.complete === "auto" && allEnded && rest.some(isTerminal);
	const runs =
		rest.some(isValue) ||
		manualTerminal ||
		lastAutoComplete ||
		(invalidated && m.invalidate === "manual");
	const out = runs ? invoke(m) : [];
	clear();
	// R-terminals@2: the kernel's COMPLETE is an array of its own after the run's arrays.
	const postlude: Frame[] =
		m.policy.complete === "auto" && allEnded && !out.flat().some(isTerminal)
			? [[["COMPLETE"]]]
			: [];
	settleOutput(m, lead, postlude.length > 0 ? [...out, ...postlude] : out);
}

function settleOutput(m: KNode, lead: Frame[], out: Frame[]): void {
	if (m.quiet) {
		// R-wave@4: a quiet node's output is a later wave; only an auto INVALIDATE goes on now.
		m.pending = false;
		const lifetime = m.lifetime;
		if (lead.length > 0) deliver(m, lead, () => later(m, lifetime, out, true));
		else later(m, lifetime, out, true);
		return;
	}
	deliver(m, [...lead, ...apply(m, out)]);
}

function runWave(entries: Array<{ node: KNode; frames: Frame[] }>): void {
	const live = entries.filter(({ node }) => !node.ended);
	if (live.length === 0) return;
	const applied = live.map(({ node, frames }) => ({ node, out: apply(node, frames) }));
	for (const { node, out } of applied) {
		if (hasMark(out) && !node.pending) {
			node.pending = true;
			markPending(node);
		}
	}
	for (const { node, out } of applied) deliver(node, out);
}

// ---- Replace (R-request-order@7) -------------------------------------------------------------

export interface ReplaceSpec {
	readonly fn: NodeFn;
	readonly setup?: Setup;
	readonly recipe?: unknown;
}

function replaceNode(n: KNode, deps: KNode[], spec: ReplaceSpec): void {
	const old = n.lifetime;
	if (old) {
		old.open = false;
		old.controller?.abort();
	}
	const prevDeps = n.deps;
	if (!old) n.deps = []; // inactive or ended: no connection is held
	exchange(n, deps);
	if (old?.cleanup) runCleanup(n, old.cleanup);
	Object.assign(n, {
		fn: spec.fn,
		setup: spec.setup ?? null,
		recipe: spec.recipe,
		seedNote: undefined,
		declaredDeps: deps,
		seedDeps: null,
		lifetime: null,
		values: [],
		has: false,
		cache: undefined,
		ended: null,
		privateState: undefined,
		pending: false,
	});
	n.pendingDeps.clear();
	if (prevDeps !== deps) n.onDepsChanged?.(prevDeps, deps);
	if (!n.active) return;
	openLifetime(n);
	n.inputs = deps.map((d) => snapshotInput(d));
	apply(n, firstRun(n));
	const snap = snapshotOf(n);
	const nodeSubs: Array<Extract<Sub, { kind: "node" }>> = [];
	for (const sub of [...n.subs]) {
		if (sub.kind === "sink") deliverToSink(n, sub.fn, [["START"], ...snap]);
		else {
			sub.node.inputs[sub.dep] = { ...freshInput(), replaced: true };
			nodeSubs.push(sub);
		}
	}
	if (snap.length > 0) {
		if (hasMark([snap])) {
			n.pending = true;
			markPending(n);
			n.pending = false;
		}
		for (const sub of nodeSubs) receive(sub.node, sub.dep, [snap]);
	}
	if (n.ended) closeLifetime(n);
}

// ---- Rewire (R-request-order@7) --------------------------------------------------------------

function rewireNode(n: KNode, deps: KNode[]): void {
	const prev = n.deps;
	const added = exchange(n, deps);
	n.onDepsChanged?.(prev, n.deps);
	if (added.some((i) => (n.inputs[i] as Input).frames.length > 0)) settle(n);
}

/**
 * Gives n the dependency list deps; shared by replace and rewire. A dependency given more than
 * once keeps its k-th connection at its k-th place (graphrefly:D821). Returns the added places.
 */
function exchange(n: KNode, deps: KNode[]): number[] {
	if (!n.active) {
		n.deps = deps;
		n.inputs = deps.map(freshInput);
		return [];
	}
	const held = new Map<KNode, Array<{ input: Input; sub: Extract<Sub, { kind: "node" }> }>>();
	n.deps.forEach((dep, i) => {
		const sub = dep.subs.find((s) => s.kind === "node" && s.node === n && s.dep === i) as
			| Extract<Sub, { kind: "node" }>
			| undefined;
		if (sub === undefined) return;
		const list = held.get(dep) ?? [];
		list.push({ input: n.inputs[i] as Input, sub });
		held.set(dep, list);
	});
	const added: number[] = [];
	n.inputs = deps.map((dep, i) => {
		const kept = held.get(dep)?.shift();
		if (!kept) {
			added.push(i);
			return freshInput();
		}
		kept.sub.dep = i;
		return kept.input;
	});
	n.deps = deps;
	for (const i of added) acquire(n, i);
	for (const [dep, left] of held) for (const { sub } of left) release(dep, sub);
	return added;
}

// ---- Host input (R-request-order@7) ----------------------------------------------------------

const currentOf = (n: KNode) => (n.has ? n.cache : undefined);

function resolveStaged(n: KNode, msgs: readonly Message[]): Message[] {
	let cur = currentOf(n);
	const out: Message[] = [];
	for (const m of msgs) {
		if (m[0] === "INVALIDATE") cur = undefined;
		if (m[0] !== "DATA") {
			out.push(m);
			continue;
		}
		if (!(m[1] instanceof Deferred)) {
			cur = m[1];
			out.push(m);
			continue;
		}
		const v = m[1].fn(cur);
		if (Object.is(v, cur)) continue;
		assertPayload(["DATA", v]);
		cur = v;
		out.push(["DATA", v]);
	}
	return out;
}

/** R-terminals: a host input to an ended node is refused; one to a state runs in request order. */
export function hostInput(n: KNode, msg: Message, label = "down"): void {
	if (n.kind !== "state") throw new KernelError(`${label}: only a state node takes host input`);
	if (n.ended) throw new KernelError(`${label}: this node has ended (R-terminals)`);
	if (!(msg[0] === "DATA" && msg[1] instanceof Deferred)) assertPayload(msg);
	const k = n.kernel;
	if (k.staging !== null) {
		stage(k, n, null, [msg], label);
		return;
	}
	request(k, () => {
		if (n.ended) throw new KernelError(`${label}: this node has ended (R-terminals)`);
		const msgs = resolveStaged(n, [msg]);
		if (msgs.length > 0) runWave([{ node: n, frames: [msgs] }]);
	});
}

export function hostSet(n: KNode, value: unknown): void {
	hostInput(
		n,
		[
			"DATA",
			typeof value === "function" ? new Deferred(value as (prev: unknown) => unknown) : value,
		],
		"set",
	);
}

// ---- Subscription (R-subscription@5) ---------------------------------------------------------

/** subscribe(sink, node): one first array, START and the snapshot; returns the unsubscribe. */
export function subscribe(n: KNode, sink: Sink): () => void {
	const k = n.kernel;
	let sub: Sub | undefined;
	let cancelled = false;
	request(k, () => {
		if (cancelled) return;
		if (!n.active) {
			assertStartable(n);
			activate(n);
		}
		sub = { kind: "sink", fn: sink };
		n.subs.push(sub);
		deliverToSink(n, sink, [["START"], ...snapshotOf(n)]);
	});
	return () => {
		request(k, () => {
			cancelled = true;
			if (sub !== undefined) release(n, sub);
			sub = undefined;
		});
	};
}

// ---- Replace and rewire requests -------------------------------------------------------------

export function replace(n: KNode, deps: readonly KNode[], spec: ReplaceSpec): void {
	if (n.kind !== "node")
		throw new KernelError("replace: a state node is not replaced (R-request-order)");
	const k = n.kernel;
	if (k.requireRecipe && spec.recipe == null)
		throw new KernelError(
			`replace: ${idOf(n)}: this graph requires a recipe on every computed node (R-node)`,
		);
	const list = [...deps];
	const copied: ReplaceSpec = { ...spec, recipe: copyData(spec.recipe) };
	assertAcyclic("replace", n, list);
	request(k, () => {
		assertAcyclic("replace", n, list);
		if (n.active) for (const d of list) assertStartable(d);
		replaceNode(n, list, copied);
	});
}

// ---- Batch (R-request-order@7) ---------------------------------------------------------------

export function batch<T>(k: Kernel, body: () => T): T {
	if (Object.prototype.toString.call(body) === "[object AsyncFunction]")
		throw new KernelError(
			"batch: the body must be synchronous; finish asynchronous work first, then batch the writes",
		);
	const reportPromise = (result: T) => {
		if (typeof (result as { then?: unknown } | null | undefined)?.then === "function")
			reportFailure(
				k,
				"batch",
				"batch body returned a promise; writes after its first suspension are separate waves",
			);
		return result;
	};
	if (k.staging !== null) return reportPromise(body());
	k.staging = new Map();
	k.batchRequests = [];
	let staged: Map<KNode, Staged>;
	let requests: Req[];
	let result: T;
	try {
		result = body();
		staged = k.staging;
		requests = k.batchRequests;
	} finally {
		k.staging = null;
		k.batchRequests = null;
	}
	reportPromise(result);
	request(k, () => {
		k.queue.unshift(...requests);
		for (const [n, { lifetime }] of staged) {
			if (!lifetime && n.ended)
				throw new KernelError("batch: a written node has ended (R-terminals)");
		}
		const live = [...staged].filter(
			([n, { lifetime }]) => !lifetime || (lifetime.open && n.lifetime === lifetime),
		);
		const resolved = live.map(([n, entry]) => ({
			n,
			lifetime: entry.lifetime,
			msgs: resolveStaged(n, entry.msgs),
		}));
		runWave(
			resolved
				.filter(({ msgs }) => msgs.length > 0)
				.filter(({ n, lifetime }) => !lifetime || (lifetime.open && n.lifetime === lifetime))
				.map(({ n, msgs }) => ({ node: n, frames: prepare(msgs) })),
		);
	});
	return result;
}

// ---- Reads (R-node@4) ------------------------------------------------------------------------

export interface KStatus {
	readonly cache: "empty" | "stale" | "ready";
	readonly output: "open" | "completed" | "errored";
	readonly lifecycle: "inactive" | "active" | "closing";
}

export function status(n: KNode): KStatus {
	return {
		cache: !n.has ? "empty" : n.pending ? "stale" : "ready",
		output: !n.ended ? "open" : n.ended[0] === "COMPLETE" ? "completed" : "errored",
		lifecycle: n.lifetime && !n.lifetime.open ? "closing" : n.active ? "active" : "inactive",
	};
}

/**
 * TRANSITIONAL (graphrefly-ts:D193 (1), (6)): how many subscribers and dependents hold the node,
 * read by the graph layer's helper release before it lets a node go. Removed with that release by
 * the end of phase 3 of graphrefly-ts:D817-KERNEL-REPORT-TS; nothing else may read it.
 */
export function subscriberCount(n: KNode): number {
	return n.subs.length;
}

/** Per current dependency, whether it was replaced and the function has not run since. */
export function replacedInputs(n: KNode): boolean[] {
	return n.inputs.map((input) => input.replaced);
}

// ---- Handles -----------------------------------------------------------------------------------

const records = new WeakMap<Node<unknown>, KNode>();

/** @internal Bind a Node handle to its kernel record. */
export function bindKNode(node: Node<unknown>, n: KNode): void {
	records.set(node, n);
}

/** @internal The kernel record of a Node handle. */
export function kOf(node: Node<unknown>): KNode {
	const n = records.get(node);
	if (n === undefined) throw new KernelError("node: not a kernel node");
	return n;
}

/** @internal The kernel record of a Node handle, or undefined for an object that is not one. */
export function kOfMaybe(node: unknown): KNode | undefined {
	return typeof node === "object" && node !== null ? records.get(node as Node<unknown>) : undefined;
}
