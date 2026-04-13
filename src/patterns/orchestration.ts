/**
 * Orchestration patterns (roadmap §4.1).
 *
 * Domain-layer helpers that build workflow shapes on top of core + extra primitives.
 * Exported under the `patterns.orchestration` namespace to avoid collisions with
 * Phase 2 operator names (for example `gate`, `forEach`).
 */

import type { NodeActions } from "../core/config.js";
import {
	COMPLETE,
	DATA,
	ERROR,
	type Message,
	type Messages,
	RESOLVED,
	TEARDOWN,
} from "../core/messages.js";
import { type Node, type NodeFn, type NodeOptions, node } from "../core/node.js";
import { derived, effect, state } from "../core/sugar.js";
import { GRAPH_META_SEGMENT, Graph, type GraphOptions } from "../graph/graph.js";

export type StepRef = string | Node<unknown>;

type OrchestrationMeta = {
	orchestration?: true;
	orchestration_type?: string;
};

export type OrchestrationStepOptions = Omit<
	NodeOptions<unknown>,
	"describeKind" | "name" | "meta"
> & {
	deps?: ReadonlyArray<StepRef>;
	meta?: Record<string, unknown> & OrchestrationMeta;
};

export type BranchResult<T> = {
	branch: "then" | "else";
	value: T;
};

export type SensorControls<T> = {
	node: Node<T>;
	push(value: T): void;
	error(err: unknown): void;
	complete(): void;
};

export type LoopOptions = Omit<OrchestrationStepOptions, "deps"> & {
	iterations?: number | StepRef;
};

export type WaitOptions = Omit<OrchestrationStepOptions, "deps">;

export type SubPipelineBuilder = (sub: Graph) => void;

function resolveDep(graph: Graph, dep: StepRef): { node: Node<unknown>; path?: string } {
	if (typeof dep === "string") {
		return { node: graph.resolve(dep), path: dep };
	}
	const path = findRegisteredNodePath(graph, dep);
	if (!path) {
		throw new Error(
			"orchestration dep node must already be registered in the graph so explicit edges can be recorded; pass a string path or register the node first",
		);
	}
	return { node: dep, path };
}

function findRegisteredNodePath(graph: Graph, target: Node<unknown>): string | undefined {
	const described = graph.describe();
	const metaSegment = `::${GRAPH_META_SEGMENT}::`;
	for (const path of Object.keys(described.nodes).sort()) {
		if (path.includes(metaSegment)) continue;
		try {
			if (graph.resolve(path) === target) return path;
		} catch {
			/* ignore stale path while scanning */
		}
	}
	return undefined;
}

function registerStep(
	graph: Graph,
	name: string,
	step: Node<unknown>,
	depPaths: ReadonlyArray<string>,
): void {
	graph.add(name, step);
	for (const path of depPaths) {
		graph.connect(path, name);
	}
}

import { domainMeta } from "./_internal.js";

function baseMeta(kind: string, meta?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("orchestration", kind, meta);
}

function coerceLoopIterations(raw: unknown): number {
	const parseString = (value: string): number => {
		const trimmed = value.trim();
		if (trimmed.length === 0) return 0;
		return Number(trimmed);
	};
	let parsed: number;
	if (typeof raw === "string") {
		parsed = parseString(raw);
	} else if (raw === null) {
		parsed = 0;
	} else {
		parsed = Number(raw);
	}
	if (!Number.isFinite(parsed)) return 1;
	return Math.max(0, Math.trunc(parsed));
}

/**
 * Creates an orchestration graph container.
 */
export function pipeline(name: string, opts?: GraphOptions): Graph {
	return new Graph(name, opts);
}

/**
 * Registers a workflow task node.
 */
export function task<T>(
	graph: Graph,
	name: string,
	run: NodeFn,
	opts?: OrchestrationStepOptions,
): Node<T> {
	const depRefs = opts?.deps ?? [];
	const deps = depRefs.map((dep) => resolveDep(graph, dep));
	const { deps: _deps, ...nodeOpts } = opts ?? {};
	const step = node<T>(
		deps.map((d) => d.node),
		run,
		{
			...nodeOpts,
			name,
			describeKind: "derived",
			meta: baseMeta("task", opts?.meta),
		} as NodeOptions<T>,
	);
	registerStep(
		graph,
		name,
		step as unknown as Node<unknown>,
		deps.flatMap((d) => (d.path ? [d.path] : [])),
	);
	return step;
}

