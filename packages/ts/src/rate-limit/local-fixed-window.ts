import type { NodeFn } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { GraphRecipeContext, GraphRecipeFactory } from "../graph/restore.js";
import type { Node } from "../node/node.js";

export interface LocalFixedWindowRateLimitOptions {
	readonly max: number;
	readonly windowMs: number;
	readonly now?: () => number;
	/**
	 * R-checkpoint@1: the ref under which the restoring caller registers `now` as a definition
	 * (`{ kind: "definition", ref, fn }`). A custom `now` without it leaves the window local-only;
	 * the default clock (`Date.now`) needs none.
	 */
	readonly nowRef?: string;
	readonly name?: string;
}

export interface LocalFixedWindowRateLimitStatus {
	readonly allowed: number;
	readonly dropped: number;
	readonly remaining: number;
	readonly resetAtMs: number;
}

export interface LocalFixedWindowRateLimitBundle<T> {
	readonly allowed: Node<T>;
	readonly dropped: Node<T>;
	readonly status: Node<LocalFixedWindowRateLimitStatus>;
}

type LocalFixedWindowRateLimitEvent<T> =
	| {
			readonly kind: "allowed";
			readonly value: T;
			readonly status: LocalFixedWindowRateLimitStatus;
	  }
	| {
			readonly kind: "dropped";
			readonly value: T;
			readonly status: LocalFixedWindowRateLimitStatus;
	  };

type ProjectionKind = "allowed" | "dropped" | "status";

/** The events node's recipe config: everything its function is built from. */
interface EventsConfig {
	readonly max: number;
	readonly windowMs: number;
	readonly nowRef?: string;
}

const EVENTS_REF = "localFixedWindowRateLimit.events";
const PROJECTION_REF = "localFixedWindowRateLimit.projection";

/**
 * Creates a graph-local in-memory fixed-window rate limit bundle.
 *
 * This helper is a local stream-shaping state machine. It is not keyed, durable, atomic across
 * processes, or an application security/enforcement authority. Use the D648 keyed external
 * authority surface when a protected operation depends on host-owned durable quota authority and
 * receipts; governed protected effects must not use this helper's `allowed` projection as an
 * authority-adapter bypass.
 *
 * Its nodes carry recipes (R-checkpoint@1) when its clock is the default or is named by
 * `nowRef`; restore them with {@link localFixedWindowRateLimitRestoreRegistry}.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param source - Source node that provides graph-visible input.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category rate-limit
 * @example
 * ```ts
 * import { localFixedWindowRateLimitBundle } from "@graphrefly/ts/rate-limit";
 * ```
 */
export function localFixedWindowRateLimitBundle<T>(
	graph: Graph,
	source: Node<T>,
	opts: LocalFixedWindowRateLimitOptions,
): LocalFixedWindowRateLimitBundle<T> {
	if (!Number.isInteger(opts.max) || opts.max <= 0) {
		throw new RangeError("localFixedWindowRateLimitBundle: max must be a positive integer");
	}
	if (!Number.isFinite(opts.windowMs) || opts.windowMs <= 0) {
		throw new RangeError("localFixedWindowRateLimitBundle: windowMs must be positive");
	}
	if (opts.nowRef !== undefined && opts.now === undefined) {
		throw new TypeError("localFixedWindowRateLimitBundle: nowRef names the clock given as now");
	}
	const name = opts.name ?? "localFixedWindowRateLimit";
	const config: EventsConfig = {
		max: opts.max,
		windowMs: opts.windowMs,
		...(opts.nowRef === undefined ? {} : { nowRef: opts.nowRef }),
	};
	// R-checkpoint@1: a custom clock with no ref cannot be named in a recipe: local-only.
	const restorable = opts.now === undefined || opts.nowRef !== undefined;
	const events = graph.node<LocalFixedWindowRateLimitEvent<T>>(
		[source],
		eventsFn(config, opts.now ?? Date.now),
		{
			name: `${name}/events`,
			factory: "localFixedWindowRateLimitEvents",
			...(restorable ? { recipe: { ref: EVENTS_REF, config } } : {}),
		},
	);
	const project = <TOut>(kind: ProjectionKind, factory: string): Node<TOut> =>
		graph.node<TOut>([events], projectionFn(kind), {
			name: `${name}/${kind}`,
			factory,
			recipe: { ref: PROJECTION_REF, config: { kind } },
		});
	return {
		allowed: project<T>("allowed", "localFixedWindowRateLimitAllowed"),
		dropped: project<T>("dropped", "localFixedWindowRateLimitDropped"),
		status: project<LocalFixedWindowRateLimitStatus>("status", "localFixedWindowRateLimitStatus"),
	};
}

