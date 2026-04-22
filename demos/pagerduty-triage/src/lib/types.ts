import type { Alert, Severity } from "./alerts.js";

// ── User decisions ──────────────────────────────────────────────

export type Disposition = "actionable" | "escalated" | "resolved" | "deferred";

export interface TriagedAlert {
	readonly alert: Alert;
	readonly disposition: Disposition;
	/** For deferred: delay in ms before re-surfacing. */
	readonly deferMs?: number;
	/** LLM classification brief. */
	readonly brief: string;
	/** LLM confidence 0-1. */
	readonly confidence: number;
	/** Whether this was auto-classified by a learned pattern. */
	readonly autoClassified: boolean;
	/** Timestamp when triaged. */
	readonly triagedAt: number;
}

// ── LLM classification output ───────────────────────────────────

export interface ClassifyResult {
	/** Echoed from the prompt so stale results can be detected. */
	readonly alertId: string;
	readonly disposition: Disposition;
	readonly confidence: number;
	readonly brief: string;
}

// ── Learned pattern (extracted by agentMemory) ──────────────────

export interface LearnedPattern {
	/** Semantic description, e.g. "connection-timeout on db-*" */
	readonly patternKey: string;
	/** Matching attributes (structured for programmatic matching) */
	readonly match: {
		readonly service?: string | readonly string[];
		readonly severityRange?: readonly Severity[];
		readonly errorCategory: string;
	};
	/** The user's consistent decision for this pattern. */
	readonly disposition: Disposition;
	readonly deferMs?: number;
	/** How many user decisions formed this pattern. */
	readonly sampleCount: number;
	/** Confidence that the pattern is stable. */
	readonly confidence: number;
}

// ── Token accounting ────────────────────────────────────────────

export interface TokenSnapshot {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly localCacheHits: number;
	readonly calls: number;
}

// ── Demo mode ───────────────────────────────────────────────────

export type AdapterMode = "chrome-nano" | "byok" | "dry-run";

export interface AdapterInfo {
	readonly name: string;
	readonly status: "ready" | "downloading" | "unavailable";
	readonly note: string;
}

// ── Run state ───────────────────────────────────────────────────

export type RunPhase = "setup" | "running" | "finished";