/**
 * Emits tagged branch outcomes (`then` / `else`) for each source value.
 */
export function branch<T>(
	graph: Graph,
	name: string,
	source: StepRef,
	predicate: (value: T) => boolean,
	opts?: Omit<OrchestrationStepOptions, "deps">,
): Node<BranchResult<T>> {
	const src = resolveDep(graph, source);
	const step = derived<BranchResult<T>>(
		[src.node],
		([value]) => ({
			branch: predicate(value as T) ? "then" : "else",
			value: value as T,
		}),
		{
			...opts,
			name,
			meta: baseMeta("branch", opts?.meta),
		} as NodeOptions<BranchResult<T>>,
	);
	registerStep(graph, name, step as unknown as Node<unknown>, src.path ? [src.path] : []);
	return step;
}

/**
 * Forwards source values only while `control` is truthy.
 */
export function valve<T>(
	graph: Graph,
	name: string,
	source: StepRef,
	control: StepRef,
	opts?: Omit<OrchestrationStepOptions, "deps">,
): Node<T> {
	const src = resolveDep(graph, source);
	const ctrl = resolveDep(graph, control);
	const step = derived<T>(
		[src.node, ctrl.node],
		([srcVal, ctrlVal]) => {
			if (!ctrlVal) return undefined;
			return srcVal as T;
		},
		{
			...opts,
			name,
			meta: baseMeta("valve", opts?.meta),
		} as NodeOptions<T>,
	);
	registerStep(
		graph,
		name,
		step as unknown as Node<unknown>,
		[src.path, ctrl.path].filter((v): v is string => typeof v === "string"),
	);
	return step;
}

export type ApprovalOptions = Omit<OrchestrationStepOptions, "deps"> & {
	isApproved?: (value: unknown) => boolean;
};

/**
 * Human/LLM approval gate over a source value.
 */
export function approval<T>(
	graph: Graph,
	name: string,
	source: StepRef,
	approver: StepRef,
	opts?: ApprovalOptions,
): Node<T> {
	const src = resolveDep(graph, source);
	const ctrl = resolveDep(graph, approver);
	const isApproved = opts?.isApproved ?? ((value: unknown) => Boolean(value));
	const step = derived<T>(
		[src.node, ctrl.node],
		([srcVal, ctrlVal]) => {
			if (!isApproved(ctrlVal)) return undefined;
			return srcVal as T;
		},
		{
			...opts,
			name,
			meta: baseMeta("approval", opts?.meta),
		} as NodeOptions<T>,
	);
	registerStep(
		graph,
		name,
		step as unknown as Node<unknown>,
		[src.path, ctrl.path].filter((v): v is string => typeof v === "string"),
	);
	return step;
}

// ---------------------------------------------------------------------------
// gate — human-in-the-loop approval with pending queue
// ---------------------------------------------------------------------------

export interface GateOptions {
	/** Maximum queue size. Oldest values are FIFO-dropped when exceeded. Default: Infinity. */
	maxPending?: number;
	/** Start in open mode (auto-approve). Default: false. */
	startOpen?: boolean;
	meta?: Record<string, unknown>;
}

/** Control surface returned by {@link gate}. */
export interface GateController<T> {
	/** The output node registered in the graph (subscribe to receive approved values). */
	node: Node<T>;
	/** Reactive queue of values waiting for approval. */
	pending: Node<T[]>;
	/** Derived count of pending items. */
	count: Node<number>;
	/** Whether the gate is currently open (auto-approving). */
	isOpen: Node<boolean>;
	/** Approve and forward the next `count` pending values (default: 1). */
	approve(count?: number): void;
	/** Reject (discard) the next `count` pending values (default: 1). */
	reject(count?: number): void;
	/**
	 * Transform and forward `count` pending values (default: 1).
	 * `fn` receives `(value, index, pending)` — Array.map-style.
	 */
	modify(fn: (value: T, index: number, pending: readonly T[]) => T, count?: number): void;
	/** Flush all pending values and auto-approve future values. */
	open(): void;
	/** Re-enable manual gating (stop auto-approving). */
	close(): void;
}

