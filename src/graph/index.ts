/**
 * Graph container: registry, wiring, introspection (Phase 1).
 */

export { OVERHEAD as SIZEOF_OVERHEAD, SIZEOF_SYMBOL, sizeof } from "../extra/utils/sizeof.js";
export {
	createDagCborCodec,
	createDagCborZstdCodec,
	decodeEnvelope,
	ENVELOPE_VERSION,
	type EvictedSubgraphInfo,
	type EvictionPolicy,
	encodeEnvelope,
	type GraphCodec,
	JsonCodec,
	type LazyGraphCodec,
	registerBuiltinCodecs,
	replayWAL,
	type WALEntry,
} from "./codec.js";
export {
	type CausalChain,
	type CausalStep,
	type ExplainPathOptions,
	explainPath,
} from "./explain.js";
export {
	type DescribeFilter,
	diffForWAL,
	GRAPH_META_SEGMENT,
	Graph,
	type GraphActorOptions,
	type GraphAttachStorageOptions,
	type GraphCheckpointRecord,
	type GraphDescribeOptions,
	type GraphDescribeOutput,
	type GraphDiagramDirection,
	type GraphDiffChange,
	type GraphDiffResult,
	type GraphFactoryContext,
	type GraphNodeFactory,
	type GraphObserveAll,
	type GraphObserveOne,
	type GraphOptions,
	type GraphPersistSnapshot,
	type GraphVersionChange,
	type GraphWALDiff,
	type ObserveDetail,
	type ObserveEvent,
	type ObserveOptions,
	type ObserveResult,
	type ObserveTheme,
	type ObserveThemeName,
	type ReachableDirection,
	type ReachableOptions,
	reachable,
	SNAPSHOT_VERSION,
	type TopologyEvent,
	type TraceEntry,
} from "./graph.js";
export {
	type GraphProfileOptions,
	type GraphProfileResult,
	graphProfile,
	type NodeProfile,
} from "./profile.js";
export { watchTopologyTree } from "./topology-tree.js";
export {
	type ObservabilityCheck,
	type ObservabilityDescribeFormat,
	type ValidateObservabilityOptions,
	type ValidateObservabilityResult,
	validateGraphObservability,
} from "./validate-observability.js";
