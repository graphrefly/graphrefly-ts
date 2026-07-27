import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";

export interface LocalFixedWindowRateLimitOptions {
	readonly max: number;
	readonly windowMs: number;
	readonly now?: () => number;
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

/**
 * Creates a graph-local in-memory fixed-window rate limit bundle.
 *
 * This helper is a local stream-shaping state machine. It is not keyed, durable, atomic across
 * processes, or an application security/enforcement authority. Use the D648 keyed external
 * authority surface when a protected operation depends on durable rate-limit admission.
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
	const now = opts.now ?? Date.now;
	const name = opts.name ?? "localFixedWindowRateLimit";
	const events = graph.node<LocalFixedWindowRateLimitEvent<T>>(
		[source],
		(ctx) => {
			type State = { count: number; resetAtMs: number; allowed: number; dropped: number };
			const current = now();
			let state =
				ctx.state.get<State>() ??
				({ count: 0, resetAtMs: current + opts.windowMs, allowed: 0, dropped: 0 } satisfies State);
			if (current >= state.resetAtMs) {
				state = { ...state, count: 0, resetAtMs: current + opts.windowMs };
			}
			for (const value of depBatch(ctx, 0) ?? []) {
				const allowed = state.count < opts.max;
				state = allowed
					? { ...state, count: state.count + 1, allowed: state.allowed + 1 }
					: { ...state, dropped: state.dropped + 1 };
				const status = {
					allowed: state.allowed,
					dropped: state.dropped,
					remaining: Math.max(0, opts.max - state.count),
					resetAtMs: state.resetAtMs,
				} satisfies LocalFixedWindowRateLimitStatus;
				ctx.down([
					[
						"DATA",
						allowed
							? ({
									kind: "allowed",
									value: value as T,
									status,
								} satisfies LocalFixedWindowRateLimitEvent<T>)
							: ({
									kind: "dropped",
									value: value as T,
									status,
								} satisfies LocalFixedWindowRateLimitEvent<T>),
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/events`, factory: "localFixedWindowRateLimitEvents" },
	);
	const allowed = graph.node<T>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as LocalFixedWindowRateLimitEvent<T>;
				if (typed.kind === "allowed") ctx.down([["DATA", typed.value]]);
			}
		},
		{ name: `${name}/allowed`, factory: "localFixedWindowRateLimitAllowed" },
	);
	const dropped = graph.node<T>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as LocalFixedWindowRateLimitEvent<T>;
				if (typed.kind === "dropped") ctx.down([["DATA", typed.value]]);
			}
		},
		{ name: `${name}/dropped`, factory: "localFixedWindowRateLimitDropped" },
	);
	const status = graph.node<LocalFixedWindowRateLimitStatus>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", (event as LocalFixedWindowRateLimitEvent<T>).status]]);
			}
		},
		{ name: `${name}/status`, factory: "localFixedWindowRateLimitStatus" },
	);
	return { allowed, dropped, status };
}
