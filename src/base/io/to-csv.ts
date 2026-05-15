/**
 * CSV file sink IO — `toCSV` adds CSV row formatting on top of
 * {@link toFile}. Uses the local `escapeCSVField` helper to quote cells that
 * contain delimiters / quotes / newlines.
 */

import type { Node } from "@graphrefly/pure-ts/core/node.js";
import type { ReactiveSinkHandle, SinkTransportError } from "../reactive-sink.js";
import type { ExtraOpts } from "./_internal.js";
import { type FileWriterLike, toFile } from "./to-file.js";

/** Options for {@link toCSV}. */
export type ToCSVOptions<T> = ExtraOpts & {
	/** Column names. Required — determines header row and field order. */
	columns: string[];
	/** Column delimiter. Default: `","`. */
	delimiter?: string;
	/** Whether to write a header row on first flush. Default: `true`. */
	writeHeader?: boolean;
	/** Extract a cell value from the row object. Default: `String(row[col] ?? "")`. */
	cellExtractor?: (row: T, column: string) => string;
	/** Flush interval in ms. Default: `0` (write-through). */
	flushIntervalMs?: number;
	/** Buffer size before auto-flush. Default: `Infinity`. */
	batchSize?: number;
	onTransportError?: (err: SinkTransportError) => void;
};

function escapeCSVField(value: string, delimiter: string): string {
	if (value.includes(delimiter) || value.includes('"') || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/**
 * CSV file sink — writes upstream `DATA` as CSV rows.
 *
 * @param source - Upstream node.
 * @param writer - Writable file handle.
 * @param opts - Column definition, delimiter, and buffering options.
 * @returns `BufferedSinkHandle`.
 *
 * @category extra
 */
export function toCSV<T>(
	source: Node<T>,
	writer: FileWriterLike,
	opts: ToCSVOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		columns,
		delimiter = ",",
		writeHeader = true,
		cellExtractor = (row: T, col: string) => String((row as Record<string, unknown>)[col] ?? ""),
		flushIntervalMs = 0,
		batchSize = Number.POSITIVE_INFINITY,
		onTransportError,
		...rest
	} = opts;

	let headerWritten = false;

	const serializeRow = (row: T): string => {
		if (!headerWritten && writeHeader) {
			headerWritten = true;
			const header = columns.map((c) => escapeCSVField(c, delimiter)).join(delimiter);
			const data = columns
				.map((c) => escapeCSVField(cellExtractor(row, c), delimiter))
				.join(delimiter);
			return `${header}\n${data}\n`;
		}
		return `${columns.map((c) => escapeCSVField(cellExtractor(row, c), delimiter)).join(delimiter)}\n`;
	};

	return toFile<T>(source, writer, {
		serialize: serializeRow,
		flushIntervalMs,
		batchSize,
		onTransportError,
		...rest,
	});
}
