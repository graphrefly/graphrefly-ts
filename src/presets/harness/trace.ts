/**
 * Harness pipeline trace — thin sugar over `graph.observe({ format: "stage-log" })`.
 *
 * Since 2026-04-22 (D2), stage-labeled tracing is a first-class observe format
 * on {@link Graph}. `harnessTrace` wires that format over the 7 pipeline stages
 * (INTAKE → TRIAGE → QUEUE → GATE → EXECUTE → VERIFY → STRATEGY) with sensible
 * defaults so harness consumers don't need to restate the stage map.
 *
 * For non-harness graphs, call `graph.observe({ format: "stage-log", stageLabels })`
 * directly — the format is domain-agnostic.
 *
 * @module
 */

import { monotonicNs } from "@graphrefly/pure-ts/core";
import type { ObserveEvent, ObserveResult } from "@graphrefly/pure-ts/graph";
import type { HarnessGraph } from "./harness-loop.js";

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
	/** Sink for rendered trace lines. Default: `console.log`. Pass `null` for structured-only. */
	logger?: ((line: string) => void) | null;
	/** Detail level for both string and structured output. Default: `"summary"`. */
	detail?: TraceDetail;
}

// ---------------------------------------------------------------------------
// Stage labels
// ---------------------------------------------------------------------------

/**
 * Observe paths → stage labels for the 7 harness stages. Path set is
 * sourced from {@link HarnessGraph.stageNodes} so inspection tools stay
 * decoupled from mount-structure changes (Unit 22 C).
 */
function buildStageLabels(harness: HarnessGraph): Record<string, string> {
	const labels: Record<string, string> = {};
	for (const { label, paths } of harness.stageNodes()) {
		for (const p of paths) labels[p] = label;
	}
	return labels;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Attach a stage-log trace over the harness pipeline. Delegates to
 * `harness.observe({ format: "stage-log", ... })` for each stage path —
 * every event is captured in `handle.events` (structured) AND rendered via
 * the `logger` (string output).
 *
 * **Detail levels:**
 * - `"summary"` — stage + elapsed only. Minimal overhead.
 * - `"standard"` (default) — stage + elapsed + truncated data preview.
 * - `"full"` — stage + elapsed + full raw data object in events.
 *
 * Elapsed timestamps are relative to the `harnessTrace()` invocation time,
 * not the first event.
 */
export function harnessTrace(
	harness: HarnessGraph,
	opts?: HarnessTraceOptions,
): HarnessTraceHandle {
	const logger: ((line: string) => void) | null =
		opts?.logger === null ? null : (opts?.logger ?? console.log);
	const detail: TraceDetail = opts?.detail ?? "summary";
	const startNs = monotonicNs();
	const observations: ObserveResult[] = [];
	const events: TraceEvent[] = [];
	const stageLabels = buildStageLabels(harness);

	function elapsedSecs(): number {
		return (monotonicNs() - startNs) / 1e9;
	}

	function recordEvent(stage: string, type: TraceEventType, rawData: unknown): void {
		const ev: TraceEvent = { elapsed: elapsedSecs(), stage, type };
		if (detail !== "summary") ev.summary = summarize(rawData);
		if (detail === "full") ev.data = rawData;
		events.push(ev);
	}

	// One observe call per path — keeps per-stage elapsed offsets anchored to
	// this invocation (the shared stage-log format uses its own elapsed clock
	// per observation, which matches the legacy behavior). We also intercept
	// each event through `onEvent` so structured `events[]` stays populated
	// regardless of `logger`.
	for (const [path, stage] of Object.entries(stageLabels)) {
		try {
			const obs = harness.observe(path, {
				format: "stage-log",
				stageLabels,
				logger: logger ? (line: string) => logger(line) : () => {},
				includeTypes: ["data", "error", "complete"],
			});
			obs.onEvent((event: ObserveEvent) => {
				if (event.type === "data") recordEvent(stage, "data", (event as { data: unknown }).data);
				else if (event.type === "error")
					recordEvent(stage, "error", (event as { data: unknown }).data);
				else if (event.type === "complete") recordEvent(stage, "complete", undefined);
			});
			observations.push(obs);
		} catch (err) {
			// Node may not exist yet (e.g., a gated-queue route that hasn't been
			// mounted on this harness). Record a synthetic error trace event so
			// consumers see WHICH stage dropped out and why — silent swallow
			// breaks dry-run equivalence (a regression in stage wiring would
			// not surface in the trace).
			const msg = err instanceof Error ? err.message : String(err);
			recordEvent(stage, "error", `observe-unavailable: ${path} — ${msg}`);
			if (logger) {
				logger(`[${elapsedSecs().toFixed(3)}s] ${stage.padEnd(9)} ✗ observe-unavailable: ${msg}`);
			}
		}
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
// Helpers — kept here because `observe({ format: "stage-log" })` emits short
// one-line previews; the structured `events[]` is free to carry richer
// summaries with different truncation bounds (120 for JSON, 80 for strings).
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
