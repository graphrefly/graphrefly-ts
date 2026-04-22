// ── PagerDuty triage pipeline ───────────────────────────────────
// Wires the reactive graph: alert → classify → pattern match → bins.
// Two modes: Baseline (no learning) and GraphReFly (agentMemory learning).

import type { Node } from "@graphrefly/graphrefly/core";
import { batch, effect, state } from "@graphrefly/graphrefly/core";
import { fromTimer } from "@graphrefly/graphrefly/extra";
import { Graph } from "@graphrefly/graphrefly/graph";
import type { LLMAdapter } from "@graphrefly/graphrefly/patterns/ai";
import { agentMemory, promptNode } from "@graphrefly/graphrefly/patterns/ai";
import type { Alert } from "./alerts.js";
import type {
	ClassifyResult,
	Disposition,
	LearnedPattern,
	TokenSnapshot,
	TriagedAlert,
} from "./types.js";

// ── Prompts ─────────────────────────────────────────────────────

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

// ── Pattern matcher (programmatic, Option 5) ────────────────────

function matchesPattern(alert: Alert, pattern: LearnedPattern): boolean {
	const m = pattern.match;
	// Service match
	if (m.service) {
		const services = Array.isArray(m.service) ? m.service : [m.service];
		const svcMatch = services.some((s) => {
			if (s.endsWith("*")) return alert.service.startsWith(s.slice(0, -1));
			return alert.service === s;
		});
		if (!svcMatch) return false;
	}
	// Severity match
	if (m.severityRange && m.severityRange.length > 0) {
		if (!m.severityRange.includes(alert.severity)) return false;
	}
	// Error category: fuzzy keyword check on summary (≥70% keywords must match)
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

// ── Pipeline factory ────────────────────────────────────────────

export interface TriagePipelineOptions {
	adapter: LLMAdapter;
	/** "baseline" = no learning; "graphrefly" = agentMemory learning */
	mode: "baseline" | "graphrefly";
}

export interface TriagePipeline {
	readonly graph: Graph;
	/** Push a new alert into the pipeline. */
	readonly pushAlert: (alert: Alert) => void;
	/** Record a user decision. */
	readonly recordDecision: (alertId: string, disposition: Disposition, deferMs?: number) => void;
	// ── Observable nodes ─────────────────────────────────────────
	/** Alerts waiting for user decision. */
	readonly userQueue: Node<readonly QueuedAlert[]>;
	/** Bins: accumulated triaged alerts by disposition. */
	readonly bins: Node<TriageBins>;
	/** Token accounting snapshot. */
	readonly tokens: Node<TokenSnapshot>;
	/** Learned patterns (empty in baseline mode). */
	readonly patterns: Node<readonly LearnedPattern[]>;
	/** Count of alerts auto-classified by learned patterns. */
	readonly autoCount: Node<number>;
	/** Cleanup. */
	readonly destroy: () => void;
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

// ── Build pipeline ──────────────────────────────────────────────

export function createTriagePipeline(opts: TriagePipelineOptions): TriagePipeline {
	const { adapter, mode } = opts;
	const graph = new Graph(`triage-${mode}`);

	// ── State nodes ─────────────────────────────────────────────
	const currentAlert = state<Alert | null>(null, { name: "alert/current" });
	const userQueueState = state<readonly QueuedAlert[]>([], { name: "queue/user" });
	const binsState = state<TriageBins>(
		{ actionable: [], escalated: [], resolved: [], deferred: [] },
		{ name: "bins" },
	);
	const tokenState = state<TokenSnapshot>(
		{ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, localCacheHits: 0, calls: 0 },
		{ name: "tokens" },
	);
	const patternsState = state<readonly LearnedPattern[]>([], { name: "patterns/learned" });
	const autoCountState = state<number>(0, { name: "auto-count" });

	// Decision log for agentMemory extraction
	const decisionLog = state<
		readonly { alert: Alert; disposition: Disposition; deferMs?: number }[]
	>([], { name: "decisions/log" });

	// Register nodes in graph
	graph.add(currentAlert, { name: "alert/current" });
	graph.add(userQueueState, { name: "queue/user" });
	graph.add(binsState, { name: "bins" });
	graph.add(tokenState, { name: "tokens" });
	graph.add(patternsState, { name: "patterns/learned" });
	graph.add(autoCountState, { name: "auto-count" });
	graph.add(decisionLog, { name: "decisions/log" });

	// ── Closure accumulators (avoid cache-peek violations) ───────
	// These are the ground-truth values; emitted to state nodes for UI.
	let tokenAccum: TokenSnapshot = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		localCacheHits: 0,
		calls: 0,
	};
	let autoAccum = 0;

	// ── In-flight alert registry ─────────────────────────────────
	// Maps alertId → Alert so routeEffect can look up the alert for a
	// given classification result without depending on currentAlert.
	// This breaks the diamond: routeEffect no longer needs currentAlert as dep.
	const pendingAlerts = new Map<string, Alert>();

	// ── Deferred timer registry ──────────────────────────────────
	// Maps alertId → unsub fn for the fromTimer source node.
	// Calling unsub deactivates the producer (cancels the internal setTimeout).
	const deferredUnsubs = new Map<string, () => void>();

	// ── Classification node ─────────────────────────────────────
	// Only depends on currentAlert (not patternsState) so that pattern updates
	// do NOT re-invoke the LLM on the current alert (breaks G1-B feedback cycle).
	// Patterns are read as a snapshot inside the callback.
	const classifyNode = promptNode<ClassifyResult>(
		adapter,
		[currentAlert],
		(alert) => {
			// Return "" (falsy) to skip LLM invocation when no alert is present.
			if (!alert) return "";
			// Snapshot current patterns — cold read, won't re-trigger classify.
			const patterns = (patternsState.cache as readonly LearnedPattern[]) ?? [];
			return classifyPrompt(alert as Alert, patterns);
		},
		{
			name: "classify",
			format: "json",
			systemPrompt: CLASSIFY_SYSTEM,
			retries: 1,
		},
	);
	graph.add(classifyNode, { name: "classify" });

	// ── Classification effect ───────────────────────────────────
	// Only depends on classifyNode — no currentAlert dep (no diamond),
	// no patternsState dep (no feedback cycle).
	// The alert is retrieved by alertId from pendingAlerts.
	const routeEffect = effect(
		[classifyNode],
		(result) => {
			if (!result) return;
			const cls = result as ClassifyResult;

			// Staleness guard: if the alert is no longer pending (processed or stale
			// result from a cancelled in-flight request), skip silently.
			const a = pendingAlerts.get(cls.alertId);
			if (!a) return;
			pendingAlerts.delete(cls.alertId);

			// Snapshot current patterns — cold read at routing time.
			const pats = (patternsState.cache as readonly LearnedPattern[]) ?? [];

			// In GraphReFly mode, check pattern map first (zero LLM cost).
			if (mode === "graphrefly") {
				const match = findMatchingPattern(a, pats);
				if (match) {
					const triaged: TriagedAlert = {
						alert: a,
						disposition: match.disposition,
						deferMs: match.deferMs,
						brief: `Auto: matches pattern "${match.patternKey}"`,
						confidence: match.confidence,
						autoClassified: true,
						triagedAt: Date.now(),
					};
					addToBin(triaged);
					autoAccum += 1;
					autoCountState.emit(autoAccum);
					// Credit local cache hit — no real LLM call was made.
					batch(() => {
						tokenAccum = { ...tokenAccum, localCacheHits: tokenAccum.localCacheHits + 1 };
						tokenState.emit(tokenAccum);
					});
					return;
				}
			}

			// Real LLM call completed — track token usage.
			batch(() => {
				tokenAccum = {
					...tokenAccum,
					// Rough estimates; real adapters report actual usage via response.usage.
					inputTokens: tokenAccum.inputTokens + 150,
					outputTokens: tokenAccum.outputTokens + 50,
					calls: tokenAccum.calls + 1,
				};
				tokenState.emit(tokenAccum);
			});

			// High confidence → auto-route.
			if (cls.confidence >= 0.8) {
				addToBin({
					alert: a,
					disposition: cls.disposition,
					brief: cls.brief,
					confidence: cls.confidence,
					autoClassified: false,
					triagedAt: Date.now(),
				});
				return;
			}

			// Low confidence → user queue.
			const queue = (userQueueState.cache as readonly QueuedAlert[]) ?? [];
			userQueueState.emit([...queue, { alert: a, brief: cls.brief, confidence: cls.confidence }]);
		},
		{ name: "route" },
	);
	graph.add(routeEffect, { name: "route" });

	// ── agentMemory (GraphReFly mode only) ──────────────────────
	if (mode === "graphrefly") {
		const memory = agentMemory<LearnedPattern>("triage-patterns", decisionLog, {
			extractFn: (raw, _existing) => {
				const decisions = raw as readonly {
					alert: Alert;
					disposition: Disposition;
					deferMs?: number;
				}[];
				if (!decisions || decisions.length === 0) return { upsert: [] };

				// Group decisions by (service, errorCategory)
				const groups = new Map<
					string,
					{ alerts: Alert[]; disposition: Disposition; deferMs?: number }
				>();
				for (const d of decisions) {
					const cat = extractErrorCategory(d.alert.summary);
					// Use indexOf to split on the first "::" only (key may contain "::" in values)
					const key = `${d.alert.service}::${cat}`;
					const group = groups.get(key);
					if (group) {
						group.alerts.push(d.alert);
						groups.set(key, { ...group, disposition: d.disposition, deferMs: d.deferMs });
					} else {
						groups.set(key, {
							alerts: [d.alert],
							disposition: d.disposition,
							deferMs: d.deferMs,
						});
					}
				}

				// Only emit patterns with 2+ samples
				const upsert: { key: string; value: LearnedPattern }[] = [];
				for (const [key, group] of groups) {
					if (group.alerts.length < 2) continue;
					const sep = key.indexOf("::");
					const service = key.slice(0, sep);
					const errorCategory = key.slice(sep + 2);
					const sevs = [...new Set(group.alerts.map((a) => a.severity))];
					upsert.push({
						key,
						value: {
							patternKey: `${errorCategory} on ${service}`,
							match: {
								service,
								severityRange: sevs,
								errorCategory,
							},
							disposition: group.disposition,
							deferMs: group.deferMs,
							sampleCount: group.alerts.length,
							confidence: Math.min(0.95, 0.5 + group.alerts.length * 0.15),
						},
					});
				}
				return { upsert };
			},
			score: (mem) => mem.sampleCount * mem.confidence,
			cost: (mem) => 50 + mem.patternKey.length,
			budget: 4000,
		});

		// When memory patterns update, sync to patternsState.
		// classifyNode does NOT depend on patternsState, so this does not
		// create a feedback cycle (patternsState → classify → patternsState).
		const patternSync = effect(
			[memory.compact],
			(compact) => {
				if (!compact) return;
				const entries = compact as readonly { key: string; value: LearnedPattern }[];
				patternsState.emit(entries.map((e) => e.value));
			},
			{ name: "pattern-sync" },
		);
		graph.add(patternSync, { name: "pattern-sync" });
	}

	// ── Bin management ──────────────────────────────────────────

	function addToBin(triaged: TriagedAlert): void {
		const bins = binsState.cache as TriageBins;
		if (triaged.disposition === "deferred") {
			const delayMs = triaged.deferMs ?? 30_000;
			const deferred: DeferredAlert = {
				...triaged,
				retryAt: Date.now() + delayMs,
			};
			binsState.emit({ ...bins, deferred: [...bins.deferred, deferred] });

			// Use fromTimer (reactive source) instead of raw setTimeout.
			// Subscribing activates the producer; unsubscribing cancels the timer.
			const timerSrc = fromTimer(delayMs);
			graph.add(timerSrc, { name: `defer-timer/${triaged.alert.id}` });
			const unsub = timerSrc.subscribe(() => {
				deferredUnsubs.delete(triaged.alert.id);
				const currentBins = binsState.cache as TriageBins;
				binsState.emit({
					...currentBins,
					deferred: currentBins.deferred.filter((d) => d.alert.id !== triaged.alert.id),
				});
				const queue = (userQueueState.cache as readonly QueuedAlert[]) ?? [];
				userQueueState.emit([
					...queue,
					{
						alert: triaged.alert,
						brief: `[Re-queued] ${triaged.brief}`,
						confidence: triaged.confidence,
					},
				]);
			});
			deferredUnsubs.set(triaged.alert.id, unsub);
		} else {
			binsState.emit({
				...bins,
				[triaged.disposition]: [...bins[triaged.disposition], triaged],
			});
		}
	}

	// ── Public API ──────────────────────────────────────────────

	function pushAlert(alert: Alert): void {
		const stamped = { ...alert, timestamp: Date.now() };
		// Register in pendingAlerts before emitting so routeEffect can look it up.
		pendingAlerts.set(alert.id, stamped);
		currentAlert.emit(stamped);
	}

	function recordDecision(alertId: string, disposition: Disposition, deferMs?: number): void {
		const queue = (userQueueState.cache as readonly QueuedAlert[]) ?? [];
		const entry = queue.find((q) => q.alert.id === alertId);
		if (!entry) return;

		userQueueState.emit(queue.filter((q) => q.alert.id !== alertId));

		addToBin({
			alert: entry.alert,
			disposition,
			deferMs,
			brief: entry.brief,
			confidence: entry.confidence,
			autoClassified: false,
			triagedAt: Date.now(),
		});

		// Log decision for agentMemory (GraphReFly mode)
		if (mode === "graphrefly") {
			const log =
				(decisionLog.cache as readonly {
					alert: Alert;
					disposition: Disposition;
					deferMs?: number;
				}[]) ?? [];
			decisionLog.emit([...log, { alert: entry.alert, disposition, deferMs }]);
		}
	}

	return {
		graph,
		pushAlert,
		recordDecision,
		userQueue: userQueueState,
		bins: binsState,
		tokens: tokenState,
		patterns: patternsState,
		autoCount: autoCountState,
		destroy() {
			for (const unsub of deferredUnsubs.values()) unsub();
			deferredUnsubs.clear();
			pendingAlerts.clear();
		},
	};
}

// ── Helpers ─────────────────────────────────────────────────────

function extractErrorCategory(summary: string): string {
	// Strip service prefix: "[service-name] actual error"
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
