/**
 * Core layer: message protocol, node primitive, lifecycle (Phase 0).
 */
export * from "./actor.js";
export * from "./batch.js";
export { monotonicNs, wallClockNs } from "./clock.js";
export * from "./dynamic-node.js";
export * from "./guard.js";
export * from "./messages.js";
export * from "./meta.js";
export {
	type Node,
	type NodeActions,
	type NodeDescribeKind,
	type NodeFn,
	type NodeOptions,
	type NodeSink,
	type NodeStatus,
	type NodeTransportOptions,
	node,
	type OnMessageHandler,
	type SubscribeHints,
} from "./node.js";
export * from "./sugar.js";
export {
	advanceVersion,
	createVersioning,
	defaultHash,
	type HashFn,
	isV1,
	type NodeVersionInfo,
	type V0,
	type V1,
	type VersioningLevel,
	type VersioningOptions,
} from "./versioning.js";
