/**
 * Harness wiring types (roadmap §9.0).
 *
 * Shared types for the reactive collaboration loop: intake, triage, queue,
 * gate, execute, verify, reflect. These types are intentionally domain-agnostic
 * — the harness loop is not specific to eval workflows.
 *
 * Runtime constants and helpers live in `./defaults.ts`. The harness barrel
 * (`./index.ts`) re-exports both so external consumers see a single surface.
 *
 * @module
 */

import type { Node } from "../../core/node.js";
import type { NodeInput } from "../../extra/sources.js";
// Type-only import avoids a runtime cycle with `patterns/ai`.
import type { LLMAdapter } from "../ai/index.js";
import type { JobEnvelope } from "../job-queue/index.js";

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** Known intake source tags. */
export type KnownIntakeSource = "eval" | "test" | "human" | "code-change" | "hypothesis" | "parity";

/**
 * Sources that can produce intake items. Open union — the known tags
 * retain IDE autocomplete while user-supplied strings (e.g. `"schema"`,
 * `"slack"`) pass through without a type change.
 */
export type IntakeSource = KnownIntakeSource | (string & {});

/** Severity levels for intake items. */
export type Severity = "critical" | "high" | "medium" | "low";

/** Root cause categories for triage classification. */
export type RootCause =
	| "composition"
	| "missing-fn"
	| "bad-docs"
	| "schema-gap"
	| "regression"
	| "unknown";

/** Intervention types that address root causes. */
export type Intervention =
	| "template"
	| "catalog-fn"
	| "docs"
	| "wrapper"
	| "schema-change"
	| "investigate";

/** Routing destinations after triage. Closed union — iterated via `QUEUE_NAMES`. */
export type QueueRoute = "auto-fix" | "needs-decision" | "investigation" | "backlog";

/**
 * An item entering the harness loop via the INTAKE stage.
 *
 * All intake sources produce this uniform shape — the intake topic
 * doesn't care where items came from.
 *
 * `$`-prefix keys (`$reingestions`, `$retries` on {@link TriagedItem}) are
 * framework-only — an LLM round-tripping the serialized item is far less
 * likely to echo back a `$`-prefixed key than an `_`-prefixed one, which
 * neutralizes the field-collision class that surfaced earlier in the
 * router's spread order.
 */
export interface IntakeItem {
	source: IntakeSource;
	summary: string;
	evidence: string;
	affectsAreas: string[];
	affectsEvalTasks?: string[];
	severity?: Severity;
	/**
	 * Stable identity carrier for retry / reingestion paths. Per qa D1
	 * (2026-04-29), `relatedTo[0]` MUST be the original tracking key for
	 * items derived from a prior publish so the harness's `routeJobIds`
	 * map preserves identity across decorated retry summaries. First-time
	 * publishes leave this `undefined`; the tracking key falls back to
	 * `summary`. Two first-time publishes with identical `summary` collide
	 * on key — see `trackingKey` JSDoc in `patterns/_internal/index.ts`
	 * for the uniqueness caller contract.
	 */
	relatedTo?: string[];
	/** Item-carried reingestion count. Incremented on each full-loop reingestion. */
	$reingestions?: number;
}

// ---------------------------------------------------------------------------
// Triage output
// ---------------------------------------------------------------------------

/** Output of the TRIAGE stage — enriched intake item with classification. */
export interface TriagedItem extends IntakeItem {
	rootCause: RootCause;
	intervention: Intervention;
	route: QueueRoute;
	priority: number;
	triageReasoning?: string;
	/** Item-carried retry count. Incremented on each fast-retry pass. */
	$retries?: number;
}

// ---------------------------------------------------------------------------
// Strategy model
// ---------------------------------------------------------------------------

/**
 * Preset / persona / skill identifier. Open string set; conventionally
 * matches keys used in {@link presetRegistry} (Phase 13.H). Use
 * {@link DEFAULT_PRESET_ID} ("default") when no preset registry is wired.
 */
export type PresetId = string;

/** Default presetId used when no preset registry is wired (back-compat for 2-axis callers). */
export const DEFAULT_PRESET_ID: PresetId = "default";

/**
 * Key format: `${presetId}|${rootCause}→${intervention}`.
 *
 * **Phase 13.I axis extension (DS-13.I, 2026-05-01).** Widened from the
 * pre-multi-agent 2-axis `${rootCause}→${intervention}` to a 3-axis key
 * carrying the presetId of the agent that ran. Pre-1.0 breaking change;
 * existing callsites pass {@link DEFAULT_PRESET_ID} for the new axis when
 * they don't have a preset registry wired. The strategy-model storage
 * (`auditedSuccessTracker<StrategyKey, StrategyEntry>`) is unchanged
 * structurally — the key shape change cascades through the existing
 * tracker without surface refactor.
 */
