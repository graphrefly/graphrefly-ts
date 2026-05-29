/**
 * @graphrefly/ts — clean-slate TypeScript substrate (CSP-1 kernel).
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl + decisions.jsonl (D1-D36).
 * Scope: node / dispatcher / pool / wave protocol. The graph layer, 8-verb sugar,
 * operators, and inspection are CSP-2.
 */

export { type BatchCtx, batch } from "./batch/batch.js";
export type { Ctx, CtxState, DepRecord, NodeFn, Sink } from "./ctx/types.js";
export {
	Dispatcher,
	defaultDispatcher,
	type Handle,
	type Pool,
	type PoolKind,
} from "./dispatcher/index.js";
export { dynamicNode, Node, type NodeOptions, node, type Status } from "./node/node.js";
export * from "./protocol/messages.js";
