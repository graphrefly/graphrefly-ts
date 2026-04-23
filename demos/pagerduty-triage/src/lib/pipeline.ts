// ── PagerDuty triage pipeline ───────────────────────────────────
// A composition demo: the full causal chain is visible in describe().
//
// Architectural shape:
//
//   alertInput ──┐
//                ├──withLatestFrom──► classify ─► routingAction ─┐
//   patterns ────┘                                                │
//                                                                 │
//   userActionInput ─────────────────────────────► userAction ────┤
//   autoEscalateChan ─────────────────────────────────────────────┤ merge → allActions
//   deferExpireChan ──────────────────────────────────────────────┤
//                                                                 │
//                  ┌──────────────── scan → bins ─────────────────┤
//                  ├──────────────── scan → queue ────────────────┤
//                  ├──────────────── scan → auto-count ───────────┤
//                  ├──────────────── scan → decision-log ─────────┤
//                  └──────────────── effect → timer-lifecycle ────┘
//
//   obsAdapter.stats.{totalInputTokens, totalOutputTokens, totalCalls}
//        └──combine──► tokens                       (classify → adapter → tokens)
//
//   decision-log ──► agentMemory ──► memory.compact ──► patterns
//         (the learning loop that feeds back into classify above)
//
// TWO imperative entry points — `pushAlert` and `recordDecision` /
// `retriageActionable` — because alerts and user clicks are genuinely
// external. Everything downstream is reactive; every edge in the diagram
// tells the user WHY a value changed.

import type { Node } from "@graphrefly/graphrefly/core";
import { derived, effect, state, wallClockNs } from "@graphrefly/graphrefly/core";
import { merge, scan, withLatestFrom } from "@graphrefly/graphrefly/extra/operators";
import { reactiveLog } from "@graphrefly/graphrefly/extra/reactive";
import { fromTimer, keepalive } from "@graphrefly/graphrefly/extra/sources";
import { Graph } from "@graphrefly/graphrefly/graph";
import type { LLMAdapter } from "@graphrefly/graphrefly/patterns/ai";
import { agentMemory, observableAdapter, promptNode } from "@graphrefly/graphrefly/patterns/ai";
import type { Alert } from "./alerts.js";
import type {
	ClassifyResult,
	Disposition,
	LearnedPattern,
	TokenSnapshot,
	TriagedAlert,
} from "./types.js";

// ── Prompts & helpers ───────────────────────────────────────────

const CLASSIFY_SYSTEM = `You are an on-call SRE triage assistant. Given a PagerDuty alert, classify it.
Respond with JSON only: {"alertId": "<echo the Alert ID from the prompt>", "disposition": "actionable"|"escalated"|"resolved"|"deferred", "confidence": 0.0-1.0, "brief": "one-line explanation"}
- "actionable": needs immediate human intervention
- "escalated": needs senior engineer / team lead attention
- "resolved": likely auto-resolved or known-safe, can be closed
- "deferred": not urgent, revisit later
Be conservative with confidence — if unsure, keep it below 0.6.`;

function classifyPrompt(alert: Alert, patterns: readonly LearnedPattern[]): string {
	let ctx = "";
	if (patterns.length > 0) {
		ctx = "\n\nKnown patterns from prior operator decisions:\n";
		for (const p of patterns) {
			ctx += `- "${p.patternKey}" → ${p.disposition} (${p.sampleCount} samples, ${Math.round(p.confidence * 100)}% confident)\n`;
		}
		ctx +=
			"\nUse these to inform your confidence. If an alert clearly matches a known pattern, set confidence high.";
	}
	return `Alert ID: ${alert.id}\nClassify this PagerDuty alert:\nService: ${alert.service}\nSeverity: ${alert.severity}\nSummary: ${alert.summary}${ctx}`;
}

