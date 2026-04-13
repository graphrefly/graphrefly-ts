/**
 * Core layer: message protocol, node primitive, lifecycle (Phase 0).
 */
export * from "./actor.js";
export { batch, downWithBatch, isBatching } from "./batch.js";
export { monotonicNs, wallClockNs } from "./clock.js";
export {
	GraphReFlyConfig,
	type MessageContext,
	type NodeActions,
	type NodeCtx,
	type OnMessageHandler,
	type OnSubscribeHandler,
	registerBuiltins,
	type SubscribeContext,
} from "./config.js";
export * from "./guard.js";
export {
	COMPLETE,
	COMPLETE_MSG,
	COMPLETE_ONLY_BATCH,
	DATA,
	DIRTY,
	DIRTY_MSG,
	DIRTY_ONLY_BATCH,
	ERROR,
	INVALIDATE,
	INVALIDATE_MSG,
	INVALIDATE_ONLY_BATCH,
	type Message,
	type Messages,
	type MessageTypeRegistration,
	type MessageTypeRegistrationInput,
	PAUSE,
	RESOLVED,
	RESOLVED_MSG,
	RESOLVED_ONLY_BATCH,
	RESUME,
	START,
	START_MSG,
	TEARDOWN,
	TEARDOWN_MSG,
	TEARDOWN_ONLY_BATCH,
} from "./messages.js";
export {
	type DescribeDetail,
	type DescribeField,
	type DescribeNodeOutput,
	resolveDescribeFields,
} from "./meta.js";
export {
	configure,
	type DepRecord,
	defaultConfig,
	type FnCtx,
	type Node,
	type NodeDescribeKind,
	type NodeFn,
	type NodeFnCleanup,
	NodeImpl,
	type NodeInspectorHook,
	type NodeInspectorHookEvent,
	type NodeOptions,
	type NodeSink,
	type NodeStatus,
	type NodeTransportOptions,
	node,
} from "./node.js";
export {
	autoTrackNode,
	type DerivedFn,
	type DynamicFn,
	derived,
	dynamicNode,
	type EffectFn,
	effect,
	type PipeOperator,
	type ProducerFn,
	pipe,
	producer,
	state,
	type TrackFn,
} from "./sugar.js";
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
