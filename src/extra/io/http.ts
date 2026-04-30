/**
 * HTTP IO — `fromHTTP` (one-shot fetch with `withStatus` companion bundle),
 * `toHTTP` (per-record / buffered sink with retry support), `fromHTTPStream`
 * (raw `Uint8Array` byte stream), `fromHTTPPoll` (interval-driven re-fetch).
 *
 * Uses the platform `fetch` API (Node 18+, browsers, Deno, Bun). Timeouts use
 * `AbortController` driven by `setTimeout` per spec §5.10's resilience-operator
 * carve-out.
 *
 * Re-exports from `./index.js` (the consolidated io source); physical body
 * split deferred — see `archive/docs/SESSION-patterns-extras-consolidation-plan.md`
 * §2 for status.
 */

export {
	type FromHTTPOptions,
	type FromHTTPPollOptions,
	type FromHTTPStreamOptions,
	fromHTTP,
	fromHTTPPoll,
	fromHTTPStream,
	type HTTPBundle,
	type ToHTTPOptions,
	toHTTP,
} from "./index.js";
