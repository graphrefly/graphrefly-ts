/**
 * Redactor — stream extractor that replaces matched patterns in accumulated text.
 *
 * **Wave A Unit 3 rewrite:** signature now takes `accumulatedText: Node<string>`
 * instead of the retired `TopicGraph<StreamChunk>`. The output is a
 * `Node<string>` carrying the sanitized accumulated text — compose with
 * `contentGate` or downstream UI directly.
 *
 * @module
 */

import { type Node, node } from "../../../core/node.js";

/** Options for {@link redactor}. */
export type RedactorOptions = {
	name?: string;
};

/**
 * Derived node that replaces matched patterns in accumulated text.
 *
 * @param accumulatedText - Reactive accumulated-text source.
 * @param patterns - Array of RegExps to match against the text.
 * @param replaceFn - Replacement producer (default: always `"[REDACTED]"`).
 * @returns `Node<string>` emitting the sanitized accumulated text.
 */
export function redactor(
	accumulatedText: Node<string>,
	patterns: RegExp[],
	replaceFn?: (match: string, pattern: RegExp) => string,
	opts?: RedactorOptions,
): Node<string> {
	const replace = replaceFn ?? (() => "[REDACTED]");

	function sanitize(text: string): string {
		let result = text;
		for (const pat of patterns) {
			const global = pat.global ? pat : new RegExp(pat.source, `${pat.flags}g`);
			result = result.replace(global, (m) => replace(m, pat));
		}
		return result;
	}

	return node<string>(
		[accumulatedText],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(sanitize((data[0] as string | undefined) ?? ""));
		},
		{ describeKind: "derived", name: opts?.name ?? "redactor", initial: "" },
	);
}
