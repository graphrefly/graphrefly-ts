/**
 * Grafana Loki sink IO — `toLoki` pushes upstream `DATA` values as log
 * entries via the duck-typed {@link LokiClientLike} `push()` surface.
 */

import type { Node } from "@graphrefly/pure-ts/core";
import { wallClockNs } from "@graphrefly/pure-ts/core";
import type { ExtraOpts } from "./_internal.js";
import { type ReactiveSinkHandle, reactiveSink, type SinkTransportError } from "./_sink.js";

/** Loki log stream entry. */
export type LokiStream = {
	stream: Record<string, string>;
	values: [string, string][];
};

/** Duck-typed Loki push client (HTTP push API). */
export type LokiClientLike = {
	push(streams: { streams: LokiStream[] }): Promise<unknown>;
};

/** Options for {@link toLoki}. */
export type ToLokiOptions<T> = ExtraOpts & {
	/** Static labels applied to every log entry. */
	labels?: Record<string, string>;
	/** Extract the log line from a value. Default: `JSON.stringify(v)`. */
	toLine?: (value: T) => string;
	/** Extract additional labels from a value. Default: none. */
	toLabels?: (value: T) => Record<string, string>;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Grafana Loki sink — pushes upstream `DATA` values as log entries.
 *
 * @param source - Upstream node.
 * @param client - Loki-compatible client with `push()`.
 * @param opts - Label, serialization, and error options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toLoki<T>(
	source: Node<T>,
	client: LokiClientLike,
	opts?: ToLokiOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		labels = {},
		toLine = (v: T) => JSON.stringify(v),
		toLabels,
		onTransportError,
	} = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		serialize: (value) => ({
			line: toLine(value),
			labels: toLabels ? { ...labels, ...toLabels(value) } : labels,
		}),
		send: async (payload) => {
			const { line, labels: streamLabels } = payload as {
				line: string;
				labels: Record<string, string>;
			};
			const ts = `${wallClockNs()}`;
			await client.push({ streams: [{ stream: streamLabels, values: [[ts, line]] }] });
		},
	});
}
