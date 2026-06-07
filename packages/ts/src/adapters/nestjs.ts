/**
 * Dependency-free NestJS adapter tokens and method metadata.
 *
 * The old compat layer imported `@nestjs/common` for DI decorators. Clean-slate keeps the
 * retainable token/metadata vocabulary here and leaves actual `Inject(...)` composition to
 * user-land NestJS code, so @graphrefly/ts keeps zero framework dependencies (D125/B61).
 */

/** Injection token for a root graph singleton. */
export const GRAPHREFLY_ROOT_GRAPH = Symbol.for("graphrefly:root-graph");

/** Injection token for adapter module options. */
export const GRAPHREFLY_MODULE_OPTIONS = Symbol.for("graphrefly:module-options");

/** Injection token for a request-scoped graph. */
export const GRAPHREFLY_REQUEST_GRAPH = Symbol.for("graphrefly:request-graph");

export type DecoratorHostConstructor = abstract new (...args: unknown[]) => unknown;
export type DecoratorBoundMethod = (...args: unknown[]) => unknown;

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

export const EVENT_HANDLERS = new Map<DecoratorHostConstructor, OnGraphEventMeta[]>();
export const INTERVAL_HANDLERS = new Map<DecoratorHostConstructor, GraphIntervalMeta[]>();
export const CRON_HANDLERS = new Map<DecoratorHostConstructor, GraphCronMeta[]>();

export type GraphMethodDecorator = MethodDecorator &
	((value: DecoratorBoundMethod, context: ClassMethodDecoratorContext) => void);

/** Get the injection token for a named feature graph. */
export function getGraphToken(name: string): symbol {
	return Symbol.for(`graphrefly:graph:${name}`);
}

/** Get the injection token for a node at a qualified path. */
export function getNodeToken(path: string): symbol {
	return Symbol.for(`graphrefly:node:${path}`);
}

function sameMeta<T>(a: T, b: T): boolean {
	const left = a as Record<string | symbol, unknown>;
	const right = b as Record<string | symbol, unknown>;
	const keys = Reflect.ownKeys(left);
	if (keys.length !== Reflect.ownKeys(right).length) return false;
	for (const key of keys) {
		if (!Object.is(left[key], right[key])) return false;
	}
	return true;
}

function pushUniqueMeta<T>(
	registry: Map<DecoratorHostConstructor, T[]>,
	ctor: DecoratorHostConstructor,
	item: T,
): void {
	const existing = registry.get(ctor) ?? [];
	if (existing.some((current) => sameMeta(current, item))) return;
	registry.set(ctor, [...existing, item]);
}

function registerMeta<T>(
	registry: Map<DecoratorHostConstructor, T[]>,
	meta: (methodKey: string | symbol) => T,
): GraphMethodDecorator {
	return ((targetOrValue: object, contextOrKey: ClassMethodDecoratorContext | string | symbol) => {
		if (typeof contextOrKey === "object" && contextOrKey !== null) {
			const methodKey = contextOrKey.name;
			contextOrKey.addInitializer(function (this: unknown) {
				const ctor = (this as { constructor: DecoratorHostConstructor }).constructor;
				pushUniqueMeta(registry, ctor, meta(methodKey));
			});
			return;
		}

		const ctor = (targetOrValue as { constructor: DecoratorHostConstructor }).constructor;
		pushUniqueMeta(registry, ctor, meta(contextOrKey));
	}) as GraphMethodDecorator;
}

/** Register a method as a DATA-event handler for a graph observe path. */
export function OnGraphEvent(nodeName: string): GraphMethodDecorator {
	return registerMeta(EVENT_HANDLERS, (methodKey) => ({ nodeName, methodKey }));
}

/** Register fixed-interval metadata for a user-land NestJS scheduler bridge. */
export function GraphInterval(ms: number): GraphMethodDecorator {
	return registerMeta(INTERVAL_HANDLERS, (methodKey) => ({ ms, methodKey }));
}

/** Register cron metadata for a user-land NestJS scheduler bridge. */
export function GraphCron(expr: string): GraphMethodDecorator {
	return registerMeta(CRON_HANDLERS, (methodKey) => ({ expr, methodKey }));
}