function matchesPattern(alert: Alert, pattern: LearnedPattern): boolean {
	const m = pattern.match;
	if (m.service) {
		const services = Array.isArray(m.service) ? m.service : [m.service];
		const svcMatch = services.some((s) => {
			if (s.endsWith("*")) return alert.service.startsWith(s.slice(0, -1));
			return alert.service === s;
		});
		if (!svcMatch) return false;
	}
	if (m.severityRange && m.severityRange.length > 0) {
		if (!m.severityRange.includes(alert.severity)) return false;
	}
	if (m.errorCategory) {
		const cat = m.errorCategory.toLowerCase().replace(/-/g, " ");
		const sum = alert.summary.toLowerCase().replace(/-/g, " ");
		const keywords = cat.split(/\s+/).filter((kw) => kw.length > 2);
		if (keywords.length > 0) {
			const matched = keywords.filter((kw) => sum.includes(kw));
			if (matched.length < Math.ceil(keywords.length * 0.7)) return false;
		}
	}
	return true;
}

function findMatchingPattern(
	alert: Alert,
	patterns: readonly LearnedPattern[],
): LearnedPattern | null {
	for (const p of patterns) {
		if (p.confidence >= 0.7 && matchesPattern(alert, p)) return p;
	}
	return null;
}

// Spec §5.11: timestamps go through the central clock. `wallClockNs()`
// gives wall-clock nanoseconds; /1e6 = ms for display.
function wallClockMs(): number {
	return Math.floor(wallClockNs() / 1e6);
}

// ── Public types ────────────────────────────────────────────────

/** Milliseconds a low-confidence alert sits in the user queue before the
 *  pipeline auto-escalates it (simulates pager fatigue / SLA breach). */
export const AUTO_ESCALATE_AFTER_MS = 45_000;

export interface TriagePipelineOptions {
	adapter: LLMAdapter;
	mode: "baseline" | "graphrefly";
}

export interface QueuedAlert {
	readonly alert: Alert;
	readonly brief: string;
	readonly confidence: number;
}

export interface TriageBins {
	readonly actionable: readonly TriagedAlert[];
	readonly escalated: readonly TriagedAlert[];
	readonly resolved: readonly TriagedAlert[];
	readonly deferred: readonly DeferredAlert[];
}

export interface DeferredAlert extends TriagedAlert {
	readonly retryAt: number;
}

export interface TriagePipeline {
	readonly graph: Graph;
	readonly pushAlert: (alert: Alert) => void;
	readonly recordDecision: (alertId: string, disposition: Disposition, deferMs?: number) => void;
	readonly retriageActionable: (
		alertId: string,
		disposition: Disposition,
		deferMs?: number,
	) => void;
	readonly userQueue: Node<readonly QueuedAlert[]>;
	readonly bins: Node<TriageBins>;
	readonly tokens: Node<TokenSnapshot>;
	readonly patterns: Node<readonly LearnedPattern[]>;
	readonly autoCount: Node<number>;
	readonly destroy: () => void;
}

// ── Internal action types (the one message currency) ───────────

type TriageAction =
	| { readonly k: "classify-pattern-match"; readonly triaged: TriagedAlert }
	| { readonly k: "classify-high-conf"; readonly triaged: TriagedAlert }
	| { readonly k: "classify-low-conf"; readonly entry: QueuedAlert }
	| {
			readonly k: "user-decision";
			readonly entry: QueuedAlert;
			readonly triaged: TriagedAlert;
	  }
	| {
			readonly k: "user-retriage-actionable";
			readonly oldAlertId: string;
			readonly newTriaged: TriagedAlert;
	  }
	| { readonly k: "auto-escalate"; readonly triaged: TriagedAlert }
	| {
			readonly k: "defer-expired";
			readonly alertId: string;
			readonly reQueued: QueuedAlert;
	  };

const EMPTY_BINS: TriageBins = {
	actionable: [],
	escalated: [],
	resolved: [],
	deferred: [],
};
const EMPTY_QUEUE: readonly QueuedAlert[] = [];

// ── Pure reducers (scan bodies) ─────────────────────────────────

