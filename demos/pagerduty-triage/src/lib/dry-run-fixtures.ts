// ── Dry-run fixtures ────────────────────────────────────────────
// Deterministic mock responses for the triage demo's dry-run mode.
// Uses dryRunAdapter with a respond function that returns plausible
// classification results based on keyword matching.

import type { ChatMessage, LLMAdapter } from "@graphrefly/graphrefly/patterns/ai";
import { dryRunAdapter } from "@graphrefly/graphrefly/patterns/ai";

const SEVERITY_DISPOSITION: Record<string, { disposition: string; confidence: number }> = {
	critical: { disposition: "actionable", confidence: 0.85 },
	high: { disposition: "actionable", confidence: 0.65 },
	warning: { disposition: "deferred", confidence: 0.55 },
	low: { disposition: "resolved", confidence: 0.7 },
	info: { disposition: "resolved", confidence: 0.8 },
};

const KEYWORD_RULES: readonly {
	keywords: readonly string[];
	disposition: string;
	confidence: number;
	brief: string;
}[] = [
	{
		keywords: ["connection timeout", "connection refused"],
		disposition: "actionable",
		confidence: 0.75,
		brief: "Connection failure — likely needs restart or investigation",
	},
	{
		keywords: ["5xx", "error rate"],
		disposition: "escalated",
		confidence: 0.8,
		brief: "Error rate spike — may indicate systemic issue",
	},
	{
		keywords: ["disk usage", "disk"],
		disposition: "actionable",
		confidence: 0.7,
		brief: "Disk pressure — may need cleanup or volume expansion",
	},
	{
		keywords: ["memory usage"],
		disposition: "actionable",
		confidence: 0.65,
		brief: "Memory pressure — check for leaks or scale up",
	},
	{
		keywords: ["cpu"],
		disposition: "deferred",
		confidence: 0.55,
		brief: "CPU spike — often transient, monitor for recurrence",
	},
	{
		keywords: ["ssl", "certificate"],
		disposition: "deferred",
		confidence: 0.6,
		brief: "Certificate approaching expiry — schedule renewal",
	},
	{
		keywords: ["health check"],
		disposition: "actionable",
		confidence: 0.7,
		brief: "Health check failures — partial outage possible",
	},
	{
		keywords: ["queue depth"],
		disposition: "deferred",
		confidence: 0.5,
		brief: "Queue backlog — may self-resolve, monitor",
	},
	{
		keywords: ["crashloop", "restart loop"],
		disposition: "escalated",
		confidence: 0.85,
		brief: "Pod crash loop — needs immediate attention",
	},
	{
		keywords: ["dns"],
		disposition: "escalated",
		confidence: 0.8,
		brief: "DNS resolution failure — broad impact likely",
	},
	{
		keywords: ["rate limit", "429"],
		disposition: "resolved",
		confidence: 0.65,
		brief: "Rate limiter active — working as designed",
	},
	{
		keywords: ["rollback", "deployment"],
		disposition: "actionable",
		confidence: 0.7,
		brief: "Deployment rollback — check what changed",
	},
	{
		keywords: ["log", "ingestion", "pipeline"],
		disposition: "deferred",
		confidence: 0.5,
		brief: "Log pipeline stall — non-critical, check batch processor",
	},
];

function classifyFromKeywords(text: string): {
	disposition: string;
	confidence: number;
	brief: string;
} {
	const lower = text.toLowerCase();
	for (const rule of KEYWORD_RULES) {
		if (rule.keywords.some((kw) => lower.includes(kw))) {
			return { disposition: rule.disposition, confidence: rule.confidence, brief: rule.brief };
		}
	}
	// Fallback: use severity if mentioned
	for (const [sev, result] of Object.entries(SEVERITY_DISPOSITION)) {
		if (lower.includes(sev)) {
			return { ...result, brief: `${sev}-level alert — default triage` };
		}
	}
	return {
		disposition: "actionable",
		confidence: 0.4,
		brief: "Unknown pattern — needs manual review",
	};
}

export function createDryRunAdapter(): LLMAdapter {
	return dryRunAdapter({
		provider: "dry-run",
		model: "triage-mock",
		latencyMs: 200,
		respond: (messages: readonly ChatMessage[]) => {
			const userMsg = messages.find((m) => m.role === "user");
			if (!userMsg)
				return JSON.stringify({
					alertId: "",
					disposition: "actionable",
					confidence: 0.4,
					brief: "No input",
				});

			// Echo the Alert ID from the prompt — routeEffect uses it to look
			// up the in-flight alert; an undefined/missing alertId silently
			// skips via the staleness guard (pendingAlerts.get(undefined) → null).
			const alertIdMatch = userMsg.content.match(/Alert ID:\s*(\S+)/);
			const alertId = alertIdMatch?.[1] ?? "";

			const result = classifyFromKeywords(userMsg.content);
			return JSON.stringify({ alertId, ...result });
		},
		usage: () => ({
			input: { regular: 120 },
			output: { regular: 40 },
		}),
	});
}
