/**
 * Inbox-reducer pipeline — the core graph topology.
 *
 * **This is the file to copy if you want a reactive LLM pipeline.** Every
 * building block is shipped; all this file does is wire 7 named nodes
 * (3 LLM hops + 4 deterministic derivations) into one `Graph`.
 *
 * ```
 *   emails (state)
 *     │  promptNode — classify
 *     ▼
 *   classifications ─┐
 *     │              │
 *     ▼              │
 *   actionable (filter)
 *     │              │  promptNode — extract
 *     ▼              │
 *   extractions ─────┤
 *     │              │
 *     ▼              ▼
 *   ranked (score + sort)
 *     │
 *     ▼
 *   top3 (take 3)
 *     │  promptNode — brief
 *     ▼
 *   brief (string)
 * ```
 *
 * 3 LLM calls total — not 50. `classifications` is consumed by multiple
 * downstream derivations (`actionable`, `ranked`) but the LLM runs once;
 * every other node is pure reactive math.
 *
 * Annotations live next to `graph.add` via the `annotation` option — they
 * surface in `graph.explain(from, to)` output and in `describe`, so the
 * final causal-chain printout documents the pipeline's own reasoning.
 */

import { derived, Graph, type LLMAdapter, type Node, state } from "@graphrefly/graphrefly";
import { promptNode } from "@graphrefly/graphrefly/patterns/ai";
import type { Email } from "./emails.js";

// ----------------------------------------------------------------------------
// Types — the shape of what flows through each stage
// ----------------------------------------------------------------------------

export interface Classification {
	readonly id: string;
	readonly actionable: boolean;
	readonly priority: 1 | 2 | 3 | 4 | 5;
	readonly category: "personal" | "work" | "billing" | "promo" | "notification" | "newsletter";
	readonly confidence: number;
}

export interface ActionItem {
	readonly id: string;
	readonly title: string;
	readonly action: string;
	readonly deadline?: string;
	readonly entities: readonly string[];
}

export interface RankedItem {
	readonly item: ActionItem;
	readonly classification: Classification;
	readonly score: number;
}

export interface InboxReducerGraph {
	readonly graph: Graph;
	readonly emails: Node<readonly Email[]>;
	readonly classifications: Node<readonly Classification[] | null>;
	readonly actionable: Node<readonly Email[] | null>;
	readonly extractions: Node<readonly ActionItem[] | null>;
	readonly ranked: Node<readonly RankedItem[] | null>;
	readonly top3: Node<readonly RankedItem[] | null>;
	readonly brief: Node<string | null>;
}

// ----------------------------------------------------------------------------
// Prompt heads — single source of truth
//
// Exported so the dry-run mock (and any other offline fixture source) can
// route responses by matching on these exact strings. Change them here; the
// mock keeps working.
// ----------------------------------------------------------------------------

export const CLASSIFY_HEAD =
	"Classify each email below. Return a JSON array with one object per email in the SAME order.";
export const EXTRACT_HEAD =
	"For each email below, extract ONE action item the recipient must do. Return a JSON array in the SAME order as the input.";
export const BRIEF_HEAD = "Write a 3-bullet morning brief covering these top action items.";

const CLASSIFY_SYSTEM =
	"You are an email triage assistant. Output valid JSON only — no prose, no markdown fences.";
const EXTRACT_SYSTEM =
	"You extract concrete action items from emails. Output valid JSON only — no prose, no markdown fences.";
const BRIEF_SYSTEM = "You write concise morning briefings. Plain text only. No markdown.";

const classifyPrompt = (emails: readonly Email[]): string =>
	[
		CLASSIFY_HEAD,
		"Each object: {id, actionable, priority (1-5), category, confidence (0..1)}.",
		"- actionable=true means the recipient must DO something (reply/approve/sign/decide).",
		"- Promotional / newsletter / receipt / resolved-notification = actionable=false.",
		"- priority 5 = blocker today, 1 = can ignore.",
		"",
		JSON.stringify(emails, null, 2),
	].join("\n");

const extractPrompt = (emails: readonly Email[]): string =>
	[
		EXTRACT_HEAD,
		"Each object: {id, title (<=60 chars), action (imperative verb phrase), deadline?, entities: string[]}.",
		"",
		JSON.stringify(emails, null, 2),
	].join("\n");

