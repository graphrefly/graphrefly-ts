// ---------------------------------------------------------------------------
// NestJS decorators for GraphReFly DI, events, and scheduling.
// ---------------------------------------------------------------------------
// NOTE: esbuild (used by vitest/vite) uses TC39 Stage 3 decorators, not
// legacy TypeScript experimental decorators. Method decorators receive
// (value: Function, context: ClassMethodDecoratorContext). We use
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
export const EVENT_HANDLERS = new Map<Function, OnGraphEventMeta[]>();
/** Registry: constructor → interval metadata. */
export const INTERVAL_HANDLERS = new Map<Function, GraphIntervalMeta[]>();
/** Registry: constructor → cron metadata. */
export const CRON_HANDLERS = new Map<Function, GraphCronMeta[]>();

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
): (value: Function, context: ClassMethodDecoratorContext) => void {
	return (_value: Function, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: Function }).constructor;
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
 * Visible in `graph.describe()`, pausable via `graph.signal(name, [[PAUSE]])`.
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
): (value: Function, context: ClassMethodDecoratorContext) => void {
	return (_value: Function, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: Function }).constructor;
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
): (value: Function, context: ClassMethodDecoratorContext) => void {
	return (_value: Function, context: ClassMethodDecoratorContext) => {
		const methodKey = context.name;
		context.addInitializer(function (this: unknown) {
			const ctor = (this as { constructor: Function }).constructor;
			const existing = CRON_HANDLERS.get(ctor) ?? [];
			existing.push({ expr, methodKey });
			CRON_HANDLERS.set(ctor, existing);
		});
	};
}
