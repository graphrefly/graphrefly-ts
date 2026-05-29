/**
 * @graphrefly/ts — clean-slate TypeScript package.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl + decisions.jsonl.
 * CSP-1 substrate: node / dispatcher / pool / wave protocol.
 * CSP-2 graph layer: Graph + 8-verb sugar + describe/observe/profile inspection.
 */

export { type BatchCtx, batch } from "./batch/batch.js";
export type { Ctx, CtxState, DepRecord, NodeFn, Sink } from "./ctx/types.js";
export {
	Dispatcher,
	defaultDispatcher,
	type Handle,
	type HandleStat,
	type Pool,
	type PoolKind,
} from "./dispatcher/index.js";
export type {
	DescribeEdge,
	DescribeNode,
	DescribeOpts,
	DescribeSnapshot,
} from "./graph/describe.js";
export {
	type DerivedFn,
	type EffectFn,
	Graph,
	type GraphOptions,
	graph,
	StateNode,
	type SugarOpts,
} from "./graph/graph.js";
export type { NodeProfile, ObserveEvent, ObserveStream, Profile } from "./graph/inspect.js";
export { dynamicNode, Node, type NodeOptions, node, type Status } from "./node/node.js";
export * from "./protocol/messages.js";
