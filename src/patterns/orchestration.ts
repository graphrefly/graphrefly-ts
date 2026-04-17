/**
 * Orchestration patterns (roadmap §4.1).
 *
 * Domain-layer helpers that build workflow shapes on top of core + extra primitives.
 * Exported under the `patterns.orchestration` namespace to avoid collisions with
 * Phase 2 operator names (for example `gate`, `forEach`).
 */

import type { NodeActions } from "../core/config.js";
import { COMPLETE, DATA, ERROR, type Messages, RESOLVED } from "../core/messages.js";
import { type Node, type NodeFn, type NodeOptions, node } from "../core/node.js";
import { type DerivedFn, derived, state } from "../core/sugar.js";
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
	// depPaths used to drive graph.connect() edge-registry calls; after
	// Unit 7 edges are derived from node _deps and this wiring is a no-op.
	void depPaths;
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
	run: DerivedFn<T>,
	opts?: OrchestrationStepOptions,
): Node<T> {
	const depRefs = opts?.deps ?? [];
	const deps = depRefs.map((dep) => resolveDep(graph, dep));
	const { deps: _deps, ...nodeOpts } = opts ?? {};
	const wrapped: NodeFn = (batchData, actions, ctx) => {
		const data = batchData.map((batch, i) =>
			batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
		);
		actions.emit(run(data, ctx));
		return undefined;
	};
	const step = node<T>(
		deps.map((d) => d.node),
		wrapped,
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
	// Raw node so we can emit RESOLVED (hold) instead of DATA(undefined) when closed.
	const step = node<T>(
		[src.node, ctrl.node],
		(batchData, actions, ctx) => {
			const batch0 = batchData[0];
			const batch1 = batchData[1];
			// undefined = control never sent DATA (closed); falsy = explicitly closed.
			const ctrlVal = batch1 != null && batch1.length > 0 ? batch1.at(-1) : ctx.prevData[1];
			// Control just opened and no new source data this wave: re-emit last source value.
			if (batch0 == null || batch0.length === 0) {
				if (batch1 != null && batch1.length > 0 && ctrlVal && ctx.prevData[0] !== undefined) {
					actions.emit(ctx.prevData[0] as T);
				} else {
					actions.down([[RESOLVED]]);
				}
				return;
			}
			if (!ctrlVal) {
				actions.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0 as T[]) actions.emit(v);
		},
		{
			...opts,
			name,
			describeKind: "derived",
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
	// Raw node so we can emit RESOLVED (hold) instead of DATA(undefined) when not approved.
	const step = node<T>(
		[src.node, ctrl.node],
		(batchData, actions, ctx) => {
			const batch0 = batchData[0];
			const batch1 = batchData[1];
			// undefined = approver never sent DATA (not yet approved).
			const ctrlVal = batch1 != null && batch1.length > 0 ? batch1.at(-1) : ctx.prevData[1];
			if (ctrlVal === undefined || !isApproved(ctrlVal)) {
				actions.down([[RESOLVED]]);
				return;
			}
			if (batch0 == null || batch0.length === 0) {
				// Approval just granted and no new source data: re-emit last source value.
				if (batch1 != null && batch1.length > 0 && ctx.prevData[0] !== undefined) {
					actions.emit(ctx.prevData[0] as T);
				} else {
					actions.down([[RESOLVED]]);
				}
				return;
			}
			for (const v of batch0 as T[]) actions.emit(v);
		},
		{
			...opts,
			name,
			describeKind: "derived",
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
	// Capture `isOpenNode` DATA into a closure variable fed by its own subscribe
	// handler. The output producer consults `latestIsOpen` instead of reading
	// `isOpenNode.cache` from inside its callback — keeps the gate decision on
	// the protocol delivery path (P3 audit #11). Seeded with `startOpen` at
	// wiring time so the first item arriving before any open()/close() uses
	// the same value the state node was constructed with. Same template as
	// the `stratify` rule-capture pattern.
	let latestIsOpen = startOpen;
	const isOpenUnsub = isOpenNode.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA) latestIsOpen = m[1] as boolean;
		}
	});

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

	const output = node<T>(
		[src.node],
		(batchData, actions, ctx) => {
			const terminal = ctx.terminalDeps[0];
			if (terminal !== undefined) {
				torn = true;
				queue = [];
				syncPending();
				actions.down(terminal === true ? [[COMPLETE]] : [[ERROR, terminal]]);
				return;
			}
			const batch0 = batchData[0];
			if (batch0 == null || batch0.length === 0) {
				actions.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0 as T[]) {
				if (latestIsOpen) {
					actions.emit(v);
				} else {
					enqueue(v);
					actions.down([[RESOLVED]]);
				}
			}
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
	// Tear down the isOpen capture when the owning graph disposes.
	graph.addDisposer(isOpenUnsub);

	// Register output + internal state as a mounted subgraph (aligned with PY)
	registerStep(graph, name, output as unknown as Node<unknown>, src.path ? [src.path] : []);
	const internal = new Graph(`${name}_state`);
	internal.add("pending", pendingNode);
	internal.add("isOpen", isOpenNode);
	internal.add("count", countNode);
	graph.mount(`${name}_state`, internal);

	return controller;
}

/**
 * Registers a workflow side-effect step that runs `run` for each upstream
 * DATA value.
 *
 * `run` receives the full `NodeActions` and is the **sole emission point** —
 * call `actions.emit(v)` or `actions.down(msgs)` inside `run` to produce
 * downstream output. If `run` does not emit, this step acts as a pure
 * side-effect sink (graph-observable but no output). Throwing inside `run`
 * terminates the step with ERROR.
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
	const step = node<T>(
		[src.node],
		(batchData, actions, ctx) => {
			if (terminated) {
				actions.down([[RESOLVED]]);
				return;
			}
			// Terminal from dep
			const terminal = ctx.terminalDeps[0];
			if (terminal !== undefined) {
				terminated = true;
				actions.down(terminal === true ? [[COMPLETE]] : [[ERROR, terminal]]);
				return;
			}
			const batch0 = batchData[0];
			if (batch0 == null || batch0.length === 0) {
				actions.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0 as T[]) {
				try {
					run(v, actions);
				} catch (err) {
					terminated = true;
					actions.down([[ERROR, err]]);
					return;
				}
			}
		},
		{
			...opts,
			name,
			describeKind: "effect",
			completeWhenDepsComplete: false,
			meta: baseMeta("forEach", opts?.meta),
		} as NodeOptions<T>,
	);
	// registerStep registers the edge for graph visibility. g.connect's dedup
	// check skips _addDep since src.node is already a constructor dep.
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
		(depValues, actions, ctx) => {
			const batch0 = depValues[0];
			let current = (batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0]) as T;
			const batch1 = iterDep ? depValues[1] : undefined;
			const rawCount =
				staticIterations ??
				(iterDep ? (batch1 != null && batch1.length > 0 ? batch1.at(-1) : ctx.prevData[1]) : 1);
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
	// Post edge-registry deletion (Unit 7), edges are derived from node `_deps`
	// exclusively; this producer's logical dep on `src` is not reflected in
	// `describe()` — by design, since there is no real constructor-time
	// dependency to show.
	graph.add(name, step as unknown as Node<unknown>);
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
		(_data, actions) => {
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
			// onFailure handles errors via manual subscription (recover callback).
			// Disable auto-propagation so dep-channel ERROR doesn't terminate this
			// node before the recover callback has a chance to emit a replacement value.
			errorWhenDepsError: false,
			meta: baseMeta("onFailure", opts?.meta),
		} as NodeOptions<T>,
	);
	registerStep(graph, name, step as unknown as Node<unknown>, src.path ? [src.path] : []);
	return step;
}