function addTriagedToBins(prev: TriageBins, triaged: TriagedAlert): TriageBins {
	if (triaged.disposition === "deferred") {
		const delayMs = triaged.deferMs ?? 30_000;
		const deferred: DeferredAlert = { ...triaged, retryAt: wallClockMs() + delayMs };
		return { ...prev, deferred: [...prev.deferred, deferred] };
	}
	return {
		...prev,
		[triaged.disposition]: [...prev[triaged.disposition], triaged],
	};
}

function reduceBins(prev: TriageBins, a: TriageAction): TriageBins {
	switch (a.k) {
		case "classify-pattern-match":
		case "classify-high-conf":
		case "user-decision":
		case "auto-escalate":
			return addTriagedToBins(prev, a.triaged);
		case "user-retriage-actionable": {
			const cleaned: TriageBins = {
				...prev,
				actionable: prev.actionable.filter((t) => t.alert.id !== a.oldAlertId),
			};
			return addTriagedToBins(cleaned, a.newTriaged);
		}
		case "defer-expired":
			return { ...prev, deferred: prev.deferred.filter((d) => d.alert.id !== a.alertId) };
		default:
			return prev;
	}
}

function reduceQueue(prev: readonly QueuedAlert[], a: TriageAction): readonly QueuedAlert[] {
	switch (a.k) {
		case "classify-low-conf":
			return [...prev, a.entry];
		case "user-decision":
			return prev.filter((q) => q.alert.id !== a.entry.alert.id);
		case "auto-escalate":
			return prev.filter((q) => q.alert.id !== a.triaged.alert.id);
		case "defer-expired":
			return [...prev, a.reQueued];
		default:
			return prev;
	}
}

function reduceAutoCount(prev: number, a: TriageAction): number {
	return a.k === "classify-pattern-match" ? prev + 1 : prev;
}

// ── Factory ─────────────────────────────────────────────────────

