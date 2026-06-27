/**
 * Typed conformance shims for the eval dogfood drivers (gate-blind-spot fix,
 * 2026-05-17 `/dev-dispatch`, optimizations.md "gate blind-spot" follow-up).
 *
 * The eval driver adapters (`createAdapter` in `run-harness.ts`,
 * `mockAdapter` in `run-treatments.ts`) predate the `LLMAdapter` interface —
 * they produce an ad-hoc `{ invoke(msgs) => Promise<{content}> }`. The prior
 * `as unknown as LLMAdapter` double-cast LAUNDERED that gap: a real
 * `LLMAdapter` / `LLMResponse` / `ChatMessage` contract drift type-checked
 * green and only surfaced (if ever) at runtime in the un-CI'd eval harness.
 *
 * This module replaces the launder with a **typed boundary**: the wrapper
 * builds a real `LLMAdapter` by explicit member mapping. If `LLMAdapter`,
 * `LLMResponse`, `ChatMessage`, or `StreamDelta` drift, THIS FILE fails to
 * compile under `scripts/check-typecheck.ts` — turning the laundered
 * surface into the first-line gate D3 asked for. Behavior is preserved for
 * the deterministic dry-run / mock paths the smoke run exercises.
 */

import type {
	ChatMessage,
	LLMAdapter,
	LLMResponse,
	StreamDelta,
} from "../../src/utils/ai/index.js";

/**
 * The minimal pre-`LLMAdapter` shape the eval drivers actually produce.
 * `invoke` returns the legacy `{ content }` reply (no usage / tool calls /
 * finish reason — the dogfood only ever reads `.content`).
 */
export interface AdHocAdapter {
	invoke(msgs: ReadonlyArray<{ role: string; content: string }>): Promise<{ content: string }>;
}

/**
 * Wrap an ad-hoc `{ invoke }` eval-driver adapter into a real
 * {@link LLMAdapter}. Behavior-preserving:
 *
 * - `invoke(messages: readonly ChatMessage[])` projects `ChatMessage` →
 *   the legacy `{ role, content }[]` (only `role`/`content` are consumed by
 *   the keyword-routing dogfood adapters) and lifts the `{ content }` reply
 *   into a full `LLMResponse`.
 * - `stream()` delegates to `invoke` and yields one `token` delta + a
 *   terminal `finish` — the eval harness never streams in the dry-run /
 *   mock paths, so this is a faithful never-exercised minimum that still
 *   satisfies the `LLMAdapter` contract.
 *
 * @param adHoc - the legacy driver adapter (`createAdapter` / `mockAdapter`).
 * @param provider - `LLMAdapter.provider` tag (default `"eval-dogfood"`).
 */
export function asLLMAdapter(adHoc: AdHocAdapter, provider = "eval-dogfood"): LLMAdapter {
	const invoke = (messages: readonly ChatMessage[]): Promise<LLMResponse> =>
		adHoc
			.invoke(messages.map((m) => ({ role: m.role, content: m.content })))
			.then((r): LLMResponse => ({ content: r.content }));

	return {
		provider,
		invoke,
		async *stream(messages: readonly ChatMessage[]): AsyncIterable<StreamDelta> {
			const resp = await invoke(messages);
			yield { type: "token", delta: resp.content } satisfies StreamDelta;
			yield { type: "finish", reason: "stop" } satisfies StreamDelta;
		},
	};
}
