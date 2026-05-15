/**
 * Fallback — replace upstream ERROR with a static or computed source.
 *
 * Accepts scalar / `Node` / `PromiseLike` / `AsyncIterable` fallbacks; non-Node
 * inputs are routed through `fromAny` so the fallback participates in the
 * reactive protocol uniformly.
 */

import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	RESOLVED,
	TEARDOWN,
} from "@graphrefly/pure-ts/core/messages.js";
import { factoryTag } from "@graphrefly/pure-ts/core/meta.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { fromAny } from "../sources/index.js";
import { isAsyncIterable, isNode, isThenable, operatorOpts } from "./_internal.js";

/** Inputs accepted by {@link fallback}. */
export type FallbackInput<T> = T | Node<T> | PromiseLike<T> | AsyncIterable<T>;

/**
 * On upstream terminal `ERROR`, switch to a fallback source instead of propagating the error.
 *
 * Accepts any of:
 * - **scalar value** — emits `[[DATA, fb], [COMPLETE]]`
 * - **`Node<T>`** — subscribes and forwards all messages (push-on-subscribe delivers current cache)
 * - **`Promise<T>` / thenable** — resolves into a one-shot `DATA` then `COMPLETE` (via {@link fromAny})
 * - **`AsyncIterable<T>`** — streams each yielded value as `DATA`, then `COMPLETE` (via {@link fromAny})
 *
 * Non-`Node` inputs are routed through {@link fromAny} so the fallback participates in the
 * reactive protocol uniformly. Bare strings, arrays, and other synchronous scalars are treated
 * as single values (NOT split into characters / elements) to avoid the `fromAny`-on-string
 * iteration gotcha.
 *
 * Composes naturally with {@link retry}:
 * `pipe(source, retry({count:3}), fallback("default"))`.
 *
 * @param source - Upstream node.
 * @param fb - Fallback value, node, promise, or async iterable.
 * @returns Node that replaces errors with the fallback.
 *
 * @example
 * ```ts
 * import { fallback, throwError } from "@graphrefly/graphrefly-ts";
 *
 * const safe = fallback(throwError(new Error("boom")), "default");
 * safe.cache; // "default" after subscribe
 * ```
 *
 * @category extra
 */
export function fallback<T>(
	source: Node<T>,
	fb: FallbackInput<T>,
	options?: { meta?: Record<string, unknown> },
): Node<T> {
	const callerMeta = options?.meta;
	return node<T>(
		(_data, a) => {
			let fallbackUnsub: (() => void) | undefined;
			let sourceUnsub: (() => void) | undefined;

			function switchToFallback(): void {
				sourceUnsub?.();
				sourceUnsub = undefined;
				if (isNode(fb) || isThenable(fb) || isAsyncIterable(fb)) {
					const fbNode = fromAny(fb as Node<T> | PromiseLike<T> | AsyncIterable<T>);
					fallbackUnsub = fbNode.subscribe((fMsgs) => {
						a.down(fMsgs);
						// qa A14: clear fallbackUnsub on terminal so the teardown
						// closure doesn't double-call it. Idempotency of
						// fromAny's unsub is implementation-defined; explicit
						// self-clear is safer.
						for (const fm of fMsgs) {
							const ft = fm[0];
							if (ft === COMPLETE || ft === ERROR || ft === TEARDOWN) {
								fallbackUnsub = undefined;
								return;
							}
						}
					});
				} else {
					a.emit(fb as T);
					a.down([[COMPLETE]]);
				}
			}

			sourceUnsub = source.subscribe((msgs) => {
				for (const m of msgs) {
					const t = m[0];
					if (t === DIRTY) a.down([[DIRTY]]);
					else if (t === DATA) a.emit(m[1] as T);
					else if (t === RESOLVED) a.down([[RESOLVED]]);
					else if (t === COMPLETE) a.down([[COMPLETE]]);
					else if (t === ERROR) {
						switchToFallback();
						return;
					} else if (t === TEARDOWN) {
						fallbackUnsub?.();
						a.down([m]);
						return;
					} else a.down([m]);
				}
			});

			return () => {
				sourceUnsub?.();
				fallbackUnsub?.();
			};
		},
		{
			...operatorOpts(),
			initial: source.cache,
			meta: { ...(callerMeta ?? {}), ...factoryTag("fallback") },
		},
	);
}
