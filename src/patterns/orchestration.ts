/**
 * Orchestration patterns (roadmap §4.1).
 *
 * Domain-layer helpers that build workflow shapes on top of core + extra primitives.
 * Exported under the `patterns.orchestration` namespace to avoid collisions with
 * Phase 2 operator names (for example `gate`, `forEach`).
 */

import { RESOLVED } from "../core/messages.js";
import { type Node, type NodeActions, type NodeFn, type NodeOptions, node } from "../core/node.js";
import { GRAPH_META_SEGMENT, Graph, type GraphOptions } from "../graph/graph.js";

export type StepRef = string | Node<unknown>;

type OrchestrationMeta = {
	orchestration?: true;
	orchestration_type?: string;
};

export type OrchestrationStepOptions = Omit<NodeOptions, "describeKind" | "name" | "meta"> & {
	deps?: ReadonlyArray<StepRef>;
	meta?: Record<string, unknown> & OrchestrationMeta;
};

export type BranchResult<T> = {
	branch: "then" | "else";
	value: T;
};

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

function baseMeta(kind: string, meta?: Record<string, unknown>): Record<string, unknown> {
	return {
		orchestration: true,
		orchestration_type: kind,
		...(meta ?? {}),
	};
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
	run: NodeFn<T>,
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
		},
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
	const step = node<BranchResult<T>>(
		[src.node],
		([value]) => ({
			branch: predicate(value as T) ? "then" : "else",
			value: value as T,
		}),
		{
			...opts,
			name,
			describeKind: "derived",
			meta: baseMeta("branch", opts?.meta),
		},
	);
	registerStep(graph, name, step as unknown as Node<unknown>, src.path ? [src.path] : []);
	return step;
}

/**
 * Forwards source values only while `control` is truthy.
 */
export function gate<T>(
	graph: Graph,
	name: string,
	source: StepRef,
	control: StepRef,
	opts?: Omit<OrchestrationStepOptions, "deps">,
): Node<T> {
	const src = resolveDep(graph, source);
	const ctrl = resolveDep(graph, control);
	const step = node<T>(
		[src.node, ctrl.node],
		(_deps, actions) => {
			const opened = ctrl.node.get();
			if (!opened) {
				actions.down([[RESOLVED]]);
				return undefined;
			}
			return src.node.get() as T;
		},
		{
			...opts,
			name,
			describeKind: "operator",
			meta: baseMeta("gate", opts?.meta),
		},
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
	const step = node<T>(
		[src.node, ctrl.node],
		(_deps, actions: NodeActions) => {
			if (!isApproved(ctrl.node.get())) {
				actions.down([[RESOLVED]]);
				return undefined;
			}
			return src.node.get() as T;
		},
		{
			...opts,
			name,
			describeKind: "operator",
			meta: baseMeta("approval", opts?.meta),
		},
	);
	registerStep(
		graph,
		name,
		step as unknown as Node<unknown>,
		[src.path, ctrl.path].filter((v): v is string => typeof v === "string"),
	);
	return step;
}
