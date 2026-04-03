// ---------------------------------------------------------------------------
// NestJS integration — Module, DI, Lifecycle, RxJS bridge (Phase 5.5)
// ---------------------------------------------------------------------------
// Bridges GraphReFly into NestJS's DI container and RxJS-based ecosystem.
// NestJS and RxJS are peer dependencies — install them in your NestJS app.
//
// Usage:
//   import { GraphReflyModule, InjectGraph, InjectNode, toObservable }
//     from '@graphrefly/graphrefly-ts/compat/nestjs';
// ---------------------------------------------------------------------------

// RxJS bridge (re-exported from extra for convenience)
export { observeGraph$, observeNode$, toMessages$, toObservable } from "../../extra/observable.js";

// Decorators
export {
	CRON_HANDLERS,
	EVENT_HANDLERS,
	GraphCron,
	type GraphCronMeta,
	GraphInterval,
	type GraphIntervalMeta,
	INTERVAL_HANDLERS,
	InjectGraph,
	InjectNode,
	OnGraphEvent,
	type OnGraphEventMeta,
} from "./decorators.js";
// Explorer (event/schedule discovery)
export { GraphReflyEventExplorer } from "./explorer.js";
// Module & DI
export {
	type GraphReflyFeatureOptions,
	GraphReflyModule,
	type GraphReflyRootOptions,
} from "./module.js";
// Injection tokens
export {
	GRAPHREFLY_REQUEST_GRAPH,
	GRAPHREFLY_ROOT_GRAPH,
	getGraphToken,
	getNodeToken,
} from "./tokens.js";
