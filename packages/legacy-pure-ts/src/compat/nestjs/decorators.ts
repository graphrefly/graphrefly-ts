// ---------------------------------------------------------------------------
// NestJS decorators for GraphReFly DI, events, and scheduling.
// ---------------------------------------------------------------------------
// NOTE: esbuild (used by vitest/vite) uses TC39 Stage 3 decorators, not
// legacy TypeScript experimental decorators. Method decorators receive
// (value: DecoratorBoundMethod, context: ClassMethodDecoratorContext). We use
// context.addInitializer() to register metadata when the class instance is
// created, which runs before NestJS lifecycle hooks.
// ---------------------------------------------------------------------------

import { Inject } from "@nestjs/common";
import {
	GRAPHREFLY_REQUEST_GRAPH,
	GRAPHREFLY_ROOT_GRAPH,
	getGraphToken,
	getNodeToken,
} from "./tokens.js";

/** Class constructor key for decorator registries and Nest `ModuleRef.get()`. */
export type DecoratorHostConstructor = abstract new (...args: unknown[]) => unknown;

/**
 * TC39 Stage 3 class method decorator first argument (the method itself).
 * Narrower than `Function` for Biome `noBannedTypes`.
 */
export type DecoratorBoundMethod = (...args: unknown[]) => unknown;

// ---------------------------------------------------------------------------
// Global registries (populated by decorator initializers, read by explorer)
// ---------------------------------------------------------------------------

export interface OnGraphEventMeta {
	nodeName: string;
	methodKey: string | symbol;
}

export interface GraphIntervalMeta {
	ms: number;
	methodKey: string | symbol;
}

export interface GraphCronMeta {
	expr: string;
	methodKey: string | symbol;
}

/** Registry: constructor → event handler metadata. */
export const EVENT_HANDLERS = new Map<DecoratorHostConstructor, OnGraphEventMeta[]>();
/** Registry: constructor → interval metadata. */
export const INTERVAL_HANDLERS = new Map<DecoratorHostConstructor, GraphIntervalMeta[]>();
/** Registry: constructor → cron metadata. */
export const CRON_HANDLERS = new Map<DecoratorHostConstructor, GraphCronMeta[]>();

// ---------------------------------------------------------------------------
// CQRS decorator metadata & registries (Phase 5.5 — CQRS replacement)
// ---------------------------------------------------------------------------

export interface CommandHandlerMeta {
	cqrsName: string;
	commandName: string;
	methodKey: string | symbol;
}

export interface EventHandlerMeta {
	cqrsName: string;
	eventName: string;
	methodKey: string | symbol;
}

export interface QueryHandlerMeta {
	cqrsName: string;
	projectionName: string;
	methodKey: string | symbol;
}

export interface SagaHandlerMeta {
	cqrsName: string;
	eventNames: readonly string[];
	sagaName: string;
	methodKey: string | symbol;
}

/** Registry: constructor → command handler metadata. */
export const COMMAND_HANDLERS = new Map<DecoratorHostConstructor, CommandHandlerMeta[]>();
/** Registry: constructor → event handler metadata. */
export const CQRS_EVENT_HANDLERS = new Map<DecoratorHostConstructor, EventHandlerMeta[]>();
/** Registry: constructor → query handler metadata. */
export const QUERY_HANDLERS = new Map<DecoratorHostConstructor, QueryHandlerMeta[]>();
/** Registry: constructor → saga handler metadata. */
export const SAGA_HANDLERS = new Map<DecoratorHostConstructor, SagaHandlerMeta[]>();

// ---------------------------------------------------------------------------
// DI decorators
// ---------------------------------------------------------------------------

/**
 * Inject a `Graph` instance into a NestJS service or controller.
 *
 * - No argument → injects the root graph (from `forRoot()`).
 * - With `name` → injects the named feature graph (from `forFeature({ name })`).
 * - With `"request"` → injects the request-scoped graph (requires `requestScope: true`).
 *
 * @example
 * ```ts
 * @Injectable()
 * export class PaymentService {
 *   constructor(
 *     @InjectGraph() private root: Graph,
 *     @InjectGraph("payments") private payments: Graph,
 *   ) {}
 * }
 * ```
 */
export function InjectGraph(name?: string): ParameterDecorator & PropertyDecorator {
	if (name === "request") return Inject(GRAPHREFLY_REQUEST_GRAPH);
	return Inject(name ? getGraphToken(name) : GRAPHREFLY_ROOT_GRAPH);
}