function eventsFn(config: EventsConfig, now: () => number): NodeFn {
	const { max, windowMs } = config;
	return (ctx) => {
		type State = { count: number; resetAtMs: number; allowed: number; dropped: number };
		const events: LocalFixedWindowRateLimitEvent<unknown>[] = [];
		const current = now();
		let state =
			ctx.state.get<State>() ??
			({ count: 0, resetAtMs: current + windowMs, allowed: 0, dropped: 0 } satisfies State);
		if (current >= state.resetAtMs) {
			state = { ...state, count: 0, resetAtMs: current + windowMs };
		}
		for (const value of ctx.deps[0].waves.flat()) {
			const allowed = state.count < max;
			state = allowed
				? { ...state, count: state.count + 1, allowed: state.allowed + 1 }
				: { ...state, dropped: state.dropped + 1 };
			const status = {
				allowed: state.allowed,
				dropped: state.dropped,
				remaining: Math.max(0, max - state.count),
				resetAtMs: state.resetAtMs,
			} satisfies LocalFixedWindowRateLimitStatus;
			events.push({ kind: allowed ? "allowed" : "dropped", value, status });
		}
		ctx.state.set(state);
		ctx.emit(...events);
	};
}

function projectionFn(kind: ProjectionKind): NodeFn {
	return (ctx) => {
		const values: unknown[] = [];
		for (const event of ctx.deps[0].waves.flat()) {
			const typed = event as LocalFixedWindowRateLimitEvent<unknown>;
			if (kind === "status") values.push(typed.status);
			else if (typed.kind === kind) values.push(typed.value);
		}
		ctx.emit(...values);
	};
}

function restoredClock(nowRef: string | undefined, ctx: GraphRecipeContext): () => number {
	if (nowRef === undefined) return Date.now;
	const definition = ctx.definition<undefined, number>(nowRef);
	return () => definition.fn(undefined);
}

function configObject(config: unknown, ref: string): Record<string, unknown> {
	if (typeof config !== "object" || config === null || Array.isArray(config))
		throw new Error(`restoreGraph: '${ref}' recipe requires an object config`);
	return config as Record<string, unknown>;
}

/**
 * Restore entries for the local fixed-window rate limit's nodes (R-checkpoint@1): add them to
 * the registry given to restoreGraph, with the clock's definition when the bundle named one by
 * `nowRef`.
 * @category rate-limit
 * @example
 * ```ts
 * import { defaultRestoreRegistry, restoreGraph } from "@graphrefly/ts/graph";
 * import { localFixedWindowRateLimitRestoreRegistry } from "@graphrefly/ts/rate-limit";
 *
 * const g = restoreGraph(checkpoint, {
 *   registry: { ...defaultRestoreRegistry, ...localFixedWindowRateLimitRestoreRegistry },
 * });
 * ```
 */
export const localFixedWindowRateLimitRestoreRegistry: Readonly<
	Record<string, GraphRecipeFactory<any>>
> = {
	[EVENTS_REF]: {
		ref: EVENTS_REF,
		validateConfig(config): EventsConfig {
			const c = configObject(config, EVENTS_REF);
			if (!Number.isSafeInteger(c.max) || (c.max as number) <= 0)
				throw new Error(`restoreGraph: '${EVENTS_REF}' config.max must be a positive integer`);
			if (typeof c.windowMs !== "number" || !Number.isFinite(c.windowMs) || c.windowMs <= 0)
				throw new Error(`restoreGraph: '${EVENTS_REF}' config.windowMs must be positive`);
			if (c.nowRef !== undefined && typeof c.nowRef !== "string")
				throw new Error(`restoreGraph: '${EVENTS_REF}' config.nowRef must be a string`);
			return {
				max: c.max as number,
				windowMs: c.windowMs,
				...(c.nowRef === undefined ? {} : { nowRef: c.nowRef as string }),
			};
		},
		build(config: EventsConfig, ctx) {
			return { fn: eventsFn(config, restoredClock(config.nowRef, ctx)) };
		},
	} satisfies GraphRecipeFactory<EventsConfig>,
	[PROJECTION_REF]: {
		ref: PROJECTION_REF,
		validateConfig(config): { readonly kind: ProjectionKind } {
			const kind = configObject(config, PROJECTION_REF).kind;
			if (kind !== "allowed" && kind !== "dropped" && kind !== "status")
				throw new Error(
					`restoreGraph: '${PROJECTION_REF}' config.kind must be allowed, dropped or status`,
				);
			return { kind };
		},
		build(config: { readonly kind: ProjectionKind }) {
			return { fn: projectionFn(config.kind) };
		},
	} satisfies GraphRecipeFactory<{ readonly kind: ProjectionKind }>,
};
