/**
 * NDJSON (newline-delimited JSON) IO — `fromNDJSON` reads an
 * `AsyncIterable<string>` of NDJSON chunks (one node per line) and
 * `ndjsonRows` is the stateful operator variant for existing reactive
 * `Node<string>` upstreams.
 */

import { COMPLETE, ERROR, type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";
import { type ExtraOpts, sourceOpts } from "./_internal.js";

/**
 * Stateful NDJSON parser operator — takes a `Node<string>` of raw text chunks
 * and emits one `DATA` per parsed JSON object. Buffers partial lines across
 * chunks.
 *
 * @category extra
 */
export function ndjsonRows<T = unknown>(source: Node<string>, opts?: ExtraOpts): Node<T> {
	// Lock 6.D (Phase 13.6.B): clear parser buffer on deactivation so a
	// resubscribed operator doesn't bleed a half-line from a prior run.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<T>(
		[source as Node],
		(data, a, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.buffer;
					},
				};
			}
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) return cleanup;
			const s = ctx.store as { buffer: string };
			if (typeof s.buffer !== "string") s.buffer = "";
			for (const chunkRaw of batch0) {
				s.buffer = s.buffer + (chunkRaw as string);
				const lines: string[] = s.buffer.split(/\r?\n/);
				s.buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						a.emit(JSON.parse(line) as T);
					} catch (err) {
						a.down([[ERROR, err]]);
						return cleanup;
					}
				}
			}
			return cleanup;
		},
		{ describeKind: "derived", ...(opts ?? {}) } as NodeOptions<T>,
	);
}

/** Options for {@link fromNDJSON}. */
export type FromNDJSONOptions = ExtraOpts & {};

/**
 * Newline-delimited JSON stream ingest for batch replay.
 *
 * Reads an async iterable of text chunks, splits by newline, parses each line
 * as JSON, and emits one `DATA` per parsed object. `COMPLETE` after stream ends.
 *
 * @param source - Async iterable of NDJSON text chunks.
 * @param opts - Optional producer options.
 * @returns `Node<T>` — one `DATA` per JSON line.
 *
 * @example
 * ```ts
 * import { createReadStream } from "node:fs";
 * import { fromNDJSON } from "@graphrefly/graphrefly-ts";
 *
 * const logs$ = fromNDJSON(createReadStream("logs.ndjson", "utf-8"));
 * ```
 *
 * @category extra
 */
export function fromNDJSON<T = unknown>(
	source: AsyncIterable<string>,
	opts?: FromNDJSONOptions,
): Node<T> {
	return node<T>(
		[],
		(_data, a) => {
			let cancelled = false;

			const run = async () => {
				try {
					let buffer = "";

					for await (const chunk of source) {
						if (cancelled) return;
						buffer += chunk;

						const lines = buffer.split(/\r?\n/);
						buffer = lines.pop() ?? "";

						for (const line of lines) {
							if (cancelled) return;
							const trimmed = line.trim();
							if (!trimmed) continue;
							a.emit(JSON.parse(trimmed) as T);
						}
					}

					// Process remaining buffer.
					if (!cancelled && buffer.trim()) {
						a.emit(JSON.parse(buffer.trim()) as T);
					}

					if (!cancelled) a.down([[COMPLETE]]);
				} catch (err) {
					if (!cancelled) a.down([[ERROR, err]]);
				}
			};

			void run();

			return () => {
				cancelled = true;
			};
		},
		sourceOpts(opts),
	);
}