export function createTriagePipeline(opts: TriagePipelineOptions): TriagePipeline {
	const { adapter: rawAdapter, mode } = opts;
	const graph = new Graph(`triage-${mode}`);

	// ── Observable adapter (library primitive) ──────────────────
	// Token accounting is built into the library; we just subscribe to it.
	const { adapter, stats } = observableAdapter(rawAdapter, { name: "llm" });

	// ── Imperative entry points (the only two in the whole pipeline) ─
	const alertInput = state<Alert | null>(null, { name: "alerts/input" });
	const userActionInput = state<TriageAction | null>(null, {
		name: "user-action/input",
	});
	graph.add(alertInput, { name: "alerts/input" });
	graph.add(userActionInput, { name: "user-action/input" });

	// Per-alert timer fan-in channels. Effects that fire on timer DATA
	// emit actions here; `merge` below combines them with classify/user
	// streams into a single action stream.
	const autoEscalateChan = state<TriageAction | null>(null, {
		name: "auto-escalate/chan",
	});
	const deferExpireChan = state<TriageAction | null>(null, {
		name: "defer-expire/chan",
	});
	graph.add(autoEscalateChan, { name: "auto-escalate/chan" });
	graph.add(deferExpireChan, { name: "defer-expire/chan" });

	// ── Decision log (reactive list of user decisions) ──────────
	// agentMemory consumes the .node view below. Appends happen inside
	// the logDecisionEffect once a user-decision action materializes.
	const decisionLog = reactiveLog<{
		alert: Alert;
		disposition: Disposition;
		deferMs?: number;
	}>(undefined, { name: "decisions/log", maxSize: 200 });
	graph.add(decisionLog.entries, { name: "decisions/log" });

	// ── Pattern learning (graphrefly mode) ──────────────────────
	// Visible edge: decisions/log → agentMemory internals → memory.compact →
	// patterns/learned. In baseline mode, patterns is a derived([]) that never
	// emits — so no learning loop appears in the graph.
	let patternsNode: Node<readonly LearnedPattern[]>;
	let memoryKeepalive: (() => void) | null = null;

	if (mode === "graphrefly") {
		const memory = agentMemory<LearnedPattern>("triage-patterns", decisionLog.entries, {
			extractFn: (raw) => {
				const decisions = raw as readonly {
					alert: Alert;
					disposition: Disposition;
					deferMs?: number;
				}[];
				if (!decisions || decisions.length === 0) return { upsert: [] };
				const groups = new Map<
					string,
					{ alerts: Alert[]; disposition: Disposition; deferMs?: number }
				>();
				for (const d of decisions) {
					const cat = extractErrorCategory(d.alert.summary);
					const key = `${d.alert.service}::${cat}`;
					const g = groups.get(key);
					if (g) {
						g.alerts.push(d.alert);
						groups.set(key, { ...g, disposition: d.disposition, deferMs: d.deferMs });
					} else {
						groups.set(key, {
							alerts: [d.alert],
							disposition: d.disposition,
							deferMs: d.deferMs,
						});
					}
				}
				const upsert: { key: string; value: LearnedPattern }[] = [];
				for (const [key, g] of groups) {
					if (g.alerts.length < 2) continue;
					const sep = key.indexOf("::");
					const service = key.slice(0, sep);
					const errorCategory = key.slice(sep + 2);
					const sevs = [...new Set(g.alerts.map((a) => a.severity))];
					upsert.push({
						key,
						value: {
							patternKey: `${errorCategory} on ${service}`,
							match: { service, severityRange: sevs, errorCategory },
							disposition: g.disposition,
							deferMs: g.deferMs,
							sampleCount: g.alerts.length,
							confidence: Math.min(0.95, 0.5 + g.alerts.length * 0.15),
						},
					});
				}
				return { upsert };
			},
			score: (m) => m.sampleCount * m.confidence,
			cost: (m) => 50 + m.patternKey.length,
			budget: 4000,
		});
		patternsNode = derived<readonly LearnedPattern[]>(
			[memory.compact],
			([compact]) => {
				if (!compact) return [];
				const entries = compact as readonly { key: string; value: LearnedPattern }[];
				return entries.map((e) => e.value);
			},
			{ name: "patterns/learned" },
		);
		graph.add(patternsNode, { name: "patterns/learned" });
		// Keep patterns live so agentMemory runs even before classify subscribes.
		memoryKeepalive = keepalive(patternsNode);
	} else {
		// Baseline: empty patterns, no learning.
		const emptyState = state<readonly LearnedPattern[]>([], { name: "patterns/learned" });
		patternsNode = emptyState;
		graph.add(emptyState, { name: "patterns/learned" });
	}

	// ── Classify (promptNode with withLatestFrom snapshot) ──────
	// `withLatestFrom(alert, patterns)` emits [alert, patterns] ONLY when
	// alert changes — patterns updates don't re-invoke the LLM on an alert
	// that's already been decided. This breaks the feedback cycle
	// (patterns → classify → decisions → patterns) cleanly and keeps the
	// learning loop as a FIRST-CLASS visible edge in describe().
	const alertWithPatterns = withLatestFrom(alertInput, patternsNode, {
		name: "alert+patterns",
	});
	graph.add(alertWithPatterns, { name: "alert+patterns" });

	const classify = promptNode<ClassifyResult>(
		adapter,
		[alertWithPatterns],
		(pair) => {
			if (!pair) return "";
			const [alert, patterns] = pair as [Alert | null, readonly LearnedPattern[] | null];
			if (!alert) return "";
			return classifyPrompt(alert, patterns ?? []);
		},
		{
			name: "classify",
			format: "json",
			systemPrompt: CLASSIFY_SYSTEM,
			retries: 1,
		},
	);
	graph.add(classify, { name: "classify" });

	// ── Routing decision: classify result → TriageAction ────────
	// Reads `patternsNode.cache` for a cold snapshot of patterns at the
	// moment of routing (pattern-match gate). Declaring patternsNode as a
	// dep here would re-fire on pattern updates; `withLatestFrom` above
	// is the reactive snapshot, this is the application-time peek that
	// mirrors it for the pattern-match check.
	const routingAction = derived<TriageAction | null>(
		[classify],
		([result]) => {
			if (!result) return null;
			const cls = result as ClassifyResult;
			// Recover the originating alert: alertInput's current cache is the
			// last-pushed alert. classify fires synchronously on that input, so
			// this is always the correct one at decision time.
			const alert = alertInput.cache as Alert | null;
			if (!alert || alert.id !== cls.alertId) return null;
			if (mode === "graphrefly") {
				const pats = (patternsNode.cache as readonly LearnedPattern[] | undefined) ?? [];
				const match = findMatchingPattern(alert, pats);
				if (match) {
					return {
						k: "classify-pattern-match",
						triaged: {
							alert,
							disposition: match.disposition,
							deferMs: match.deferMs,
							brief: `Auto: matches pattern "${match.patternKey}"`,
							confidence: match.confidence,
							autoClassified: true,
							reason: "pattern",
							triagedAt: wallClockMs(),
						},
					};
				}
			}
			if (cls.confidence >= 0.8) {
				return {
					k: "classify-high-conf",
					triaged: {
						alert,
						disposition: cls.disposition,
						brief: cls.brief,
						confidence: cls.confidence,
						autoClassified: false,
						reason: "high-conf",
						triagedAt: wallClockMs(),
					},
				};
			}
			return {
				k: "classify-low-conf",
				entry: { alert, brief: cls.brief, confidence: cls.confidence },
			};
		},
		{ name: "routing-action" },
	);
	graph.add(routingAction, { name: "routing-action" });

	// ── Merge all action sources ────────────────────────────────
	const allActions = merge(routingAction, userActionInput, autoEscalateChan, deferExpireChan);
	graph.add(allActions, { name: "all-actions" });

	// ── Scan → bins / queue / auto-count ────────────────────────
	// Every event that mutates bins/queue/auto-count flows through
	// allActions → these scans. The edges are all declared, all visible.
	const bins = scan<TriageAction, TriageBins>(
		allActions,
		(prev, a) => (a == null ? prev : reduceBins(prev, a)),
		EMPTY_BINS,
		{ name: "bins" },
	);
	const userQueue = scan<TriageAction, readonly QueuedAlert[]>(
		allActions,
		(prev, a) => (a == null ? prev : reduceQueue(prev, a)),
		EMPTY_QUEUE,
		{ name: "queue/user" },
	);
	const autoCount = scan<TriageAction, number>(
		allActions,
		(prev, a) => (a == null ? prev : reduceAutoCount(prev, a)),
		0,
		{ name: "auto-count" },
	);
	graph.add(bins, { name: "bins" });
	graph.add(userQueue, { name: "queue/user" });
	graph.add(autoCount, { name: "auto-count" });

	// ── Tokens: derived directly from observableAdapter.stats ───
	// This is THE key library-primitive showcase: tokens isn't a thing we
	// maintain; it's a reactive view over adapter stats + the auto-count
	// (which doubles as "local cache hits" since pattern-match == zero-LLM).
	// Edges visible: adapter.stats.totalInputTokens → tokens, etc.
	const tokens = derived<TokenSnapshot>(
		[stats.totalInputTokens, stats.totalOutputTokens, stats.totalCalls, autoCount],
		([input, output, calls, cacheHits]) => ({
			inputTokens: (input as number | undefined) ?? 0,
			outputTokens: (output as number | undefined) ?? 0,
			cacheReadTokens: 0,
			localCacheHits: (cacheHits as number | undefined) ?? 0,
			calls: (calls as number | undefined) ?? 0,
		}),
		{ name: "tokens" },
	);
	graph.add(tokens, { name: "tokens" });

	// ── Effect: log user decisions into decisions/log ───────────
	// decision-log / agentMemory is the learning loop. Visible in the graph:
	// all-actions → log-decision-effect → decisions/log → memory → patterns.
	const logDecisionEffect = effect(
		[allActions],
		([a]) => {
			const action = a as TriageAction | null;
			if (!action) return;
			if (action.k === "user-decision") {
				decisionLog.append({
					alert: action.entry.alert,
					disposition: action.triaged.disposition,
					deferMs: action.triaged.deferMs,
				});
			} else if (action.k === "user-retriage-actionable") {
				decisionLog.append({
					alert: action.newTriaged.alert,
					disposition: action.newTriaged.disposition,
					deferMs: action.newTriaged.deferMs,
				});
			}
		},
		{ name: "log-decision-effect" },
	);
	graph.add(logDecisionEffect, { name: "log-decision-effect" });
	const logDecisionKeepalive = keepalive(logDecisionEffect);

	// ── Effect: per-alert timer lifecycle ───────────────────────
	// On classify-low-conf: spawn auto-escalate timer.
	// On user-decision: cancel auto-escalate + maybe spawn defer timer.
	// On user-retriage-actionable (→ deferred): spawn defer timer.
	// On defer-expired: spawn auto-escalate for re-queued alert.
	const queueEscalateDisposers = new Map<string, () => void>();
	const deferDisposers = new Map<string, () => void>();

	function startAutoEscalateTimer(entry: QueuedAlert): void {
		const timerSrc = fromTimer(AUTO_ESCALATE_AFTER_MS);
		graph.add(timerSrc, { name: `escalate-timer/${entry.alert.id}` });
		const onTick = effect(
			[timerSrc],
			([tick]) => {
				if (tick == null) return; // first-run sentinel
				queueEscalateDisposers.delete(entry.alert.id);
				// Re-emit into the auto-escalate channel; scans pick it up like
				// any other action. If the alert has already been handled, the
				// queue reducer is a no-op (filter returns same ref).
				const queueNow = (userQueue.cache as readonly QueuedAlert[] | undefined) ?? [];
				if (!queueNow.some((q) => q.alert.id === entry.alert.id)) return;
				autoEscalateChan.emit({
					k: "auto-escalate",
					triaged: {
						alert: entry.alert,
						disposition: "escalated",
						brief: `[Auto-escalated after ${Math.round(AUTO_ESCALATE_AFTER_MS / 1000)}s] ${entry.brief}`,
						confidence: entry.confidence,
						autoClassified: false,
						reason: "timeout",
						triagedAt: wallClockMs(),
					},
				});
			},
			{ name: `escalate-effect/${entry.alert.id}` },
		);
		graph.add(onTick, { name: `escalate-effect/${entry.alert.id}` });
		queueEscalateDisposers.set(entry.alert.id, keepalive(onTick));
	}

	function cancelAutoEscalateTimer(alertId: string): void {
		const dispose = queueEscalateDisposers.get(alertId);
		if (dispose) {
			dispose();
			queueEscalateDisposers.delete(alertId);
		}
	}

	function startDeferTimer(triaged: TriagedAlert): void {
		const delayMs = triaged.deferMs ?? 30_000;
		const timerSrc = fromTimer(delayMs);
		graph.add(timerSrc, { name: `defer-timer/${triaged.alert.id}` });
		const onTick = effect(
			[timerSrc],
			([tick]) => {
				if (tick == null) return;
				deferDisposers.delete(triaged.alert.id);
				deferExpireChan.emit({
					k: "defer-expired",
					alertId: triaged.alert.id,
					reQueued: {
						alert: triaged.alert,
						brief: `[Re-queued] ${triaged.brief}`,
						confidence: triaged.confidence,
					},
				});
			},
			{ name: `defer-effect/${triaged.alert.id}` },
		);
		graph.add(onTick, { name: `defer-effect/${triaged.alert.id}` });
		deferDisposers.set(triaged.alert.id, keepalive(onTick));
	}

	const timerLifecycle = effect(
		[allActions],
		([a]) => {
			const action = a as TriageAction | null;
			if (!action) return;
			switch (action.k) {
				case "classify-low-conf":
					startAutoEscalateTimer(action.entry);
					break;
				case "user-decision":
					cancelAutoEscalateTimer(action.entry.alert.id);
					if (action.triaged.disposition === "deferred") {
						startDeferTimer(action.triaged);
					}
					break;
				case "user-retriage-actionable":
					if (action.newTriaged.disposition === "deferred") {
						startDeferTimer(action.newTriaged);
					}
					break;
				case "defer-expired":
					// Re-queued alert accrues a fresh auto-escalate.
					startAutoEscalateTimer(action.reQueued);
					break;
			}
		},
		{ name: "timer-lifecycle" },
	);
	graph.add(timerLifecycle, { name: "timer-lifecycle" });
	const timerLifecycleKeepalive = keepalive(timerLifecycle);

	// ── Public API (imperative entry points) ────────────────────

	function pushAlert(alert: Alert): void {
		alertInput.emit({ ...alert, timestamp: wallClockMs() });
	}

	function recordDecision(alertId: string, disposition: Disposition, deferMs?: number): void {
		const queueNow = (userQueue.cache as readonly QueuedAlert[] | undefined) ?? [];
		const entry = queueNow.find((q) => q.alert.id === alertId);
		if (!entry) return;
		userActionInput.emit({
			k: "user-decision",
			entry,
			triaged: {
				alert: entry.alert,
				disposition,
				deferMs,
				brief: entry.brief,
				confidence: entry.confidence,
				autoClassified: false,
				reason: "manual",
				triagedAt: wallClockMs(),
			},
		});
	}

	function retriageActionable(alertId: string, disposition: Disposition, deferMs?: number): void {
		if (disposition === "actionable") return;
		const binsNow = bins.cache as TriageBins | undefined;
		if (!binsNow) return;
		const triaged = binsNow.actionable.find((t) => t.alert.id === alertId);
		if (!triaged) return;
		userActionInput.emit({
			k: "user-retriage-actionable",
			oldAlertId: alertId,
			newTriaged: {
				alert: triaged.alert,
				disposition,
				deferMs,
				brief: triaged.brief,
				confidence: triaged.confidence,
				autoClassified: false,
				reason: "manual",
				triagedAt: wallClockMs(),
			},
		});
	}

	return {
		graph,
		pushAlert,
		recordDecision,
		retriageActionable,
		userQueue,
		bins,
		tokens,
		patterns: patternsNode,
		autoCount,
		destroy() {
			for (const unsub of queueEscalateDisposers.values()) unsub();
			queueEscalateDisposers.clear();
			for (const unsub of deferDisposers.values()) unsub();
			deferDisposers.clear();
			timerLifecycleKeepalive();
			logDecisionKeepalive();
			if (memoryKeepalive) memoryKeepalive();
		},
	};
}

