/**
 * Grafana Tempo sink IO — `toTempo` pushes upstream `DATA` values as trace
 * spans (OTLP/HTTP shape) via the duck-typed {@link TempoClientLike}.
 */

import type { Node } from "../../core/node.js";
import {
	type ReactiveSinkHandle,
	reactiveSink,
	type SinkTransportError,
} from "../reactive-sink.js";
import type { ExtraOpts } from "./_internal.js";

/** Duck-typed Tempo span push client (OTLP/HTTP shape). */
export type TempoClientLike = {
	push(payload: { resourceSpans: unknown[] }): Promise<unknown>;
};

/** Options for {@link toTempo}. */
export type ToTempoOptions<T> = ExtraOpts & {
	/** Transform a value into OTLP resourceSpans entries. */
	toResourceSpans?: (value: T) => unknown[];
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Grafana Tempo sink — pushes upstream `DATA` values as trace spans.
 *
 * @param source - Upstream node.
 * @param client - Tempo-compatible client with `push()`.
 * @param opts - Span transform and error options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toTempo<T>(
	source: Node<T>,
	client: TempoClientLike,
	opts?: ToTempoOptions<T>,
): ReactiveSinkHandle<T> {
	const { toResourceSpans = (v: T) => [v], onTransportError } = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		serialize: toResourceSpans,
		send: async (spans) => {
			await client.push({ resourceSpans: spans as unknown[] });
		},
	});
}