export type StrategyKey = `${PresetId}|${RootCause}→${Intervention}`;

/**
 * Effectiveness record for a `(presetId, rootCause, intervention)` triple.
 * Stored under `auditedSuccessTracker<StrategyKey, StrategyEntry>` (Class B
 * audit Alt E collapse, 2026-04-30; presetId axis added Phase 13.I,
 * 2026-05-01) — `key` is the composite `strategyKey(presetId, rc, intv)`
 * computed at the call site; `presetId` / `rootCause` / `intervention` are
 * decoration carried via `record(...)` so consumers can read them without
 * re-parsing the key.
 */
export interface StrategyEntry {
	key: StrategyKey;
	presetId: PresetId;
	rootCause: RootCause;
	intervention: Intervention;
	attempts: number;
	successes: number;
	successRate: number;
}

// ---------------------------------------------------------------------------
// Execution & verification
// ---------------------------------------------------------------------------

/**
 * LLM output shape from the EXECUTE stage (partial — lacks `item`).
 *
 * Generic over the artifact type `A` so typed executors like
 * `refineExecutor<T>` can flow `T` through to an `evalVerifier<T>` without
 * the caller casting `artifact` at the boundary. Defaults to `unknown`
 * for escape-hatch executors that carry opaque state.
 */
export type ExecuteOutput<A = unknown> = {
	/**
	 * Execution outcome classification:
	 *
	 * - `"success"`: execution completed cleanly and the artifact (if any) is
	 *   ready for verification. The verifier should proceed with a full
	 *   evaluation pass.
	 * - `"failure"`: execution did not produce a usable artifact — the actuator
	 *   threw, a prompt parse failed, or `shouldApply` skipped the item. The
	 *   verifier should treat this as a non-result and route accordingly.
	 * - `"partial"`: execution produced a candidate that converged but did not
	 *   fully meet verification criteria. Used by `refineExecutor` when the
	 *   iteration cap is reached without full convergence; the artifact holds
	 *   the best candidate achieved.
	 */
	outcome: "success" | "failure" | "partial";
	detail: string;
	/**
	 * Optional opaque artifact that a custom executor (e.g. `refineExecutor`)
	 * may attach so downstream verifiers can re-run evaluation against the
	 * thing that was produced. LLM-backed default executors never populate
	 * this — it's an escape hatch for reactive executors carrying structured
	 * output (a refined prompt, a patched spec, a generated template, ...).
	 */
	artifact?: A;
};

/** Full execution result assembled downstream (LLM output + context). */
export interface ExecutionResult<A = unknown> {
	item: TriagedItem;
	/**
	 * Execution outcome classification. Same semantics as
	 * {@link ExecuteOutput.outcome}:
	 *
	 * - `"success"`: execution completed cleanly; artifact is ready for
	 *   verification.
	 * - `"failure"`: no usable artifact was produced.
	 * - `"partial"`: best candidate produced but convergence criteria not met
	 *   (iteration cap reached in `refineExecutor`).
	 */
	outcome: "success" | "failure" | "partial";
	detail: string;
	/**
	 * Passthrough of {@link ExecuteOutput.artifact} when the executor emitted
	 * one. Reactive executors like `refineExecutor` populate this; LLM-backed
	 * default executors leave it undefined.
	 */
	artifact?: A;
}

/** Whether an error is self-correctable (fast-retry) or structural (full loop). */
export type ErrorClass = "self-correctable" | "structural";

/** Classifier for fast-retry path. */
export type ErrorClassifier = (result: ExecutionResult) => ErrorClass;

// ---------------------------------------------------------------------------
// Verification output
// ---------------------------------------------------------------------------

/** Result of the VERIFY stage. */
export interface VerifyResult<A = unknown> {
	item: TriagedItem;
	execution: ExecutionResult<A>;
	verified: boolean;
	findings: string[];
	errorClass?: ErrorClass;
}

/**
 * Verifier output shape — what a custom verifier emits. The harness
 * assembles this into the full {@link VerifyResult} using the triaged
 * item + execute output sampled from `executeContextNode`.
 */
export interface VerifyOutput {
	verified: boolean;
	findings: string[];
	errorClass?: ErrorClass;
}

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

/** Configurable signals for priority scoring. */
export interface PrioritySignals {
	/** Per-severity base weight (default: critical=100, high=70, medium=40, low=10). */
	severityWeights?: Partial<Record<Severity, number>>;
	/** Decay rate per second for attention decay (default ~1.15e-6 ≈ 7-day half-life). */
	decayRate?: number;
	/** Strategy model effectiveness boost threshold (default 0.7). */
	effectivenessThreshold?: number;
	/** Strategy model effectiveness boost amount (default 15). */
	effectivenessBoost?: number;
}

