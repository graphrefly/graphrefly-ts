/**
 * Internal helpers shared by resilience sub-files.
 *
 * Not part of the public surface. The base-layer resilience operators
 * co-located here (`retry.ts`, `status.ts`, `timeout.ts`) import what they
 * need from this file directly; the utils-layer resilience primitives that
 * stayed in `utils/resilience/` (`breaker.ts`, `rate-limiter.ts`,
 * `fallback.ts`) import it top-down via `../../base/resilience/_internal.js`.
 *
 * `NodeOrValue<T>` is the only export re-surfaced publicly — there is no
 * `base/resilience/index.ts`; it ships through `utils/resilience/index.ts`
 * (and `utils/memory/index.ts`). Every resilience primitive that accepts
 * reactive options uses it as the option-arg shape.
 */

import type { Node, NodeOptions } from "@graphrefly/pure-ts/core";
import { DATA, type Message } from "@graphrefly/pure-ts/core";

export type ExtraOpts = Omit<NodeOptions, "describeKind">;

export function operatorOpts<T>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "derived", ...opts } as NodeOptions<T>;
}

export function clampNonNegative(value: number): number {
	return value < 0 ? 0 : value;
}

export function msgVal(m: Message): unknown {
	return m[1];
}

export function coerceDelayNs(raw: number): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) {
		throw new TypeError("backoff strategy must return a finite number");
	}
	return raw < 0 ? 0 : raw;
}

export function isNode(x: unknown): x is Node {
	return (
		x != null &&
		typeof x === "object" &&
		"cache" in x &&
		typeof (x as Node).subscribe === "function"
	);
}

/**
 * Either a literal value or a reactive Node carrying it. Mirrors
 * {@link FallbackInput}'s precedent for "options that may be reactive."
 *
 * Used by {@link timeout} / {@link retry} / {@link rateLimiter} /
 * {@link circuitBreaker} / {@link budgetGate} to accept reactive option
 * configurations (Tier 6.5 3.2, 2026-04-29). Each primitive subscribes
 * to the option Node via {@link resolveReactiveOption} and rebinds
 * internal state per its locked swap-semantic rule (see each primitive's
 * JSDoc for the rule).
 *
 * @category extra
 */
export type NodeOrValue<T> = T | Node<T>;

/**
 * Closure-mirror helper for `NodeOrValue<T>` options
 * (COMPOSITION-GUIDE §28). Returns:
 * - `current()` — read the latest value (cached at construction; updated
 *   on each Node DATA emission).
 * - `unsub()` — release the subscription. Static-form arg never
 *   subscribes; `unsub` is a no-op there.
 *
 * `onChange` fires on each DATA after the initial value (skips the
 * cache-seed read). Use to rebind primitive-internal state per the
 * primitive's locked swap-semantic rule.
 *
 * @internal
 */
export function resolveReactiveOption<T>(
	arg: NodeOrValue<T>,
	onChange?: (next: T) => void,
): { current: () => T; unsub: () => void } {
	if (!isNode(arg)) {
		return { current: () => arg, unsub: () => undefined };
	}
	const node = arg as Node<T>;
	let latest: T = node.cache as T;
	const unsub = node.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA) {
				latest = m[1] as T;
				if (onChange) onChange(latest);
			}
		}
	});
	return {
		current: () => latest,
		unsub,
	};
}

export function isThenable(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

export function isAsyncIterable(x: unknown): x is AsyncIterable<unknown> {
	return (
		x != null &&
		typeof x === "object" &&
		typeof (x as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
	);
}
