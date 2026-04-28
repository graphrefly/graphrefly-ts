/**
 * @internal — shared helpers for the AI pattern modules.
 *
 * NOT part of the public API. Consumers reach public symbols through
 * `@graphrefly/graphrefly/patterns/ai` (the barrel).
 *
 * @module
 */

import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { domainMeta } from "../../extra/meta.js";
import { fromAny, type NodeInput } from "../../extra/sources.js";
import { ResettableTimer } from "../../extra/timer.js";

export function aiMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("ai", kind, extra);
}

export function isPromiseLike(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

export function isNodeLike(x: unknown): x is Node<unknown> {
	return (
		typeof x === "object" &&
		x !== null &&
		"subscribe" in x &&
		typeof (x as Node<unknown>).subscribe === "function" &&
		"cache" in x
	);
}

export function isAsyncIterableLike(x: unknown): x is AsyncIterable<unknown> {
	return (
		x != null &&
		typeof x === "object" &&
		Symbol.asyncIterator in x &&
		typeof (x as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
	);
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** First settled `DATA` from a `Node` (do not pass plain strings — `fromAny` would iterate chars). */
export function firstDataFromNode(
	resolved: Node<unknown>,
	opts?: { timeoutMs?: number },
): Promise<unknown> {
	if ((resolved as { status?: string }).status === "settled") {
		const immediate = resolved.cache;
		if (immediate !== undefined) {
			return Promise.resolve(immediate);
		}
	}
	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		const timer = new ResettableTimer();
		const unsub = resolved.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) {
					timer.cancel();
					unsub();
					resolve(msg[1]);
					return;
				}
				if (msg[0] === ERROR) {
					timer.cancel();
					unsub();
					reject(msg[1]);
					return;
				}
				if (msg[0] === COMPLETE) {
					timer.cancel();
					unsub();
					reject(new Error("firstDataFromNode: completed without producing a value"));
					return;
				}
			}
		});
		timer.start(timeoutMs, () => {
			unsub();
			reject(new Error(`firstDataFromNode: timed out after ${timeoutMs}ms`));
		});
	});
}

/** Await Promise-likes, then resolve `Node` / async-iterable inputs via `fromAny` + first `DATA`. */
export async function resolveToolHandlerResult(value: unknown): Promise<unknown> {
	if (isPromiseLike(value)) {
		return resolveToolHandlerResult(await value);
	}
	if (isNodeLike(value)) {
		return firstDataFromNode(value);
	}
	if (isAsyncIterableLike(value)) {
		return firstDataFromNode(fromAny(value as NodeInput<unknown>));
	}
	return value;
}

/** Strip markdown code fences, handling trailing commentary after closing fence. */
export function stripFences(text: string): string {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```[\s\S]*$/);
	return match ? match[1]! : text;
}
