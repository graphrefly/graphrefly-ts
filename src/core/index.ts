/**
 * Core layer: message protocol, node primitive, lifecycle (Phase 0).
 */
export * from "./actor.js";
export { batch, downWithBatch, isBatching } from "./batch.js";
export { monotonicNs, wallClockNs } from "./clock.js";
export {
	type Bundle,
	type BundleFactory,
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
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Message,
	type Messages,
	type MessageTypeRegistration,
	type MessageTypeRegistrationInput,
	PAUSE,
	RESOLVED,
	RESUME,
	START,
	TEARDOWN,
} from "./messages.js";
export {
	type DescribeDetail,
	type DescribeField,
	type DescribeNodeOutput,
	resolveDescribeFields,
} from "./meta.js";
export {
	configure,
	defaultConfig,
	type DepRecord,
	type FnCtx,
	type Node,
	type NodeDescribeKind,
	type NodeFn,
	type NodeFnCleanup,
	type NodeOptions,
	type NodeSink,
	type NodeStatus,
	type NodeTransportOptions,
	node,
	NodeImpl,
} from "./node.js";
export {
	derived,
	type DerivedFn,
	dynamicNode,
	type DynamicFn,
	effect,
	type EffectFn,
	pipe,
	type PipeOperator,
	producer,
	type ProducerFn,
	state,
	type TrackFn,
} from "./sugar.js";
export { ResettableTimer } from "./timer.js";
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
