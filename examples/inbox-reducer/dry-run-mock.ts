/**
 * Dry-run mock — shaped responses so the pipeline flows end-to-end without
 * any API call.
 *
 * Routes on prompt-head substrings (see [pipeline.ts](./pipeline.ts) —
 * `CLASSIFY_HEAD`, `EXTRACT_HEAD`). Returns canned JSON for classify/extract
 * so `promptNode`'s `format: "json"` parse succeeds, and plain text for the
 * brief.
 *
 * For richer offline fallback (recorded real responses), swap this out for
 * `fallbackAdapter({ fixturesDir: "./fixtures" })` — same `LLMAdapter`
 * shape, no pipeline changes. Files land under `./fixtures/fallback/`
 * (auto-namespaced by keyPrefix).
 */

import type { LLMAdapter } from "@graphrefly/graphrefly";
import { dryRunAdapter } from "@graphrefly/graphrefly/patterns/ai";
import { EMAILS } from "./emails.js";
import { CLASSIFY_HEAD, EXTRACT_HEAD } from "./pipeline.js";

export function buildDryRunMock(providerLabel: string, modelLabel: string): LLMAdapter {
	return dryRunAdapter({
		provider: providerLabel,
		model: modelLabel,
		respond: (messages) => {
			const last = messages[messages.length - 1]?.content ?? "";
			const text = typeof last === "string" ? last : "";
			if (text.includes(CLASSIFY_HEAD)) {
				// Shaped classifications — keep a quarter of emails actionable so
				// the downstream extract prompt has non-empty input.
				return JSON.stringify(
					EMAILS.map((e, i) => ({
						id: e.id,
						actionable: i % 4 === 0,
						priority: 3,
						category: "work",
						confidence: 0.75,
					})),
				);
			}
			if (text.includes(EXTRACT_HEAD)) {
				return JSON.stringify(
					EMAILS.filter((_, i) => i % 4 === 0).map((e) => ({
						id: e.id,
						title: `stub: ${e.subject.slice(0, 48)}`,
						action: "Review",
						entities: [e.from],
					})),
				);
			}
			return "- stub bullet one\n- stub bullet two\n- stub bullet three";
		},
	});
}
