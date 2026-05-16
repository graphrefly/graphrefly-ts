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

// Decorators
export {
	COMMAND_HANDLERS,
	CommandHandler,
	type CommandHandlerMeta,
	CQRS_EVENT_HANDLERS,
	CRON_HANDLERS,
	EVENT_HANDLERS,
	EventHandler,
	type EventHandlerMeta,
	GraphCron,
	type GraphCronMeta,
	GraphInterval,
	type GraphIntervalMeta,
	INTERVAL_HANDLERS,
	InjectCqrsGraph,
	InjectGraph,
	InjectNode,
	OnGraphEvent,
	type OnGraphEventMeta,
	QUERY_HANDLERS,
	QueryHandler,
	type QueryHandlerMeta,
	SAGA_HANDLERS,
	SagaHandler,
	type SagaHandlerMeta,
} from "./decorators.js";
// Explorer (event/schedule discovery)
export { GraphReflyEventExplorer } from "./explorer.js";
// Gateway helpers (Phase 5.1)
export {
	ObserveGateway,
	type ObserveGatewayOptions,
	type ObserveSSEOptions,
	type ObserveSubscriptionOptions,
	type ObserveWsCommand,
	type ObserveWsMessage,
	observeSSE,
	observeSubscription,
} from "./gateway.js";
// Actor bridge (Phase 5.1)
export {
	ACTOR_KEY,
	type ActorExtractor,
	fromHeader,
	fromJwtPayload,
	GraphReflyGuard,
	GraphReflyGuardImpl,
	getActor,
} from "./guard.js";
// Module & DI
export {
	type GraphReflyCqrsOptions,
	type GraphReflyFeatureOptions,
	GraphReflyModule,
	type GraphReflyRootOptions,
} from "./module.js";
// RxJS bridge — NestJS-flavored: returns a real rxjs `Observable` (the base
// `toObservable` is dependency-free and returns a Symbol.observable interop;
// this layer wraps it with rxjs `from()` since `@nestjs/common` pulls rxjs).
export { type ToObservableOptions, toObservable } from "./observable.js";
// Injection tokens
export {
	GRAPHREFLY_REQUEST_GRAPH,
	GRAPHREFLY_ROOT_GRAPH,
	getGraphToken,
	getNodeToken,
} from "./tokens.js";