/**
 * Human-in-the-loop gate: queues incoming values from `source` and lets an external
 * controller {@link GateController.approve approve}, {@link GateController.reject reject},
 * or {@link GateController.modify modify} them before forwarding downstream.
 *
 * Observable surfaces (`pending`, `count`, `isOpen`) are reactive nodes registered in
 * the graph. The gate output node is also registered.
 */
export function gate<T>(
	graph: Graph,
	name: string,
	source: StepRef,
	opts?: GateOptions,
): GateController<T> {
	const maxPending = opts?.maxPending ?? Infinity;
	if (maxPending < 1 && maxPending !== Infinity) {
		throw new RangeError("gate: maxPending must be >= 1");
	}
	const startOpen = opts?.startOpen ?? false;

	const src = resolveDep(graph, source);

	// Internal reactive state
	const pendingNode = state<T[]>([], { name: "pending", equals: () => false });
	const isOpenNode = state<boolean>(startOpen, { name: "isOpen" });
	const countNode = derived<number>([pendingNode], ([arr]) => (arr as T[]).length, {
		name: "count",
	});

	let queue: T[] = [];
	let torn = false;

	function syncPending(): void {
		pendingNode.down([[DATA, [...queue]]]);
	}

	function enqueue(value: T): void {
		queue.push(value);
		if (queue.length > maxPending) queue.shift();
		syncPending();
	}

	function dequeue(n: number): T[] {
		const items = queue.splice(0, n);
		syncPending();
		return items;
	}

	function guardTorn(method: string): void {
		if (torn) throw new Error(`gate: ${method}() called after gate was torn down`);
	}

	// The output node: a producer-like node that subscribes to source
	// Producer pattern: manually subscribe to source for per-message interception
	// (onMessage removed in v5 — use producer+subscribe instead)
	const output = node<T>(
		[],
		(data, actions) => {
			const unsub = src.node.subscribe((msgs) => {
				for (const msg of msgs) {
					if (msg[0] === DATA) {
						if (isOpenNode.cache) {
							actions.emit(msg[1] as T);
						} else {
							enqueue(msg[1] as T);
							actions.down([[RESOLVED]]);
						}
					} else if (msg[0] === TEARDOWN) {
						torn = true;
						queue = [];
						syncPending();
						actions.down([msg]);
					} else if (msg[0] === COMPLETE || msg[0] === ERROR) {
						torn = true;
						queue = [];
						syncPending();
						actions.down([msg]);
					} else {
						actions.down([msg]);
					}
				}
			});
			return () => unsub();
		},
		{
			name,
			describeKind: "derived",
			meta: baseMeta("gate", opts?.meta),
		},
	);

	const controller: GateController<T> = {
		node: output,
		pending: pendingNode,
		count: countNode,
		isOpen: isOpenNode,
		approve(count = 1) {
			guardTorn("approve");
			const items = dequeue(count);
			for (const item of items) {
				if (torn) break;
				output.down([[DATA, item]]);
			}
		},
		reject(count = 1) {
			guardTorn("reject");
			dequeue(count);
		},
		modify(fn, count = 1) {
			guardTorn("modify");
			const snapshot = [...queue] as readonly T[];
			const items = dequeue(count);
			for (let i = 0; i < items.length; i++) {
				if (torn) break;
				output.down([[DATA, fn(items[i], i, snapshot)]]);
			}
		},
		open() {
			guardTorn("open");
			isOpenNode.down([[DATA, true]]);
			// Flush all pending
			const items = dequeue(queue.length);
			for (const item of items) {
				if (torn) break;
				output.down([[DATA, item]]);
			}
		},
		close() {
			guardTorn("close");
			isOpenNode.down([[DATA, false]]);
		},
	};

	// Activate count so it stays reactive
	graph.addDisposer(countNode.subscribe(() => undefined));

	// Register output + internal state as a mounted subgraph (aligned with PY)
	registerStep(graph, name, output as unknown as Node<unknown>, src.path ? [src.path] : []);
	const internal = new Graph(`${name}_state`);
	internal.add("pending", pendingNode);
	internal.add("isOpen", isOpenNode);
	internal.add("count", countNode);
	internal.connect("pending", "count");
	graph.mount(`${name}_state`, internal);

	return controller;
}

/**
 * Registers a workflow side-effect step. The step remains graph-observable and forwards messages.
 */