// ---------------------------------------------------------------------------
// Harness loop configuration
// ---------------------------------------------------------------------------

import type { StrategySnapshot } from "./strategy.js";

/** Per-queue configuration in the harness loop. */
export interface QueueConfig {
	/** Whether this queue is gated (requires human approval). */
	gated: boolean;
	/** Maximum pending items in the gate (default Infinity). */
	maxPending?: number;
	/** Start the gate in open (auto-approve) mode? Only meaningful when `gated: true`. */
	startOpen?: boolean;
}

/**
 * Accumulating per-job payload threaded through the harness's
 * `executeFlow` ({@link harnessLoop} Tier 6.5 C2 lock). Each stage's work fn
 * receives the prior payload and returns a new one with its own field
 * filled in:
 *
 * - The `enqueueEffect` seeds with `{ item }` only.
 * - The execute work fn fills `execution`.
 * - The verify work fn fills `verify`.
 *
 * The post-completed dispatch effect reads `verify.verified` /
 * `verify.errorClass` to route the item to `verifyResults` /
 * `retryTopic.publish(...)` / `intake.publish(...)` (3-way verdict).
 *
 * Carrying `item` through stage payloads (rather than re-pairing via a
 * separate `withLatestFrom` node) is the C2 deviation from today's
 * `executeContextNode` design: each `JobEnvelope` is self-contained, so the
 * verify pump can run multiple in-flight jobs in parallel without an
 * external pairing node.
 */
export interface HarnessJobPayload<A = unknown> {
	/** The triaged item flowing through execute → verify → dispatch. */
	item: TriagedItem;
	/** Filled by the execute work fn. Verify reads this; dispatch routes. */
	execution?: ExecutionResult<A>;
	/** Filled by the verify work fn. Dispatch reads `verified` / `errorClass`. */
	verify?: VerifyOutput;
}

/**
 * Pluggable EXECUTE work fn — receives a {@link JobEnvelope} carrying a
 * {@link HarnessJobPayload} (with `item` set, `execution` / `verify`
 * unset), returns a {@link NodeInput} that emits the same payload with
 * `execution` filled.
 *
 * **C2 contract (Tier 6.5 lock, 2026-04-28):**
 * 1. Emit DATA exactly once per claimed job. The JobFlow pump subscribes
 *    once, takes the first DATA, then unsubscribes. Subsequent emissions
 *    are ignored.
 * 2. Errors must be caught and surfaced as a `failure` outcome inside the
 *    payload — never throw / return ERROR. A pump nack would drop the
 *    item from JobFlow before the dispatch effect could route it.
 * 3. The work fn runs once per claim — no internal `switchMap` needed.
 *    Per-item subgraphs (e.g. a fresh `refineLoop` per claim) are
 *    instantiated inside the work fn body.
 *
 * `defaultLlmExecutor` (in `defaults.ts`) is a thin `adapter.invoke()`
 * wrapper. `refineExecutor` builds a per-claim `refineLoop`.
 * `actuatorExecutor` runs a side-effecting `apply(item, signal)`.
 */
export type HarnessExecutor<A = unknown> = (
	job: JobEnvelope<HarnessJobPayload<A>>,
	opts?: { signal: AbortSignal },
) => NodeInput<HarnessJobPayload<A>>;

/**
 * Pluggable VERIFY work fn — receives a {@link JobEnvelope} whose payload
 * has `item` + `execution` populated, returns a {@link NodeInput} that
 * emits the same payload with `verify` filled.
 *
 * Same C2 contract rules 1–3 as {@link HarnessExecutor}. The dispatch
 * effect downstream reads `verify.verified` (success → ack +
 * verifyResults publish), `verify.errorClass === "self-correctable"`
 * (retry → republish to retry topic with `$retries` bumped), or anything
 * else (structural → reingest to intake if budget remains).
 *
 * Verify-LLM-call failures (parse error, adapter throw, timeout) MUST be
 * caught and surfaced as a structural-failure `verify` payload (`{
 * verified: false, findings: [...], errorClass: "structural" }`) so the
 * dispatch effect can route the item rather than silently drop it.
 */
export type HarnessVerifier<A = unknown> = (
	job: JobEnvelope<HarnessJobPayload<A>>,
	opts?: { signal: AbortSignal },
) => NodeInput<HarnessJobPayload<A>>;