/**
 * Inject a `CqrsGraph` instance into a NestJS service or controller.
 *
 * Typed alternative to `@InjectGraph(name)` — returns `CqrsGraph` instead of `Graph`,
 * giving access to `.command()`, `.dispatch()`, `.event()`, `.projection()`, `.saga()`.
 *
 * @param name - The CQRS graph name (from `forCqrs({ name })`).
 *
 * @example
 * ```ts
 * @Injectable()
 * export class OrderService {
 *   constructor(@InjectCqrsGraph("orders") private orders: CqrsGraph) {
 *     orders.dispatch("placeOrder", { id: "1" }); // fully typed
 *   }
 * }
 * ```
 */
export function InjectCqrsGraph(name: string): ParameterDecorator & PropertyDecorator {
	return Inject(getGraphToken(name));
}

/**
 * Inject a `Node` from the graph by its qualified path.
 *
 * The path must be declared in the `nodes` array of `forRoot()` or `forFeature()`.
 * The module registers a factory provider that resolves the node from the root graph
 * at injection time.
 *
 * @example
 * ```ts
 * GraphReflyModule.forRoot({ nodes: ["payment::validate"] })
 *
 * @Injectable()
 * export class PaymentService {
 *   constructor(@InjectNode("payment::validate") private validate: Node<boolean>) {}
 * }
 * ```
 */
export function InjectNode(path: string): ParameterDecorator & PropertyDecorator {
	return Inject(getNodeToken(path));
}

// ---------------------------------------------------------------------------
// Event & schedule method decorators (TC39 Stage 3 decorator API)
// ---------------------------------------------------------------------------

/**
 * Subscribe a method to a graph node's DATA emissions — replaces `@OnEvent()`.
 *
 * The method is called with the value payload on each `DATA` message from the
 * named node. Routes through `graph.observe()` so actor guards are respected.
 * Subscription is created on module init and disposed on destroy.
 *
 * For full protocol access (DIRTY, COMPLETE, ERROR, custom types), use
 * `graph.observe()` directly instead of this decorator.
 *
 * @param nodeName - Qualified node path (e.g. `"orders::placed"`).
 *
 * @example
 * ```ts
 * @Injectable()
 * export class OrderService {
 *   @OnGraphEvent("orders::placed")
 *   handleOrder(value: Order) { ... }
 * }
 * ```
 */
export function OnGraphEvent(
	nodeName: string,
): (value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => void {
	return (_value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: DecoratorHostConstructor }).constructor;
			const existing = EVENT_HANDLERS.get(ctor) ?? [];
			existing.push({ nodeName, methodKey });
			EVENT_HANDLERS.set(ctor, existing);
		});
	};
}

/**
 * Run a method on a fixed interval — replaces `@Interval()` from `@nestjs/schedule`.
 *
 * Backed by a `fromTimer` node added to the root graph as `__schedule__.<className>.<methodName>`.
 * Visible in `graph.describe()`, pausable via `graph.signal(name, [[PAUSE, lockId]])`.
 *
 * @param ms - Interval in milliseconds.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class CleanupService {
 *   @GraphInterval(5000)
 *   pruneStale() { ... }
 * }
 * ```
 */
export function GraphInterval(
	ms: number,
): (value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => void {
	return (_value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: DecoratorHostConstructor }).constructor;
			const existing = INTERVAL_HANDLERS.get(ctor) ?? [];
			existing.push({ ms, methodKey });
			INTERVAL_HANDLERS.set(ctor, existing);
		});
	};
}

/**
 * Run a method on a cron schedule — replaces `@Cron()` from `@nestjs/schedule`.
 *
 * Backed by a `fromCron` node added to the root graph as `__schedule__.<className>.<methodName>`.
 * Visible in `graph.describe()`, pausable via PAUSE/RESUME signals.
 *
 * @param expr - 5-field cron expression (`min hour dom month dow`).
 *
 * @example
 * ```ts
 * @Injectable()
 * export class ReportService {
 *   @GraphCron("0 9 * * 1")
 *   weeklyReport() { ... }
 * }
 * ```
 */
export function GraphCron(
	expr: string,
): (value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => void {
	return (_value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: DecoratorHostConstructor }).constructor;
			const existing = CRON_HANDLERS.get(ctor) ?? [];
			existing.push({ expr, methodKey });
			CRON_HANDLERS.set(ctor, existing);
		});
	};
}

