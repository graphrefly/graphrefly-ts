import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import {
	type BackoffPolicy,
	nextRetryDelayMs,
	type RetryPolicy,
	type RetryStatus,
	retryPolicy,
	shouldRetry,
} from "../graph/resilience.js";
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

export interface RateLimitOptions {
	readonly max: number;
	readonly windowMs: number;
	readonly now?: () => number;
	readonly name?: string;
}

export interface RateLimitStatus {
	readonly allowed: number;
	readonly dropped: number;
	readonly remaining: number;
	readonly resetAtMs: number;
}

export interface RateLimitBundle<T> {
	readonly allowed: Node<T>;
	readonly dropped: Node<T>;
	readonly status: Node<RateLimitStatus>;
}

type RateLimitEvent<T> =
	| { readonly kind: "allowed"; readonly value: T; readonly status: RateLimitStatus }
	| { readonly kind: "dropped"; readonly value: T; readonly status: RateLimitStatus };

export interface TimeoutBundle<T> {
	readonly node: Node<T>;
	readonly status: Node<"running" | "completed" | "errored">;
	readonly errors: Node<unknown>;
}

export function retryStatusBundle(
	graph: Graph,
	events: Node<ResilienceEvent>,
	opts: { name?: string; policy?: RetryPolicy } = {},
): RetryStatusBundle {
	const policy = opts.policy ?? retryPolicy();
	const name = opts.name ?? "retry";
	const status = graph.node<RetryStatus>(
		[events],
		(ctx) => {
			let next =
				ctx.state.get<RetryStatus>() ??
				({ state: "idle", attempt: 0, maxAttempts: policy.maxAttempts } satisfies RetryStatus);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as ResilienceEvent;
				if (event.kind === "attempt") {
					next = { state: "running", attempt: event.attempt, maxAttempts: policy.maxAttempts };
				} else if (event.kind === "retry") {
					next = {
						state: "waiting",
						attempt: event.attempt,
						maxAttempts: policy.maxAttempts,
						delayMs: event.delayMs,
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
						delayMs: shouldRetry(policy, attempt)
							? nextRetryDelayMs(policy, attempt + 1)
							: undefined,
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
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as ResilienceEvent;
				if ("error" in event) ctx.down([["DATA", event.error]]);
			}
		},
		{ name: `${name}/errors`, factory: "retryErrors" },
	);
	return { status, errors };
}

export function breakerBundle(
	graph: Graph,
	events: Node<ResilienceEvent>,
	opts: BreakerOptions,
): BreakerBundle {
	if (!Number.isInteger(opts.failureThreshold) || opts.failureThreshold <= 0) {
		throw new RangeError("breakerBundle: failureThreshold must be a positive integer");
	}
	const name = opts.name ?? "breaker";
	const now = opts.now ?? Date.now;
	const status = graph.node<BreakerStatus>(
		[events],
		(ctx) => {
			let next =
				ctx.state.get<BreakerStatus>() ??
				({ state: "closed", failures: 0 } satisfies BreakerStatus);
			if (
				next.state === "open" &&
				opts.resetAfterMs !== undefined &&
				next.openedAtMs !== undefined &&
				now() - next.openedAtMs >= opts.resetAfterMs
			) {
				next = { ...next, state: "half-open" };
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as ResilienceEvent;
				if (event.kind === "success") {
					next = { state: "closed", failures: 0 };
				} else if (event.kind === "failure" || event.kind === "exhausted") {
					const failures = next.failures + 1;
					next =
						failures >= opts.failureThreshold
							? { state: "open", failures, openedAtMs: now() }
							: { ...next, failures };
				}
			}
			ctx.state.set(next);
			ctx.down([["DATA", next]]);
		},
		{ name: `${name}/status`, factory: "breakerStatus" },
	);
	const allowed = graph.node<boolean>(
		[status],
		(ctx) => {
			const statusBatch = depBatch(ctx, 0) ?? [];
			for (const value of statusBatch) {
				ctx.down([["DATA", (value as BreakerStatus).state !== "open"]]);
			}
		},
		{ name: `${name}/allowed`, factory: "breakerAllowed" },
	);
	return { status, allowed };
}

export function rateLimitBundle<T>(
	graph: Graph,
	source: Node<T>,
	opts: RateLimitOptions,
): RateLimitBundle<T> {
	if (!Number.isInteger(opts.max) || opts.max <= 0) {
		throw new RangeError("rateLimitBundle: max must be a positive integer");
	}
	if (!Number.isFinite(opts.windowMs) || opts.windowMs <= 0) {
		throw new RangeError("rateLimitBundle: windowMs must be positive");
	}
	const now = opts.now ?? Date.now;
	const name = opts.name ?? "rateLimit";
	const events = graph.node<RateLimitEvent<T>>(
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
				} satisfies RateLimitStatus;
				ctx.down([
					[
						"DATA",
						allowed
							? ({ kind: "allowed", value: value as T, status } satisfies RateLimitEvent<T>)
							: ({ kind: "dropped", value: value as T, status } satisfies RateLimitEvent<T>),
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/events`, factory: "rateLimitEvents" },
	);
	const allowed = graph.node<T>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as RateLimitEvent<T>;
				if (typed.kind === "allowed") ctx.down([["DATA", typed.value]]);
			}
		},
		{ name: `${name}/allowed`, factory: "rateLimitAllowed" },
	);
	const dropped = graph.node<T>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as RateLimitEvent<T>;
				if (typed.kind === "dropped") ctx.down([["DATA", typed.value]]);
			}
		},
		{ name: `${name}/dropped`, factory: "rateLimitDropped" },
	);
	const status = graph.node<RateLimitStatus>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", (event as RateLimitEvent<T>).status]]);
			}
		},
		{ name: `${name}/status`, factory: "rateLimitStatus" },
	);
	return { allowed, dropped, status };
}

export function timeoutBundle<T>(
	graph: Graph,
	source: Node<T>,
	ms: number,
	opts: { name?: string } = {},
): TimeoutBundle<T> {
	const name = opts.name ?? "timeout";
	const node = timeoutOperator(source, ms);
	const status = graph.node<"running" | "completed" | "errored">(
		[node],
		(ctx) => {
			const terminal = ctx.terminal[0];
			if (terminal === true) ctx.down([["DATA", "completed"]]);
			else if (terminal !== false && terminal !== undefined) ctx.down([["DATA", "errored"]]);
			else if ((depBatch(ctx, 0) ?? []).length > 0) ctx.down([["DATA", "running"]]);
		},
		{ name: `${name}/status`, factory: "timeoutStatus" },
	);
	const errors = graph.node<unknown>(
		[node],
		(ctx) => {
			const terminal = ctx.terminal[0];
			if (terminal !== true && terminal !== false && terminal !== undefined) {
				ctx.down([["DATA", terminal]]);
			}
		},
		{ name: `${name}/errors`, factory: "timeoutErrors" },
	);
	return { node, status, errors };
}

export function constantBackoff(delayMs: number): BackoffPolicy {
	return { kind: "constant", delayMs };
}
