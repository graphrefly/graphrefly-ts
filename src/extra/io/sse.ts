/**
 * Server-Sent Events IO — `toSSE`, `parseSSEStream`, `fromSSE`.
 *
 * Re-exports from `./index.js` (the consolidated io source). Sub-file exists
 * for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	type FromSSEOptions,
	fromSSE,
	type ParseSSEStreamOptions,
	parseSSEStream,
	type SSEEvent,
	type ToSSEOptions,
	toReadableStream,
	toSSE,
	toSSEBytes,
} from "./index.js";
