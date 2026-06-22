/**
 * Spending-alerts pipeline topology (deterministic core).
 *
 * Five hops on the causal spine from a raw transaction to a human-readable
 * alert, plus two side inputs (per-vendor stats, user profile). Every node
 * is registered on a named `Graph` so `graph.describe({ explain: { from: "txFeed", to: "alertMessage" } })`
 * walks backward through `deps` and renders every step's current value.
 *
 * ```
 *   txFeed (source)
 *     ├──▶ vendorStats (derived)
 *     └──▶ userProfile (state)
 *              │
 *              ▼
 *          anomalyScore (derived) ──▶ thresholdGate (derived)
 *              │                             │
 *              ▼                             ▼
 *          reasonFactors (derived) ──▶ alertMessage (derived)
 * ```
 *
 * The pipeline is factored so consumers pick the **justifier** — the
 * deterministic templater shipped here, or any caller-supplied synchronous
 * justifier. Both shapes are `(reason, txn) => string`.
 * Structural explainability doesn't change: the graph topology and
 * current node values are the trace, regardless of which justifier is plugged in.
 *
 * @module
 */

import { type Ctx, depBatch } from "@graphrefly/ts/core";
import { Graph } from "@graphrefly/ts/graph";

export interface Transaction {
	readonly id: string;
	readonly vendor: string;
	readonly category: string;
	readonly amount: number;
	readonly timestampIso: string;
}

export interface VendorStats {
	readonly count: number;
	readonly mean: number;
	/** Sample standard deviation. `0` when count < 2 (falls back to `mean` as unit scale). */
	readonly std: number;
}

export interface UserProfile {
	readonly dailyAverage: number;
	readonly typicalCategories: readonly string[];
}

export interface AnomalyScore {
	readonly zScore: number;
	readonly dailyRatio: number;
	readonly categoryFamiliarity: "known" | "unknown";
	/** Echoed so downstream nodes stay on the spine. */
	readonly txn: Transaction;
}

export interface Flagged {
	readonly flagged: boolean;
	readonly threshold: number;
	readonly txn: Transaction;
	readonly score: AnomalyScore;
}

export interface ReasonFactors {
	readonly factors: readonly string[];
	readonly severity: "low" | "medium" | "high";
	/** Echoed through. `alertMessage` reads this; no dep on raw `txFeed`. */
	readonly txn: Transaction;
}

/**
 * A justifier turns the structured reason + txn into natural language.
 * Sync by design so the derived node stays within a single wave. A browser
 * demo can compose async phrasing downstream at an explicit adapter boundary;
 * this core pipeline remains deterministic and explainable-without-LLM.
 */
export type Justifier = (reason: ReasonFactors, txn: Transaction) => string;

export interface SpendingAlertsOptions {
	/** Static user profile — in a real app this would come from a retained app-data node. */
	readonly profile?: UserProfile;
	/** z-score cutoff for flagging. Default 3. */
	readonly zThreshold?: number;
	/** Daily-ratio cutoff (amount / dailyAverage). Default 5. */
	readonly dailyRatioThreshold?: number;
	/** Alert-message composer. Default: deterministic template. */
	readonly justifier?: Justifier;
}

export interface SpendingAlertsGraph {
	readonly graph: Graph;
	/** Push the next transaction. Completes the `txFeed` source after the caller
	 * stops emitting; subscribers drain what was sent. */
	readonly feed: (txn: Transaction) => void;
}

interface VendorAccumulator {
	readonly count: number;
	readonly mean: number;
	readonly m2: number;
}

type VendorAccumulatorByVendor = Record<string, VendorAccumulator>;

const DEFAULT_PROFILE: UserProfile = {
	dailyAverage: 45,
	typicalCategories: ["groceries", "coffee", "utilities"],
};

const defaultJustifier: Justifier = (reason, txn) => {
	if (!reason.factors.length) {
		return `Transaction ${txn.id} ($${txn.amount.toFixed(2)} at ${txn.vendor}) — normal.`;
	}
	const bullets = reason.factors.map((f) => `  • ${f}`).join("\n");
	return [
		`Transaction ${txn.id} flagged — severity: ${reason.severity}.`,
		`Vendor: ${txn.vendor}  Amount: $${txn.amount.toFixed(2)}  Category: ${txn.category}`,
		"Reasoning:",
		bullets,
	].join("\n");
};

/**
 * Build the spending-alerts graph. Returns a live `Graph` plus a `feed()`
 * function to push transactions through. The graph exposes named nodes so
 * `graph.describe({ explain: { from: "txFeed", to: "alertMessage" } })` produces a walkable causal
 * chain enriched with each node's current value.
 */
