/**
 * Harness pipeline trace (roadmap §9.0 — Inspection Tool Consolidation).
 *
 * Attaches reactive observers (via `observe()`) to all harness stages.
 * One call gives full pipeline visibility with stage labels and elapsed
 * timestamps relative to the `harnessTrace()` invocation time.
 *
 * Supports two output modes:
 * - **String logger** (default): rendered lines to `console.log` or a custom sink.
 * - **Structured events**: programmatic `TraceEvent[]` list for test assertions
 *   and tooling. Access via `handle.events`.
 *
 * Supports configurable detail levels (`"summary"`, `"standard"`, `"full"`)
 * to control output verbosity without composing different tool calls.
 *
 * @module
 */

import { monotonicNs } from "../../core/clock.js";
import type { ObserveResult } from "../../graph/graph.js";
import type { HarnessGraph } from "./loop.js";
import { QUEUE_NAMES } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event type captured by structured trace. */
export type TraceEventType = "data" | "error" | "complete";

/** A single structured trace event. */
export interface TraceEvent {
	/** Elapsed seconds since trace was created. */
	elapsed: number;
	/** Pipeline stage label (INTAKE, TRIAGE, QUEUE, GATE, EXECUTE, VERIFY, STRATEGY). */
	stage: string;
	/** Event type. */
	type: TraceEventType;
	/** Data payload (present for "data" and "error" events). Omitted at "summary" detail. */
	data?: unknown;
	/** Human-readable summary of the data. Present at "standard" and "full" detail. */
	summary?: string;
}

/** Detail level for trace output. */
export type TraceDetail =
	/** Stage + elapsed only. No data preview. Lowest overhead. */
	| "summary"
	/** Stage + elapsed + truncated data preview. Default. */
	| "standard"
	/** Stage + elapsed + full raw data. Use for debugging, not production. */
	| "full";

/** Handle returned by {@link harnessTrace}. Call `dispose()` to stop tracing. */
export interface HarnessTraceHandle {
	/** Stop tracing and detach all observers. Safe to call multiple times. */
	dispose(): void;
	/**
	 * Structured trace events collected since creation. Plain array — no
	 * subscription needed (COMPOSITION-GUIDE §1: avoid lazy-activation
	 * friction for inspection tools). Populated reactively via observe().
	 */
	readonly events: readonly TraceEvent[];
}

/** Options for {@link harnessTrace}. */
export interface HarnessTraceOptions {
	/** Sink for rendered trace lines. Default: `console.log`. */
	logger?: (line: string) => void;
	/** Detail level for both string and structured output. Default: `"summary"`. */
	detail?: TraceDetail;
}

// ---------------------------------------------------------------------------
// Stage labels
// ---------------------------------------------------------------------------

/** Observe paths → stage labels for the 7 harness stages. */
const STAGE_LABELS: Record<string, string> = {
	"intake::latest": "INTAKE",
	triage: "TRIAGE",
	execute: "EXECUTE",
	"verify-results::latest": "VERIFY",
	strategy: "STRATEGY",
};

for (const route of QUEUE_NAMES) {
	STAGE_LABELS[`queue/${route}::latest`] = "QUEUE";
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Attach reactive trace observers to all harness pipeline stages.
 *
 * Wires `graph.observe(path, { format: "json" })` to each stage node,
 * intercepting the logger callback to emit stage-labeled lines with
 * elapsed timestamps. Surfaces DATA, ERROR, and COMPLETE events.
 *
 * **Structured events:** Every trace event is also pushed to
 * `handle.events` — a plain array (not a reactive node) that tests and
 * tooling can inspect programmatically. To use structured events alone
 * without string output, pass `{ logger: null }`.
 *
 * **Detail levels:**
 * - `"summary"` — stage + elapsed only. Minimal overhead.
 * - `"standard"` (default) — stage + elapsed + truncated data preview.
 * - `"full"` — stage + elapsed + full raw data object in events.
 *
 * Elapsed timestamps are relative to the `harnessTrace()` invocation time,
 * not the first event.
 *
 * @param harness - The HarnessGraph to trace.
 * @param opts - Optional configuration.
 * @returns Handle with `dispose()` to stop tracing and `events` for structured access.
 */
export function harnessTrace(
	harness: HarnessGraph,
	opts?: HarnessTraceOptions,
): HarnessTraceHandle {
	const logger = opts?.logger ?? console.log;
	const detail: TraceDetail = opts?.detail ?? "summary";
	const startNs = monotonicNs();
	const observations: ObserveResult[] = [];
	const events: TraceEvent[] = [];

	function elapsedSecs(): number {
		return (monotonicNs() - startNs) / 1e9;
	}

	function elapsedStr(): string {
		return elapsedSecs().toFixed(3);
	}

	function recordEvent(stage: string, type: TraceEventType, rawData: unknown): void {
		const e = elapsedSecs();
		const ev: TraceEvent = { elapsed: e, stage, type };

		if (detail !== "summary") {
			ev.summary = summarize(rawData);
		}
		if (detail === "full") {
			ev.data = rawData;
		}

		events.push(ev);
	}

	function wireStage(path: string, stage: string): void {
		try {
			const obs = harness.observe(path, {
				format: "json",
				logger: (_line, event) => {
					if (event.type === "data") {
						recordEvent(stage, "data", event.data);
						if (logger) {
							if (detail === "summary") {
								logger(`[${elapsedStr()}s] ${stage.padEnd(9)} ←`);
							} else {
								const dataStr =
									event.data !== undefined ? ` ${summarize(event.data)}` : "";
								logger(`[${elapsedStr()}s] ${stage.padEnd(9)} ←${dataStr}`);
							}
						}
					} else if (event.type === "error") {
						recordEvent(stage, "error", event.data);
						if (logger) {
							const errStr =
								event.data !== undefined ? ` ${summarize(event.data)}` : "";
							logger(`[${elapsedStr()}s] ${stage.padEnd(9)} ✗${errStr}`);
						}
					} else if (event.type === "complete") {
						recordEvent(stage, "complete", undefined);
						if (logger) {
							logger(`[${elapsedStr()}s] ${stage.padEnd(9)} ■ complete`);
						}
					}
				},
				includeTypes: ["data", "error", "complete"],
			});
			observations.push(obs);
		} catch {
			// Node may not exist (e.g., queue route not mounted) — skip silently
		}
	}

	// Wire stage nodes (COMPOSITION-GUIDE §5: sinks before sources)
	for (const [path, stage] of Object.entries(STAGE_LABELS)) {
		wireStage(path, stage);
	}

	// Wire gate outputs per gated queue
	for (const [gatedRoute] of harness.gates) {
		wireStage(`gates::${gatedRoute}/gate`, "GATE");
	}

	return {
		get events(): readonly TraceEvent[] {
			return events;
		},
		dispose() {
			for (const obs of observations) obs.dispose();
			observations.length = 0;
		},
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarize(value: unknown): string {
	if (value == null) return "null";
	if (typeof value === "string") return truncate(value, 80);
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (typeof value === "bigint") return String(value);
	try {
		const json = JSON.stringify(value);
		return truncate(json, 120);
	} catch {
		return String(value);
	}
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