// ---------------------------------------------------------------------------
// CQRS method decorators (Phase 5.5 — CQRS replacement)
// ---------------------------------------------------------------------------

/**
 * Register a method as a CQRS command handler — replaces `@CommandHandler()` from `@nestjs/cqrs`.
 *
 * The method receives `(payload, { emit })` — same signature as `CqrsGraph.command()` handlers.
 * Wired reactively via the explorer on module init.
 *
 * @param cqrsName - Name of the CQRS graph (from `forCqrs({ name })`).
 * @param commandName - Command to handle.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class OrderService {
 *   @CommandHandler("orders", "placeOrder")
 *   handlePlace(payload: PlaceOrderDto, { emit }: CommandActions) {
 *     emit("orderPlaced", { orderId: payload.id, amount: payload.amount });
 *   }
 * }
 * ```
 */
export function CommandHandler(
	cqrsName: string,
	commandName: string,
): (value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => void {
	return (_value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: DecoratorHostConstructor }).constructor;
			const existing = COMMAND_HANDLERS.get(ctor) ?? [];
			existing.push({ cqrsName, commandName, methodKey });
			COMMAND_HANDLERS.set(ctor, existing);
		});
	};
}

/**
 * Subscribe a method to CQRS event stream DATA — replaces `@EventsHandler()` from `@nestjs/cqrs`.
 *
 * The method receives each `CqrsEvent` envelope as events arrive. Subscription is reactive
 * via `graph.observe()` — actor guards are respected.
 *
 * @param cqrsName - Name of the CQRS graph.
 * @param eventName - Event stream to subscribe to.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class NotificationService {
 *   @EventHandler("orders", "orderPlaced")
 *   onOrderPlaced(event: CqrsEvent<{ orderId: string }>) {
 *     console.log("Order placed:", event.payload.orderId);
 *   }
 * }
 * ```
 */
export function EventHandler(
	cqrsName: string,
	eventName: string,
): (value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => void {
	return (_value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: DecoratorHostConstructor }).constructor;
			const existing = CQRS_EVENT_HANDLERS.get(ctor) ?? [];
			existing.push({ cqrsName, eventName, methodKey });
			CQRS_EVENT_HANDLERS.set(ctor, existing);
		});
	};
}

/**
 * Subscribe a method to CQRS projection changes — replaces `@QueryHandler()` from `@nestjs/cqrs`.
 *
 * The method is called reactively whenever the projection's value changes (DATA emission).
 * This is push-based, not request-response — the projection recomputes on upstream events.
 *
 * @param cqrsName - Name of the CQRS graph.
 * @param projectionName - Projection to observe.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class DashboardService {
 *   @QueryHandler("orders", "orderCount")
 *   onCountChanged(count: number) {
 *     this.broadcast({ type: "orderCount", value: count });
 *   }
 * }
 * ```
 */
export function QueryHandler(
	cqrsName: string,
	projectionName: string,
): (value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => void {
	return (_value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: DecoratorHostConstructor }).constructor;
			const existing = QUERY_HANDLERS.get(ctor) ?? [];
			existing.push({ cqrsName, projectionName, methodKey });
			QUERY_HANDLERS.set(ctor, existing);
		});
	};
}

/**
 * Register a method as a CQRS saga — replaces RxJS saga streams from `@nestjs/cqrs`.
 *
 * The method receives each new `CqrsEvent` from the specified event streams. Backed by
 * `CqrsGraph.saga()` — tracks last-processed entry, only delivers new events.
 *
 * @param cqrsName - Name of the CQRS graph.
 * @param sagaName - Name for this saga node in the graph.
 * @param eventNames - Event streams to react to.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class FulfillmentService {
 *   @SagaHandler("orders", "fulfillment", ["orderPlaced", "paymentConfirmed"])
 *   onOrderFlow(event: CqrsEvent) {
 *     if (event.type === "paymentConfirmed") this.shipOrder(event.payload);
 *   }
 * }
 * ```
 */
export function SagaHandler(
	cqrsName: string,
	sagaName: string,
	eventNames: readonly string[],
): (value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => void {
	return (_value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: DecoratorHostConstructor }).constructor;
			const existing = SAGA_HANDLERS.get(ctor) ?? [];
			existing.push({ cqrsName, eventNames, sagaName, methodKey });
			SAGA_HANDLERS.set(ctor, existing);
		});
	};
}