const briefPrompt = (items: readonly RankedItem[]): string =>
	[
		BRIEF_HEAD,
		"Use dashes for bullets. Keep each bullet under 20 words. No preamble.",
		"",
		JSON.stringify(
			items.map((r) => ({
				title: r.item.title,
				action: r.item.action,
				deadline: r.item.deadline,
				priority: r.classification.priority,
			})),
			null,
			2,
		),
	].join("\n");

// ----------------------------------------------------------------------------
// Builder — the pipeline itself, ~40 lines of wiring
// ----------------------------------------------------------------------------

export function inboxReducerGraph(
	adapter: LLMAdapter,
	initialEmails: readonly Email[],
): InboxReducerGraph {
	const graph = new Graph("inbox-reducer");

	const emails = state<readonly Email[]>(initialEmails, { name: "emails" });
	graph.add(emails, {
		name: "emails",
		annotation: "Raw inbox. In production: fromStorage / fromIMAP / fromGmail.",
	});

	const classifications = promptNode<readonly Classification[]>(
		adapter,
		[emails],
		(es) => classifyPrompt(es as readonly Email[]),
		{ name: "classify", format: "json", systemPrompt: CLASSIFY_SYSTEM, retries: 1 },
	);
	graph.add(classifications, {
		name: "classifications",
		annotation:
			"LLM-classified {actionable, priority, category, confidence} per email. One batched call.",
	});

	// `actionable` returns null while classifications haven't settled, so the
	// downstream `extract` promptNode's SENTINEL gate skips until real data
	// arrives. See COMPOSITION-GUIDE §8 (promptNode SENTINEL gate).
	const actionable = derived<readonly Email[] | null>(
		[emails, classifications],
		([rawEmails, rawClass]) => {
			const cs = rawClass as readonly Classification[] | null;
			if (cs == null) return null;
			const es = rawEmails as readonly Email[];
			const byId = new Map(cs.map((c) => [c.id, c]));
			return es.filter((e) => byId.get(e.id)?.actionable === true);
		},
		{ name: "actionable" },
	);
	graph.add(actionable, {
		name: "actionable",
		annotation: "Filter: keep emails where classification.actionable === true.",
	});

	const extractions = promptNode<readonly ActionItem[]>(
		adapter,
		[actionable],
		(as) => extractPrompt(as as readonly Email[]),
		{ name: "extract", format: "json", systemPrompt: EXTRACT_SYSTEM, retries: 1 },
	);
	graph.add(extractions, {
		name: "extractions",
		annotation: "Structured action items for the actionable subset. One batched call.",
	});

	const ranked = derived<readonly RankedItem[] | null>(
		[extractions, classifications],
		([rawExt, rawClass]) => {
			const items = rawExt as readonly ActionItem[] | null;
			const cs = rawClass as readonly Classification[] | null;
			if (items == null || cs == null) return null;
			const byId = new Map(cs.map((c) => [c.id, c]));
			const out: RankedItem[] = [];
			for (const item of items) {
				const cl = byId.get(item.id);
				if (!cl) continue;
				out.push({ item, classification: cl, score: cl.priority * cl.confidence });
			}
			out.sort((a, b) => b.score - a.score);
			return out;
		},
		{ name: "ranked" },
	);
	graph.add(ranked, {
		name: "ranked",
		annotation: "Rank by classification.priority × classification.confidence. Deterministic.",
	});

	const top3 = derived<readonly RankedItem[] | null>(
		[ranked],
		([raw]) => {
			const r = raw as readonly RankedItem[] | null;
			return r == null ? null : r.slice(0, 3);
		},
		{ name: "top3" },
	);
	graph.add(top3, { name: "top3", annotation: "Top 3 by score — the daily action list." });

	const brief = promptNode<string>(
		adapter,
		[top3],
		(t3) => briefPrompt(t3 as readonly RankedItem[]),
		{ name: "brief", format: "text", systemPrompt: BRIEF_SYSTEM, retries: 1 },
	);
	graph.add(brief, {
		name: "brief",
		annotation: "Human-readable 3-bullet morning brief authored by the LLM from the top-3.",
	});

	return { graph, emails, classifications, actionable, extractions, ranked, top3, brief };
}
