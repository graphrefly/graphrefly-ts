/**
 * @graphrefly/ts — clean-slate TypeScript package.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl + decisions.jsonl.
 * CSP-1 substrate: node / dispatcher / pool / wave protocol.
 * CSP-2 graph layer: Graph + 8-verb sugar + describe/observe/profile inspection.
 */

export { type BatchCtx, batch } from "./batch/batch.js";
export type { Ctx, CtxState, DepRecord, NodeFn, RewireNext, Sink } from "./ctx/types.js";
export {
	Dispatcher,
	defaultDispatcher,
	type Handle,
	type HandleStat,
	type Pool,
	type PoolKind,
} from "./dispatcher/index.js";
export {
	buffer,
	bufferCount,
	combine,
	combineLatest,
	concat,
	race,
	sample,
	takeUntil,
	withLatestFrom,
	zip,
} from "./graph/combinators.js";
export {
	type DescribeChangeset,
	type DescribeEvent,
	type Stratified,
	type StratifyOptions,
	type StratifyRule,
	stratify,
	stratifyBranch,
	topologyDiff,
} from "./graph/composition.js";
export type {
	IndexChange,
	ListChange,
	LogChange,
	MapChange,
} from "./graph/data-structures/change.js";
export {
	type IndexRow,
	type ReactiveIndex,
	type ReactiveIndexCapacityOrder,
	type ReactiveIndexCapacityPolicy,
	type ReactiveIndexOpt,
	type ReactiveIndexOptions,
	reactiveIndex,
} from "./graph/data-structures/reactive-index.js";
export {
	type ReactiveList,
	type ReactiveListOpt,
	type ReactiveListOptions,
	reactiveList,
} from "./graph/data-structures/reactive-list.js";
export {
	mergeReactiveLogs,
	type ReactiveLog,
	type ReactiveLogOptions,
	reactiveLog,
} from "./graph/data-structures/reactive-log.js";
export {
	type ReactiveMap,
	type ReactiveMapOpt,
	type ReactiveMapOptions,
	type ReactiveMapRetentionEntry,
	type ReactiveMapRetentionPolicy,
	reactiveMap,
} from "./graph/data-structures/reactive-map.js";
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
export {
	concatMap,
	exhaustMap,
	flatMap,
	mergeMap,
	type Project,
	repeat,
	switchMap,
} from "./graph/higher-order.js";
export type { NodeProfile, ObserveEvent, ObserveStream, Profile } from "./graph/inspect.js";
export {
	catchError,
	distinctUntilChanged,
	elementAt,
	filter,
	find,
	first,
	initNode,
	last,
	map,
	merge,
	type Operator,
	onFirstData,
	pairwise,
	reduce,
	rescue,
	type SettleOpts,
	scan,
	settle,
	skip,
	type TapObserver,
	take,
	takeWhile,
	tap,
	tapFirst,
	type ValveOpts,
	valve,
} from "./graph/operators.js";
export {
	type AsyncSourceOpts,
	fromAny,
	fromAsyncIter,
	fromIter,
	fromPromise,
	interval,
	type NodeInput,
	of,
	timer,
} from "./graph/sources.js";
export {
	audit,
	auditTime,
	bufferTime,
	debounce,
	debounceTime,
	delay,
	throttle,
	throttleTime,
	timeout,
} from "./graph/time.js";
export { dynamicNode, Node, type NodeOptions, node, type Status } from "./node/node.js";
export * from "./protocol/messages.js";
