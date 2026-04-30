/**
 * Server-Sent Events IO — `toSSE` / `toSSEBytes` (encode any node into the
 * `text/event-stream` wire format), `toReadableStream` (web-stream sink),
 * `parseSSEStream` (async-iterator parser), `fromSSE` (line-delimited parser
 * source).
 *
 * Re-exports from `./index.js` (the consolidated io source); physical body
 * split deferred — see `archive/docs/SESSION-patterns-extras-consolidation-plan.md`
 * §2 for status.
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
