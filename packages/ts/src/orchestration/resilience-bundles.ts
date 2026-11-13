import type { NodeFn } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import { moduleName } from "../graph/module-naming.js";
import {
	type BackoffPolicy,
	nextRetryDelayMs,
	type RetryPolicy,
	type RetryStatus,
	retryPolicy,
	shouldRetry,
} from "../graph/resilience.js";
import type { GraphRecipeFactory } from "../graph/restore.js";
import { timeout as timeoutOperator } from "../graph/time.js";
import type { Node } from "../node/node.js";

export type ResilienceEvent =
	| { readonly kind: "attempt"; readonly attempt: number }
	| {
			readonly kind: "retry";
			readonly attempt: number;
			readonly delayMs: number;
			readonly error: unknown;
	  }
	| { readonly kind: "success"; readonly attempt?: number }
	| { readonly kind: "failure"; readonly attempt?: number; readonly error: unknown }
	| { readonly kind: "exhausted"; readonly attempt: number; readonly error: unknown };

export interface RetryStatusBundle {
	readonly status: Node<RetryStatus>;
	readonly errors: Node<unknown>;
}

export interface BreakerOptions {
	readonly failureThreshold: number;
	readonly resetAfterMs?: number;
	readonly now?: () => number;
	/**
	 * R-checkpoint@1: the ref under which the restoring caller registers `now` as a definition
	 * (`{ kind: "definition", ref, fn }`). A custom `now` without it leaves the breaker local-only;
	 * the default clock (`Date.now`) needs none.
	 */
	readonly nowRef?: string;
	readonly name?: string;
}

export interface BreakerStatus {
	readonly state: "closed" | "open" | "half-open";
	readonly failures: number;
	readonly openedAtMs?: number;
}

export interface BreakerBundle {
	readonly status: Node<BreakerStatus>;
	readonly allowed: Node<boolean>;
}

export interface TimeoutBundle<T> {
	readonly node: Node<T>;
	readonly status: Node<"running" | "completed" | "errored">;
	readonly errors: Node<unknown>;
}

/**
 * Creates a retry status bundle.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param events - Event node or event collection to consume.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category orchestration
 * @example
 * ```ts
 * import { retryStatusBundle } from "@graphrefly/ts/orchestration";
 * ```
 */
