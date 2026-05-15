/**
 * Internal helpers shared by source sub-files.
 *
 * Type aliases (`ExtraOpts`, `AsyncSourceOpts`, `NodeInput`) and shape-test
 * helpers used across `iter.ts`, `event.ts`, `async.ts`, and `settled.ts` live
 * here so each sub-file can import only what it needs.
 *
 * `escapeRegexChar` / `globToRegExp` / `matchesAnyPattern` are also surfaced
 * through `extra/adapters.ts` and `extra/sources-fs.ts` for shared glob
 * matching — keep them as named exports.
 */

import type { Node, NodeOptions } from "../../core/node.js";

export type ExtraOpts = Omit<NodeOptions<unknown>, "describeKind">;

export function sourceOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "producer", ...opts } as NodeOptions<T>;
}

/** Options for {@link fromTimer} / {@link fromPromise} / {@link fromAsyncIter}. */
export type AsyncSourceOpts = ExtraOpts & { signal?: AbortSignal };

/**
 * Values accepted by {@link fromAny}.
 *
 * @category extra
 */
export type NodeInput<T> = Node<T> | PromiseLike<T> | AsyncIterable<T> | Iterable<T> | T;

/** @internal Shared with adapters.ts and sources-fs.ts for glob matching. */
export function escapeRegexChar(ch: string): string {
	return /[\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch;
}

/** @internal */
export function globToRegExp(glob: string): RegExp {
	let out = "^";
	for (let i = 0; i < glob.length; i += 1) {
		const ch = glob[i];
		if (ch === "*") {
			const next = glob[i + 1];
			if (next === "*") {
				out += ".*";
				i += 1;
			} else {
				out += "[^/]*";
			}
			continue;
		}
		out += escapeRegexChar(ch);
	}
	out += "$";
	return new RegExp(out);
}

/** @internal */
export function matchesAnyPattern(path: string, patterns: RegExp[]): boolean {
	for (const pattern of patterns) {
		if (pattern.test(path)) return true;
	}
	return false;
}

export function isThenable(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

export function isNode(x: unknown): x is Node {
	return (
		x != null &&
		typeof x === "object" &&
		"cache" in x &&
		typeof (x as Node).subscribe === "function"
	);
}
