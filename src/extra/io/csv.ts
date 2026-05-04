/**
 * CSV ingest IO — `fromCSV` reads an `AsyncIterable<string>` of CSV chunks
 * (one node per row), and `csvRows` is the stateful operator variant for
 * existing reactive `Node<string>` upstreams. Both share the local
 * `parseCSVLine` helper so quoted fields and embedded delimiters are handled
 * uniformly.
 */

import { COMPLETE, ERROR } from "../../core/messages.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import { type ExtraOpts, sourceOpts } from "./_internal.js";

/** Parsed CSV row. */
export type CSVRow = Record<string, string>;

/** Options for {@link fromCSV}. */
export type FromCSVOptions = ExtraOpts & {
	/** Column delimiter. Default: `","`. */
	delimiter?: string;
	/** Whether the first row is a header. Default: `true`. */
	hasHeader?: boolean;
	/** Explicit column names (overrides header row). */
	columns?: string[];
	/** Custom line parser (e.g. wrapping a library like `csv-parse`). Overrides built-in parser + delimiter. */
	parseLine?: (line: string) => string[];
};

/**
 * CSV file/stream ingest for batch replay.
 *
 * Reads a CSV from a `ReadableStream<string>` or an `AsyncIterable<string>` of lines,
 * emitting one `DATA` per row. `COMPLETE` after all rows are emitted.
 *
 * @param source - Async iterable of CSV text chunks (lines or multi-line chunks).
 * @param opts - Delimiter, header, and column options.
 * @returns `Node<CSVRow>` — one `DATA` per parsed row.
 *
 * @example
 * ```ts
 * import { createReadStream } from "node:fs";
 * import { fromCSV } from "@graphrefly/graphrefly-ts";
 *
 * const csv$ = fromCSV(createReadStream("data.csv", "utf-8"));
 * ```
 *
 * @category extra
 */
export function fromCSV(source: AsyncIterable<string>, opts?: FromCSVOptions): Node<CSVRow> {
	const {
		delimiter = ",",
		hasHeader = true,
		columns: explicitColumns,
		parseLine,
		...rest
	} = opts ?? {};
	const parse = parseLine ?? ((line: string) => parseCSVLine(line, delimiter));

	return node<CSVRow>(
		[],
		(_data, a) => {
			let cancelled = false;

			const run = async () => {
				try {
					let headers: string[] | undefined = explicitColumns;
					let buffer = "";

					for await (const chunk of source) {
						if (cancelled) return;
						buffer += chunk;

						const lines = buffer.split(/\r?\n/);
						// Keep last partial line in buffer.
						buffer = lines.pop() ?? "";

						for (const line of lines) {
							if (cancelled) return;
							if (!line.trim()) continue;

							const values = parse(line);

							if (!headers && hasHeader) {
								headers = values;
								continue;
							}

							if (!headers) {
								headers = values.map((_, i) => `col${i}`);
							}

							const row: CSVRow = {};
							for (let i = 0; i < headers.length; i++) {
								row[headers[i]] = values[i] ?? "";
							}
							a.emit(row);
						}
					}

					// Process remaining buffer.
					if (!cancelled && buffer.trim()) {
						const values = parse(buffer);
						if (headers) {
							const row: CSVRow = {};
							for (let i = 0; i < headers.length; i++) {
								row[headers[i]] = values[i] ?? "";
							}
							a.emit(row);
						}
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
		sourceOpts(rest),
	);
}

/**
 * Stateful CSV parser operator — takes a `Node<string>` emitting raw text
 * chunks (from any source: {@link fromAsyncIter}, {@link fromHTTPStream},
 * WebSocket, file watcher, etc.) and emits one `DATA` per parsed row.
 *
 * Buffers incomplete lines across chunks. Mirrors {@link fromCSV}'s parsing
 * logic without committing to an async-iterable-only input.
 *
 * @example
 * ```ts
 * import { fromHTTPStream, csvRows } from "@graphrefly/graphrefly-ts";
 * const bytes$ = fromHTTPStream("https://example.com/data.csv");
 * const text$ = decodeText(bytes$);   // caller-provided byte→string decoder
 * const rows$ = csvRows(text$, { columns: ["name", "age"] });
 * ```
 *
 * @category extra
 */
export function csvRows(source: Node<string>, opts?: FromCSVOptions): Node<CSVRow> {
	const {
		delimiter = ",",
		hasHeader = true,
		columns: explicitColumns,
		parseLine,
		...rest
	} = opts ?? {};
	const parse = parseLine ?? ((line: string) => parseCSVLine(line, delimiter));
	// Lock 6.D (Phase 13.6.B): clear parser state on deactivation so
	// `csvRows` under retry/resubscribe patterns doesn't leak a stale
	// half-parsed line or sticky header detection from a prior run.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<CSVRow>(
		[source as Node],
		(data, a, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.buffer;
						delete store.headers;
					},
				};
			}
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) return cleanup;
			const s = ctx.store as { buffer: string; headers: string[] | undefined };
			if (typeof s.buffer !== "string") s.buffer = "";
			if (s.headers === undefined && explicitColumns) s.headers = explicitColumns.slice();
			for (const chunkRaw of batch0) {
				s.buffer = s.buffer + (chunkRaw as string);
				const lines: string[] = s.buffer.split(/\r?\n/);
				s.buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					const values = parse(line);
					if (!s.headers && hasHeader) {
						s.headers = values;
						continue;
					}
					if (!s.headers) s.headers = values.map((_, i) => `col${i}`);
					const row: CSVRow = {};
					for (let i = 0; i < s.headers.length; i++) row[s.headers[i]] = values[i] ?? "";
					a.emit(row);
				}
			}
			return cleanup;
		},
		{ describeKind: "derived", ...rest } as NodeOptions<CSVRow>,
	);
}

function parseCSVLine(line: string, delimiter: string): string[] {
	const values: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === delimiter) {
			values.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	values.push(current);
	return values;
}