export function retryStatusBundle(
	graph: Graph,
	events: Node<ResilienceEvent>,
	opts: { name?: string; policy?: RetryPolicy } = {},
): RetryStatusBundle {
	const policy = opts.policy ?? retryPolicy();
	const name = moduleName(graph, opts.name, "retry");
	const status = graph.node<RetryStatus>(
		[events],
		(ctx) => {
			let next =
				ctx.state.get<RetryStatus>() ??
				({ state: "idle", attempt: 0, maxAttempts: policy.maxAttempts } satisfies RetryStatus);
			for (const raw of ctx.deps[0].waves.flat()) {
				const event = raw as ResilienceEvent;
				if (event.kind === "attempt") {
					next = { state: "running", attempt: event.attempt, maxAttempts: policy.maxAttempts };
				} else if (event.kind === "retry") {
					next = {
						state: "waiting",
						attempt: event.attempt,
						maxAttempts: policy.maxAttempts,
						...(event.delayMs === undefined ? {} : { delayMs: event.delayMs }),
					};
				} else if (event.kind === "success") {
					next = {
						state: "succeeded",
						attempt: event.attempt ?? next.attempt,
						maxAttempts: policy.maxAttempts,
					};
				} else if (event.kind === "failure") {
					const attempt = event.attempt ?? next.attempt;
					next = {
						state: shouldRetry(policy, attempt) ? "failed" : "exhausted",
						attempt,
						maxAttempts: policy.maxAttempts,
						// An absent delay is omitted, so the status stays strict JSON (R-checkpoint@1).
						...(shouldRetry(policy, attempt)
							? { delayMs: nextRetryDelayMs(policy, attempt + 1) }
							: {}),
					};
				} else {
					next = {
						state: "exhausted",
						attempt: event.attempt,
						maxAttempts: policy.maxAttempts,
					};
				}
			}
			ctx.state.set(next);
			ctx.down([["DATA", next]]);
		},
		{ name: `${name}/status`, factory: "retryStatus" },
	);
	const errors = graph.node<unknown>(
		[events],
		(ctx) => {
			const values: unknown[] = [];
			for (const raw of ctx.deps[0].waves.flat()) {
				const event = raw as ResilienceEvent;
				if ("error" in event) values.push(event.error);
			}
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		{ name: `${name}/errors`, factory: "retryErrors" },
	);
	return { status, errors };
}

/**
 * Creates a breaker bundle.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param events - Event node or event collection to consume.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category orchestration
 * @example
 * ```ts
 * import { breakerBundle } from "@graphrefly/ts/orchestration";
 * ```
 */
export function breakerBundle(
	graph: Graph,
	events: Node<ResilienceEvent>,
	opts: BreakerOptions,
): BreakerBundle {
	if (!Number.isInteger(opts.failureThreshold) || opts.failureThreshold <= 0) {
		throw new RangeError("breakerBundle: failureThreshold must be a positive integer");
	}
	if (opts.nowRef !== undefined && opts.now === undefined) {
		throw new TypeError("breakerBundle: nowRef names the clock given as now");
	}
	const name = moduleName(graph, opts.name, "breaker");
	const config: BreakerStatusConfig = {
		failureThreshold: opts.failureThreshold,
		...(opts.resetAfterMs === undefined ? {} : { resetAfterMs: opts.resetAfterMs }),
		...(opts.nowRef === undefined ? {} : { nowRef: opts.nowRef }),
	};
	// R-checkpoint@1: a custom clock with no ref cannot be named in a recipe: local-only.
	const restorable = opts.now === undefined || opts.nowRef !== undefined;
	const status = graph.node<BreakerStatus>(
		[events],
		breakerStatusFn(config, opts.now ?? Date.now),
		{
			name: `${name}/status`,
			factory: "breakerStatus",
			...(restorable ? { recipe: { ref: BREAKER_STATUS_REF, config } } : {}),
		},
	);
	const allowed = graph.node<boolean>([status], breakerAllowedFn(), {
		name: `${name}/allowed`,
		factory: "breakerAllowed",
		recipe: { ref: BREAKER_ALLOWED_REF },
	});
	return { status, allowed };
}

const BREAKER_STATUS_REF = "breaker.status";
const BREAKER_ALLOWED_REF = "breaker.allowed";

/** The breaker status node's recipe config: everything its function is built from. */
interface BreakerStatusConfig {
	readonly failureThreshold: number;
	readonly resetAfterMs?: number;
	readonly nowRef?: string;
}

function breakerStatusFn(config: BreakerStatusConfig, now: () => number): NodeFn {
	const { failureThreshold, resetAfterMs } = config;
	return (ctx) => {
		let next =
			ctx.state.get<BreakerStatus>() ?? ({ state: "closed", failures: 0 } satisfies BreakerStatus);
		if (
			next.state === "open" &&
			resetAfterMs !== undefined &&
			next.openedAtMs !== undefined &&
			now() - next.openedAtMs >= resetAfterMs
		) {
			next = { ...next, state: "half-open" };
		}
		for (const raw of ctx.deps[0].waves.flat()) {
			const event = raw as ResilienceEvent;
			if (event.kind === "success") {
				next = { state: "closed", failures: 0 };
			} else if (event.kind === "failure" || event.kind === "exhausted") {
				const failures = next.failures + 1;
				next =
					failures >= failureThreshold
						? { state: "open", failures, openedAtMs: now() }
						: { ...next, failures };
			}
		}
		ctx.state.set(next);
		ctx.down([["DATA", next]]);
	};
}

function breakerAllowedFn(): NodeFn {
	return (ctx) => {
		const allowed: boolean[] = [];
		const statusBatch = ctx.deps[0].waves.flat();
		for (const value of statusBatch) {
			allowed.push((value as BreakerStatus).state !== "open");
		}
		ctx.down(allowed.map((v) => ["DATA", v] as const));
	};
}

function breakerConfigNumber(
	c: Record<string, unknown>,
	key: "failureThreshold" | "resetAfterMs",
): number {
	const value = c[key];
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		throw new Error(
			`restoreGraph: '${BREAKER_STATUS_REF}' config.${key} must be a non-negative number`,
		);
	return value;
}

/**
 * Restore entries for the breaker's nodes (R-checkpoint@1): add them to the registry given to
 * restoreGraph, with the clock's definition when the breaker named one by `nowRef`.
 * @category orchestration
 * @example
 * ```ts
 * import { defaultRestoreRegistry, restoreGraph } from "@graphrefly/ts/graph";
 * import { breakerRestoreRegistry } from "@graphrefly/ts/orchestration";
 *
 * const g = restoreGraph(checkpoint, {
 *   registry: { ...defaultRestoreRegistry, ...breakerRestoreRegistry },
 * });
 * ```
 */
export const breakerRestoreRegistry: Readonly<Record<string, GraphRecipeFactory<any>>> = {
	[BREAKER_STATUS_REF]: {
		ref: BREAKER_STATUS_REF,
		validateConfig(config): BreakerStatusConfig {
			if (typeof config !== "object" || config === null || Array.isArray(config))
				throw new Error(`restoreGraph: '${BREAKER_STATUS_REF}' recipe requires an object config`);
			const c = config as Record<string, unknown>;
			const failureThreshold = breakerConfigNumber(c, "failureThreshold");
			if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1)
				throw new Error(
					`restoreGraph: '${BREAKER_STATUS_REF}' config.failureThreshold must be a positive integer`,
				);
			if (c.nowRef !== undefined && typeof c.nowRef !== "string")
				throw new Error(`restoreGraph: '${BREAKER_STATUS_REF}' config.nowRef must be a string`);
			return {
				failureThreshold,
				...(c.resetAfterMs === undefined
					? {}
					: { resetAfterMs: breakerConfigNumber(c, "resetAfterMs") }),
				...(c.nowRef === undefined ? {} : { nowRef: c.nowRef as string }),
			};
		},
		build(config: BreakerStatusConfig, ctx) {
			const nowRef = config.nowRef;
			const definition =
				nowRef === undefined ? undefined : ctx.definition<undefined, number>(nowRef);
			const now = definition === undefined ? Date.now : () => definition.fn(undefined);
			return { fn: breakerStatusFn(config, now) };
		},
	} satisfies GraphRecipeFactory<BreakerStatusConfig>,
	[BREAKER_ALLOWED_REF]: {
		ref: BREAKER_ALLOWED_REF,
		validateConfig(config): undefined {
			if (config !== undefined)
				throw new Error(`restoreGraph: '${BREAKER_ALLOWED_REF}' takes no config`);
			return undefined;
		},
		build() {
			return { fn: breakerAllowedFn() };
		},
	} satisfies GraphRecipeFactory<undefined>,
};