export function forEach<T>(
	graph: Graph,
	name: string,
	source: StepRef,
	run: (value: T, actions: NodeActions) => void,
	opts?: Omit<OrchestrationStepOptions, "deps">,
): Node<T> {
	const src = resolveDep(graph, source);
	let terminated = false;
	// Producer pattern: manually subscribe to source for per-message interception
	// (onMessage removed in v5 — use producer+subscribe instead)
	const step = node<T>(
		[],
		(data, actions) => {
			const unsub = src.node.subscribe((msgs) => {
				for (const msg of msgs) {
					if (terminated) return;
					if (msg[0] === DATA) {
						try {
							run(msg[1] as T, actions);
							actions.down([msg] satisfies Messages);
						} catch (err) {
							terminated = true;
							actions.down([[ERROR, err]] satisfies Messages);
						}
					} else {
						actions.down([msg] satisfies Messages);
						if (msg[0] === COMPLETE || msg[0] === ERROR) terminated = true;
					}
				}
			});
			return () => unsub();
		},
		{
			...opts,
			name,
			describeKind: "effect",
			completeWhenDepsComplete: false,
			meta: baseMeta("forEach", opts?.meta),
		} as NodeOptions<T>,
	);
	registerStep(graph, name, step as unknown as Node<unknown>, src.path ? [src.path] : []);
	return step;
}

/**
 * Registers a join step that emits a tuple of latest dependency values.
 */
export function join<T extends readonly unknown[]>(
	graph: Graph,
	name: string,
	deps: { [K in keyof T]: StepRef },
	opts?: Omit<OrchestrationStepOptions, "deps">,
): Node<T> {
	const resolved = deps.map((dep) => resolveDep(graph, dep));
	const step = derived<T>(
		resolved.map((d) => d.node),
		(values) => values as T,
		{
			...opts,
			name,
			meta: baseMeta("join", opts?.meta),
		} as NodeOptions<T>,
	);
	registerStep(
		graph,
		name,
		step as unknown as Node<unknown>,
		resolved.flatMap((d) => (d.path ? [d.path] : [])),
	);
	return step;
}

/**
 * Registers a loop step that applies `iterate` to each source value N times.
 */
export function loop<T>(
	graph: Graph,
	name: string,
	source: StepRef,
	iterate: (value: T, iteration: number, actions: NodeActions) => T,
	opts?: LoopOptions,
): Node<T> {
	const src = resolveDep(graph, source);
	const iterRef = opts?.iterations;
	const iterDep =
		typeof iterRef === "number" || iterRef === undefined ? undefined : resolveDep(graph, iterRef);
	const staticIterations = typeof iterRef === "number" ? iterRef : undefined;
	const step = node<T>(
		iterDep ? [src.node, iterDep.node] : [src.node],
		(depValues, actions) => {
			let current = depValues[0] as T;
			const rawCount = staticIterations ?? (iterDep ? depValues[1] : 1);
			const count = coerceLoopIterations(rawCount);
			for (let i = 0; i < count; i += 1) {
				current = iterate(current, i, actions);
			}
			actions.emit(current);
		},
		{
			...opts,
			name,
			describeKind: "derived",
			meta: baseMeta("loop", opts?.meta),
		} as NodeOptions<T>,
	);
	registerStep(
		graph,
		name,
		step as unknown as Node<unknown>,
		[src.path, iterDep?.path].filter((v): v is string => typeof v === "string"),
	);
	return step;
}

/**
 * Mounts and returns a child workflow graph.
 */
export function subPipeline(
	graph: Graph,
	name: string,
	childOrBuild?: Graph | SubPipelineBuilder,
	opts?: GraphOptions,
): Graph {
	const child = childOrBuild instanceof Graph ? childOrBuild : pipeline(name, opts);
	if (typeof childOrBuild === "function") {
		childOrBuild(child);
	}
	graph.mount(name, child);
	return child;
}

/**
 * Registers a producer-style sensor source and returns imperative controls.
 */
export function sensor<T>(
	graph: Graph,
	name: string,
	initial?: T,
	opts?: Omit<NodeOptions<unknown>, "name" | "describeKind" | "meta"> & {
		meta?: Record<string, unknown>;
	},
): SensorControls<T> {
	const source = node<T>([], () => undefined, {
		...opts,
		name,
		initial,
		describeKind: "producer",
		meta: baseMeta("sensor", opts?.meta),
	});
	registerStep(graph, name, source as unknown as Node<unknown>, []);
	return {
		node: source,
		push(value: T) {
			source.down([[DATA, value]] satisfies Messages);
		},
		error(err: unknown) {
			source.down([[ERROR, err]] satisfies Messages);
		},
		complete() {
			source.down([[COMPLETE]] satisfies Messages);
		},
	};
}