// ── Helpers ─────────────────────────────────────────────────────

function extractErrorCategory(summary: string): string {
	const stripped = summary.replace(/^\[.*?\]\s*/, "").toLowerCase();
	if (stripped.includes("connection timeout")) return "connection-timeout";
	if (stripped.includes("connection refused")) return "connection-refused";
	if (stripped.includes("5xx") || stripped.includes("error rate")) return "error-rate-spike";
	if (stripped.includes("disk usage") || stripped.includes("disk")) return "disk-pressure";
	if (stripped.includes("memory usage") || stripped.includes("memory")) return "memory-pressure";
	if (stripped.includes("cpu")) return "cpu-pressure";
	if (stripped.includes("latency") || stripped.includes("p99")) return "latency-spike";
	if (stripped.includes("ssl") || stripped.includes("certificate")) return "certificate-expiry";
	if (stripped.includes("health check")) return "health-check-failure";
	if (stripped.includes("queue depth")) return "queue-backlog";
	if (stripped.includes("crashloop") || stripped.includes("restart")) return "pod-crash-loop";
	if (stripped.includes("dns")) return "dns-failure";
	if (stripped.includes("rate limit") || stripped.includes("429")) return "rate-limiting";
	if (stripped.includes("rollback") || stripped.includes("deployment")) return "deployment-issue";
	if (stripped.includes("log") || stripped.includes("ingestion")) return "log-pipeline-stall";
	return "unknown";
}