export function spendingAlertsGraph(opts: SpendingAlertsOptions = {}): SpendingAlertsGraph {
	const profile = opts.profile ?? DEFAULT_PROFILE;
	const zThreshold = opts.zThreshold ?? 3;
	const dailyRatioThreshold = opts.dailyRatioThreshold ?? 5;
	const justifier = opts.justifier ?? defaultJustifier;

	const graph = new Graph({ name: "spending-alerts" });

	// 1. Source — raw transaction stream. The producer captures `emit` on
	// activation; the caller's `feed()` closes over it to push txns in.
	// `status` distinguishes "never activated" from "activated then torn
	// down" so `feed()` can emit a diagnostic message matching the actual
	// lifecycle state rather than always blaming the caller for ordering.
	let pushTxn: ((txn: Transaction) => void) | null = null;
	let status: "pending" | "active" | "deactivated" = "pending";
	const txFeed = graph.producer<Transaction>(
		(ctx: Ctx) => {
			pushTxn = (txn) => ctx.down([["DATA", txn]]);
			status = "active";
			ctx.onDeactivation(() => {
				pushTxn = null;
				status = "deactivated";
			});
		},
		{ name: "txFeed" },
	);

	// 2. Running per-vendor stats (mean / std). The accumulator is per-node
	// graph state (R-ctx-state), so lifecycle/checkpoint behavior stays owned
	// by the node rather than by a factory closure.
	const vendorStats = graph.node<VendorStats>(
		[txFeed],
		(ctx: Ctx) => {
			const batch = depBatch(ctx, 0);
			if (batch === null) return;
			const statsByVendor =
				ctx.state.get<VendorAccumulatorByVendor>() ??
				(Object.create(null) as VendorAccumulatorByVendor);
			for (const value of batch) {
				const txn = value as Transaction;
				// Welford online update.
				const prev = statsByVendor[txn.vendor] ?? {
					count: 0,
					mean: 0,
					m2: 0,
				};
				const count = prev.count + 1;
				const delta = txn.amount - prev.mean;
				const mean = prev.mean + delta / count;
				const m2 = prev.m2 + delta * (txn.amount - mean);
				statsByVendor[txn.vendor] = { count, mean, m2 };
				const std = count >= 2 ? Math.sqrt(m2 / (count - 1)) : 0;
				ctx.down([["DATA", { count, mean, std }]]);
			}
			ctx.state.set(statsByVendor);
		},
		{ name: "vendorStats" },
	);

	// 3. User profile — static state for this demo.
	const userProfile = graph.state<UserProfile>(profile, { name: "userProfile" });

	// 4. Anomaly score — composes txn × vendor stats × user profile. This is
	// the structural join point; `deps` above are what `explainPath` walks.
	const anomalyScore = graph.derived(
		[txFeed, vendorStats, userProfile],
		(txn, stats, prof): AnomalyScore => {
			const scale = stats.std > 0 ? stats.std : Math.max(stats.mean, 1);
			const zScore = (txn.amount - stats.mean) / scale;
			const dailyRatio = txn.amount / Math.max(prof.dailyAverage, 1);
			const categoryFamiliarity: AnomalyScore["categoryFamiliarity"] =
				prof.typicalCategories.includes(txn.category) ? "known" : "unknown";
			return { zScore, dailyRatio, categoryFamiliarity, txn };
		},
		{ name: "anomalyScore" },
	);

	// 5. Threshold gate — binary flagged? + the threshold used. Echoes
	// the txn + score so `reasonFactors` has what it needs without
	// shortcutting back to `txFeed` or `anomalyScore`.
	const thresholdGate = graph.derived(
		[anomalyScore],
		(score): Flagged => {
			const flagged =
				score.zScore > zThreshold ||
				score.dailyRatio > dailyRatioThreshold ||
				score.categoryFamiliarity === "unknown";
			return { flagged, threshold: zThreshold, txn: score.txn, score };
		},
		{ name: "thresholdGate" },
	);

	// 6. Reason factors — structured list of contributing signals + the
	// originating txn. Only depends on `thresholdGate` so the causal spine
	// stays `txFeed → anomalyScore → thresholdGate → reasonFactors →
	// alertMessage`.
	const reasonFactors = graph.derived(
		[thresholdGate],
		(gate): ReasonFactors => {
			const { score, txn } = gate;
			if (!gate.flagged) return { factors: [], severity: "low", txn };
			const factors: string[] = [];
			if (score.zScore > zThreshold) {
				factors.push(`Amount is ${score.zScore.toFixed(2)}σ above this vendor's historical mean.`);
			}
			if (score.dailyRatio > dailyRatioThreshold) {
				factors.push(`Amount is ${score.dailyRatio.toFixed(1)}× the user's daily average.`);
			}
			if (score.categoryFamiliarity === "unknown") {
				factors.push("Category is outside the user's typical spend profile.");
			}
			const severity: ReasonFactors["severity"] =
				factors.length >= 3 ? "high" : factors.length === 2 ? "medium" : "low";
			return { factors, severity, txn };
		},
		{ name: "reasonFactors" },
	);

	// 7. Alert message — human-readable final output. Only depends on
	// `reasonFactors` so `graph.describe({ explain: { from: 'txFeed', to: 'alertMessage' } })` walks
	// through every intermediate on the reasoning spine. Pluggable via
	// `justifier` (deterministic template here; richer phrasing can be
	// composed downstream through an explicit adapter boundary).
	graph.derived(
		[reasonFactors],
		(reason): string => {
			return justifier(reason, reason.txn);
		},
		{ name: "alertMessage" },
	);

	return {
		graph,
		feed: (txn) => {
			if (pushTxn == null) {
				throw new Error(
					status === "deactivated"
						? "spendingAlertsGraph: feed() called after the source was deactivated (e.g. graph.destroy() ran, or all subscribers disconnected)."
						: "spendingAlertsGraph: feed() called before any subscriber activated the source — subscribe to alertMessage first.",
				);
			}
			pushTxn(txn);
		},
	};
}
