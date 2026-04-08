/**
 * Harness pipeline trace (roadmap §9.0 — Inspection Tool Consolidation).
 *
 * Attaches reactive observers (via `observe()`) to all harness stages.
 * One call gives full pipeline visibility with stage labels and elapsed
 * timestamps relative to the `harnessTrace()` invocation time.
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

/** Handle returned by {@link harnessTrace}. Call `dispose()` to stop tracing. */
export interface HarnessTraceHandle {
	dispose(): void;
}

/** Options for {@link harnessTrace}. */
export interface HarnessTraceOptions {
	/** Sink for rendered trace lines. Default: `console.log`. */
	logger?: (line: string) => void;
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
 * Elapsed timestamps are relative to the `harnessTrace()` invocation time,
 * not the first event.
 *
 * @param harness - The HarnessGraph to trace.
 * @param opts - Optional configuration.
 * @returns Handle with `dispose()` to stop tracing.
 */
export function harnessTrace(
	harness: HarnessGraph,
	opts?: HarnessTraceOptions,
): HarnessTraceHandle {
	const logger = opts?.logger ?? console.log;
	const startNs = monotonicNs();
	const observations: ObserveResult[] = [];

	function elapsed(): string {
		const deltaNs = monotonicNs() - startNs;
		const secs = deltaNs / 1e9;
		return secs.toFixed(3);
	}

	// Observe each stage node
	for (const [path, stage] of Object.entries(STAGE_LABELS)) {
		try {
			const obs = harness.observe(path, {
				format: "json",
				logger: (_line, event) => {
					if (event.type === "data") {
						const dataStr = event.data !== undefined ? ` ${summarize(event.data)}` : "";
						logger(`[${elapsed()}s] ${stage.padEnd(9)} ←${dataStr}`);
					} else if (event.type === "error") {
						const errStr = event.data !== undefined ? ` ${summarize(event.data)}` : "";
						logger(`[${elapsed()}s] ${stage.padEnd(9)} ✗${errStr}`);
					} else if (event.type === "complete") {
						logger(`[${elapsed()}s] ${stage.padEnd(9)} ■ complete`);
					}
				},
				includeTypes: ["data", "error", "complete"],
			});
			observations.push(obs);
		} catch {
			// Node may not exist (e.g., queue route not mounted) — skip silently
		}
	}

	// Observe gate outputs per gated queue
	for (const [gatedRoute] of harness.gates) {
		const gatePath = `gates::${gatedRoute}/gate`;
		try {
			const obs = harness.observe(gatePath, {
				format: "json",
				logger: (_line, event) => {
					if (event.type === "data") {
						const dataStr = event.data !== undefined ? ` ${summarize(event.data)}` : "";
						logger(`[${elapsed()}s] GATE      ▶${dataStr}`);
					} else if (event.type === "error") {
						logger(`[${elapsed()}s] GATE      ✗ ${summarize(event.data)}`);
					}
				},
				includeTypes: ["data", "error", "complete"],
			});
			observations.push(obs);
		} catch {
			// Gate node path may differ — skip silently
		}
	}

	return {
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