/**
 * Creates a timeout bundle.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param source - Source node that provides graph-visible input.
 * @param ms - MS value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category orchestration
 * @example
 * ```ts
 * import { timeoutBundle } from "@graphrefly/ts/orchestration";
 * ```
 */
export function timeoutBundle<T>(
	graph: Graph,
	source: Node<T>,
	ms: number,
	opts: { name?: string } = {},
): TimeoutBundle<T> {
	const name = moduleName(graph, opts.name, "timeout");
	const node = timeoutOperator(source, ms);
	const status = graph.node<"running" | "completed" | "errored">(
		[node],
		(ctx) => {
			const terminal = ctx.deps[0].terminal;
			if (terminal?.kind === "complete") ctx.down([["DATA", "completed"]]);
			else if (terminal?.kind === "error") ctx.down([["DATA", "errored"]]);
			else if (ctx.deps[0].waves.flat().length > 0) ctx.down([["DATA", "running"]]);
		},
		{ name: `${name}/status`, factory: "timeoutStatus" },
	);
	const errors = graph.node<unknown>(
		[node],
		(ctx) => {
			const terminal = ctx.deps[0].terminal;
			if (terminal?.kind === "error") {
				ctx.down([["DATA", terminal.error]]);
			}
		},
		{ name: `${name}/errors`, factory: "timeoutErrors" },
	);
	return { node, status, errors };
}

/**
 * Creates a constant backoff.
 *
 * @param delayMs - delay MS value used by the helper.
 * @returns The constant backoff result.
 * @category orchestration
 * @example
 * ```ts
 * import { constantBackoff } from "@graphrefly/ts/orchestration";
 * ```
 */
export function constantBackoff(delayMs: number): BackoffPolicy {
	return { kind: "constant", delayMs };
}
