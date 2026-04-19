/**
 * File-based replay cache for LLM responses.
 *
 * Wraps any `LLMProvider` so that responses are keyed on
 * `sha256(provider + model + prompt + params)` and cached to disk. First
 * run of a task costs real tokens; every rerun is free.
 *
 * Motivation: `archive/docs/SESSION-rigor-infrastructure-plan.md`
 * § "LLM EVAL COST SAFETY" Layer 2. Eliminates the rerun-cost fear that
 * blocks automating the §9.1 eval harness.
 *
 * Wrap with `withReplayCache(inner, opts)`. Typically layered OUTSIDE
 * the budget gate so cache hits short-circuit before any budget is
 * charged — `withReplayCache(withBudgetGate(realProvider, ...), ...)`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LLMProvider, LLMRequest, LLMResponse } from "./llm-client.js";

/**
 * Cache behaviour:
 * - `"read-write"`: serve from cache on hit; write response on miss. (default)
 * - `"read-only"`: serve from cache on hit; throw on miss (CI-friendly).
 * - `"write-only"`: always call the real provider, overwrite cache.
 * - `"off"`: passthrough — provider called, nothing cached.
 */
export type ReplayMode = "read-write" | "read-only" | "write-only" | "off";

export interface ReplayCacheOptions {
	readonly cacheDir: string;
	readonly mode?: ReplayMode;
	/**
	 * When `true`, `temperature` is part of the cache key. Default `false` —
	 * treat different temperatures as the same cache entry to maximize hits
	 * (eval harness typically locks temperature; user re-runs at same temp).
	 */
	readonly includeTemperature?: boolean;
	/**
	 * When set, included in the cache key (e.g. serialized vendor-specific chat
	 * completion fields that change model output or routing).
	 */
	readonly keyMaterialExtra?: string;
}

function cacheKey(
	provider: string,
	req: LLMRequest,
	includeTemp: boolean,
	keyMaterialExtra?: string,
): string {
	const payload = JSON.stringify({
		provider,
		keyMaterialExtra: keyMaterialExtra ?? "",
		model: req.model ?? "",
		system: req.system,
		user: req.user,
		maxTokens: req.maxTokens ?? null,
		...(includeTemp ? { temperature: req.temperature ?? null } : {}),
	});
	return createHash("sha256").update(payload).digest("hex");
}

export class ReplayCacheMissError extends Error {
	constructor(readonly key: string) {
		super(`Replay cache miss in read-only mode: ${key}`);
		this.name = "ReplayCacheMissError";
	}
}

export function withReplayCache(inner: LLMProvider, opts: ReplayCacheOptions): LLMProvider {
	const mode = opts.mode ?? "read-write";
	if (mode !== "off") mkdirSync(opts.cacheDir, { recursive: true });
	return {
		name: `${inner.name}+replay`,
		limits: inner.limits,
		async generate(req: LLMRequest): Promise<LLMResponse> {
			if (mode === "off") return inner.generate(req);
			const key = cacheKey(
				inner.name,
				req,
				opts.includeTemperature ?? false,
				opts.keyMaterialExtra,
			);
			const path = join(opts.cacheDir, `${key}.json`);
			if (mode !== "write-only" && existsSync(path)) {
				const cached = JSON.parse(readFileSync(path, "utf-8")) as LLMResponse;
				// latencyMs of 0 flags a replayed response — downstream reporters
				// can distinguish cache hits from fresh calls in aggregate stats.
				return { ...cached, latencyMs: 0 };
			}
			if (mode === "read-only") throw new ReplayCacheMissError(key);
			const response = await inner.generate(req);
			writeFileSync(path, JSON.stringify(response, null, 2));
			return response;
		},
	};
}
