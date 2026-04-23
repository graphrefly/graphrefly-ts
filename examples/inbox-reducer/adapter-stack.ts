/**
 * Adapter stack — how to wire safety around a real LLM adapter.
 *
 * Composes in this order (innermost to outermost):
 *
 * ```text
 *   createAdapter(provider)         ← real wire call
 *     └─ observableAdapter           ← emits reactive token-count stats
 *         └─ withReplayCache          ← file cache; reruns are free
 *             └─ resilientAdapter      ← rateLimit / budget / timeout / retry / fallback
 * ```
 *
 * Every layer is a shipped building block. No bespoke glue — just
 * composition. Swap any one layer for your own middleware at the same
 * point; the others don't care.
 */

import { DATA, type LLMAdapter, type Messages, type TokenUsage } from "@graphrefly/graphrefly";
import { fileStorage } from "@graphrefly/graphrefly/extra/node";
import {
	type AdapterStats,
	type BudgetGateBundle,
	computePrice,
	createAdapter,
	observableAdapter,
	resilientAdapter,
	withReplayCache,
} from "@graphrefly/graphrefly/patterns/ai";
import type { InboxConfig, InboxProviderConfig } from "./config.js";

export interface AdapterStackBundle {
	readonly adapter: LLMAdapter;
	readonly stats: AdapterStats;
	readonly budget: BudgetGateBundle | undefined;
	/** Subscribe-friendly message listener for budget totals (if configured). */
	readonly onBudget: (cb: (line: string) => void) => (() => void) | undefined;
}

function resolveApiKey(cfg: InboxProviderConfig): string | undefined {
	return cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
}

export function assertApiKey(cfg: InboxProviderConfig): void {
	if (cfg.apiKeyEnv && !process.env[cfg.apiKeyEnv]) {
		console.error(
			`\nMissing env var ${cfg.apiKeyEnv} for provider kind=${cfg.kind}, model=${cfg.model}.`,
		);
		console.error("Export the env var, or edit examples/inbox-reducer/config.ts.");
		process.exit(2);
	}
}

export function buildProviderAdapter(cfg: InboxProviderConfig): LLMAdapter {
	return createAdapter({
		provider: cfg.kind,
		apiKey: resolveApiKey(cfg),
		model: cfg.model,
		baseURL: cfg.baseURL,
		bodyExtras: cfg.bodyExtras,
	});
}

/**
 * Build the full adapter stack for a real run.
 *
 * @param config - Active `InboxConfig`.
 * @param cacheDir - Directory for the replay cache files.
 */
export function buildAdapterStack(config: InboxConfig, cacheDir: string): AdapterStackBundle {
	const pricing = config.primary.capabilities?.pricing;
	const pricingFn = pricing ? (usage: TokenUsage) => computePrice(usage, pricing) : undefined;

	const { adapter: observed, stats } = observableAdapter(buildProviderAdapter(config.primary), {
		name: config.primary.model,
	});

	// Replay cache sits INSIDE the resilience stack so cache hits are not
	// rate-limited, budget-gated, or retried. Observable sits INSIDE the
	// cache so only real wire calls count against stats.
	const cached = withReplayCache(observed, {
		storage: fileStorage(cacheDir),
		mode: "read-write",
		keyPrefix: `inbox-reducer:${config.primary.kind}:${config.primary.model}`,
	});

	const { adapter, budget } = resilientAdapter(cached, {
		rateLimit: config.resilience?.rpm
			? { rpm: config.resilience.rpm, tpm: config.resilience.tpm }
			: undefined,
		budget: config.budget ? { caps: config.budget, pricingFn } : undefined,
		timeoutMs: config.resilience?.timeoutMs,
		retry: config.resilience?.retryAttempts
			? { attempts: config.resilience.retryAttempts }
			: undefined,
		fallback: config.fallback ? buildProviderAdapter(config.fallback) : undefined,
	});

	const onBudget = (cb: (line: string) => void): (() => void) | undefined => {
		if (!budget) return undefined;
		return budget.totals.subscribe((msgs: Messages) => {
			for (const [type, value] of msgs) {
				if (type !== DATA) continue;
				const t = value as {
					calls: number;
					inputTokens: number;
					outputTokens: number;
					usd: number;
				};
				if (t.calls === 0) continue;
				const usd = t.usd ? `  $${t.usd.toFixed(4)}` : "";
				cb(`${t.calls} calls · ${t.inputTokens}t in · ${t.outputTokens}t out${usd}`);
			}
		});
	};

	return { adapter, stats, budget, onBudget };
}