/** Triage prompt callable shape — pair of `[intake item, strategy snapshot]`. */
export type TriagePromptFn = (pair: readonly [IntakeItem, StrategySnapshot]) => string;
/** Execute prompt callable shape. */
export type ExecutePromptFn = (item: TriagedItem) => string;
/** Verify prompt callable shape — pair of `[execute output, triaged item]`. */
export type VerifyPromptFn<A = unknown> = (
	pair: readonly [ExecuteOutput<A> | null, TriagedItem | null],
) => string;

/** Options for {@link harnessLoop}. */
export interface HarnessLoopOptions<A = unknown> {
	/** LLM adapter for promptNode-based stages (triage + any default executor/verifier). */
	adapter: LLMAdapter;

	/** Custom triage prompt (receives IntakeItem + strategy snapshot as a tuple). */
	triagePrompt?: string | TriagePromptFn;

	/**
	 * Execute prompt — sugar over the default LLM executor. Ignored when
	 * `executor` is set.
	 */
	executePrompt?: string | ExecutePromptFn;

	/**
	 * Verify prompt — sugar over the default LLM verifier. Ignored when
	 * `verifier` is set.
	 */
	verifyPrompt?: string | VerifyPromptFn<A>;

	/**
	 * Pluggable EXECUTE slot. When omitted, the harness uses a `promptNode`
	 * driven by `adapter` + `executePrompt`. Replace to plug in a
	 * `refineExecutor`, tool-using agent, or any reactive execution pipeline.
	 */
	executor?: HarnessExecutor<A>;

	/**
	 * Pluggable VERIFY slot. When omitted, the harness uses a `promptNode`
	 * driven by `adapter` + `verifyPrompt`. Replace to plug in an
	 * `evalVerifier` that re-runs affected eval tasks.
	 */
	verifier?: HarnessVerifier<A>;

	/** Per-queue configuration overrides. */
	queues?: Partial<Record<QueueRoute, QueueConfig>>;

	/** Priority scoring signals. */
	priority?: PrioritySignals;

	/**
	 * Reactive last-human-interaction timestamp (monotonic ns). Drives the
	 * priority score age-decay term for `HarnessGraph.priorityScores`.
	 *
	 * **Required when `opts.priority` is set.** Priority score nodes only
	 * re-derive when `topic.latest`, `strategy.snapshot`, or this tick settles —
	 * an idle queue would freeze its age at construction time if we
	 * auto-defaulted. Typical sources:
	 *  - `fromTimer(60_000)` — steady tick, uniform decay.
	 *  - `state(monotonicNs())` — bumped from a human-interaction handler.
	 *  - A reactive view over a DB column / external metrics source.
	 */
	lastInteractionNs?: Node<number>;

	/** Error classifier for fast-retry path. */
	errorClassifier?: ErrorClassifier;

	/** Max fast-retries per item before routing to full intake (default 2). */
	maxRetries?: number;

	/** Global retry cap across all items — circuit breaker (default maxRetries × 10). */
	maxTotalRetries?: number;

	/** Max re-ingestions from verify→intake before giving up (default 1). */
	maxReingestions?: number;

	/** Global reingestion cap across all items — circuit breaker (default maxReingestions × 10). */
	maxTotalReingestions?: number;

	/** Retained limit for topic logs (default 1000). */
	retainedLimit?: number;

	/**
	 * Per-pump-tick claim cap on the internal `executeFlow` JobFlow's `execute`
	 * stage (Tier 6.5 C2). Default `Number.MAX_SAFE_INTEGER` — every pending
	 * claim is processed in one tick (matches today's unbounded `merge()`
	 * parallelism). Lower this to bound LLM cost spikes on bursty intake.
	 *
	 * **Caveat.** This caps **claims per pump tick**, not total concurrent
	 * inflight. Bounded-inflight is a separate primitive concern — see
	 * `docs/optimizations.md` "Tier 6.5 follow-up — bounded concurrent inflight
	 * on JobFlow stages".
	 */
	executeMaxPerPump?: number;

	/**
	 * Per-pump-tick claim cap on the internal `executeFlow` JobFlow's
	 * `verify` stage. Default `Number.MAX_SAFE_INTEGER`. Same caveat as
	 * {@link HarnessLoopOptions.executeMaxPerPump}. Honored independently
	 * of the execute cap via `StageDef.maxPerPump` (Tier 6.5 D1).
	 */
	verifyMaxPerPump?: number;
}

// ---------------------------------------------------------------------------
// Barrel re-exports from defaults.ts — preserves the pre-split import
// surface (`import { QUEUE_NAMES, defaultErrorClassifier } from ".../types"`).
// ---------------------------------------------------------------------------

export {
	DEFAULT_DECAY_RATE,
	DEFAULT_QUEUE_CONFIGS,
	DEFAULT_SEVERITY_WEIGHTS,
	defaultErrorClassifier,
	QUEUE_NAMES,
	strategyKey,
} from "./defaults.js";