/**
 * Registers a delayed-forwarding step (value-level wait).
 */
export function wait<T>(
	graph: Graph,
	name: string,
	source: StepRef,
	ms: number,
	opts?: WaitOptions,
): Node<T> {
	const src = resolveDep(graph, source);
	const timers = new Set<ReturnType<typeof setTimeout>>();
	let terminated = false;
	let completed = false;

	function clearAllTimers(): void {
		for (const id of timers) clearTimeout(id);
		timers.clear();
	}

	// Producer pattern: 0 deps, manual subscribe to source.
	// Under Model B (push-on-subscribe) the fn runs eagerly via _startProducer,
	// ensuring the cleanup is registered and timers are cleared on teardown.
	// Only set initial if source has a real cached value (not SENTINEL/undefined).
	const srcVal = src.node.cache;
	const initialOpt = srcVal !== undefined ? { initial: srcVal as T } : {};

	const step = node<T>(
		[],
		(_deps, actions) => {
			clearAllTimers();
			terminated = false;
			completed = false;
			const unsub = src.node.subscribe((msgs) => {
				for (const msg of msgs) {
					if (terminated) return;
					if (msg[0] === DATA) {
						const id = setTimeout(() => {
							timers.delete(id);
							actions.down([msg] satisfies Messages);
							if (completed && timers.size === 0) {
								actions.down([[COMPLETE]] satisfies Messages);
							}
						}, ms);
						timers.add(id);
					} else if (msg[0] === COMPLETE) {
						terminated = true;
						completed = true;
						if (timers.size === 0) {
							actions.down([[COMPLETE]] satisfies Messages);
						}
					} else if (msg[0] === ERROR) {
						terminated = true;
						clearAllTimers();
						actions.down([msg] satisfies Messages);
					} else {
						actions.down([msg] satisfies Messages);
					}
				}
			});
			return () => {
				unsub();
				clearAllTimers();
				terminated = true;
			};
		},
		{
			...opts,
			name,
			...initialOpt,
			describeKind: "derived",
			completeWhenDepsComplete: false,
			meta: baseMeta("wait", opts?.meta),
		} as NodeOptions<T>,
	);
	// Producer pattern: register in graph without dep edges (manual subscription).
	// Record a logical edge for describe() even though the dep is not in constructor deps.
	graph.add(name, step as unknown as Node<unknown>);
	if (src.path) {
		try {
			graph.connect(src.path, name);
		} catch (e) {
			// connect validates constructor deps — expected to fail for producer
			// pattern. Re-throw unexpected errors to surface wiring bugs.
			if (!(e instanceof Error && /dep|edge|connect/i.test(e.message))) throw e;
		}
	}
	return step;
}

/**
 * Registers an error-recovery step for a source.
 */
export function onFailure<T>(
	graph: Graph,
	name: string,
	source: StepRef,
	recover: (err: unknown, actions: NodeActions) => T,
	opts?: Omit<OrchestrationStepOptions, "deps">,
): Node<T> {
	const src = resolveDep(graph, source);
	let terminated = false;
	// Producer pattern: manually subscribe to source for per-message interception
	// (onMessage removed in v5 — use producer+subscribe instead)
	const step = node<T>(
		[],
		(data, actions) => {
			const unsub = src.node.subscribe((msgs) => {
				for (const msg of msgs) {
					if (terminated) return;
					if (msg[0] === ERROR) {
						try {
							actions.emit(recover(msg[1], actions));
						} catch (err) {
							terminated = true;
							actions.down([[ERROR, err]] satisfies Messages);
						}
					} else {
						actions.down([msg] satisfies Messages);
						if (msg[0] === COMPLETE) terminated = true;
					}
				}
			});
			return () => unsub();
		},
		{
			...opts,
			name,
			describeKind: "derived",
			completeWhenDepsComplete: false,
			meta: baseMeta("onFailure", opts?.meta),
		} as NodeOptions<T>,
	);
	registerStep(graph, name, step as unknown as Node<unknown>, src.path ? [src.path] : []);
	return step;
}
