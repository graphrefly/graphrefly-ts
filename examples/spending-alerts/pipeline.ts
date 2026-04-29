/**
 * Spending-alerts pipeline topology (deterministic core).
 *
 * Five hops on the causal spine from a raw transaction to a human-readable
 * alert, plus two side inputs (per-vendor stats, user profile). Every node
 * is added to a named `Graph` so `graph.describe({ explain: { from: "txFeed", to: "alertMessage" } })`
 * walks backward through `deps` and renders every step's value + `trace()`
 * annotation.
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
 * deterministic templater shipped here, or (in the browser demo) a
 * `promptNode` backed by Chrome Nano. Both shapes `(reason, txn) => string`.
 * Structural explainability doesn't change: the graph topology *is* the
 * trace, regardless of which justifier is plugged in.
 *
 * @module
 */

import { derived, Graph, producer, state } from "@graphrefly/graphrefly";

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
 * Sync by design so the derived node stays within a single wave. In the
 * browser demo, Chrome Nano's async output is composed via `promptNode`
 * downstream — the `alertMessage` node emits the template fragment, then
 * a separate `llmAlert` node re-phrases it. Keeps the core pipeline
 * deterministic and explainable-without-LLM.
 */
export type Justifier = (reason: ReasonFactors, txn: Transaction) => string;

export interface SpendingAlertsOptions {
	/** Static user profile — in a real app this would come from a `fromStorage` source. */
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
 * chain enriched with each node's value and annotation.
 */
export function spendingAlertsGraph(opts: SpendingAlertsOptions = {}): SpendingAlertsGraph {
	const profile = opts.profile ?? DEFAULT_PROFILE;
	const zThreshold = opts.zThreshold ?? 3;
	const dailyRatioThreshold = opts.dailyRatioThreshold ?? 5;
	const justifier = opts.justifier ?? defaultJustifier;

	const graph = new Graph("spending-alerts");

	// Annotate each node with the WHY so `explain()` surfaces it alongside
	// the value. This is what turns a chain of values into a chain of
	// reasoning.
	const trace = (path: string, reason: string): void => {
		graph.trace(path, reason);
	};

	// 1. Source — raw transaction stream. The producer captures `emit` on
	// activation; the caller's `feed()` closes over it to push txns in.
	// `status` distinguishes "never activated" from "activated then torn
	// down" so `feed()` can emit a diagnostic message matching the actual
	// lifecycle state rather than always blaming the caller for ordering.
	let pushTxn: ((txn: Transaction) => void) | null = null;
	let status: "pending" | "active" | "deactivated" = "pending";
	const txFeed = producer<Transaction>(
		(actions) => {
			pushTxn = (txn) => actions.emit(txn);
			status = "active";
			return () => {
				pushTxn = null;
				status = "deactivated";
			};
		},
		{ name: "txFeed" },
	);
	graph.add(txFeed, { name: "txFeed" });
	trace("txFeed", "Raw transaction stream from bank API / simulator.");

	// 2. Running per-vendor stats (mean / std). Stateful accumulator —
	// held in a closure; each new txn updates the map then the derived
	// node emits the current snapshot for the txn's vendor.
	const statsByVendor = new Map<string, { count: number; mean: number; m2: number }>();
	const vendorStats = derived<VendorStats>(
		[txFeed],
		([rawTxn]) => {
			const txn = rawTxn as Transaction;
			// Welford online update.
			const prev = statsByVendor.get(txn.vendor) ?? {
				count: 0,
				mean: 0,
				m2: 0,
			};
			const count = prev.count + 1;
			const delta = txn.amount - prev.mean;
			const mean = prev.mean + delta / count;
			const m2 = prev.m2 + delta * (txn.amount - mean);
			statsByVendor.set(txn.vendor, { count, mean, m2 });
			const std = count >= 2 ? Math.sqrt(m2 / (count - 1)) : 0;
			return { count, mean, std };
		},
		{ name: "vendorStats" },
	);
	graph.add(vendorStats, { name: "vendorStats" });
	trace("vendorStats", "Running per-vendor mean + sample std (Welford online update).");

	// 3. User profile — static state for this demo; in a real app this is
	// `fromStorage(...)` so it persists across sessions.
	const userProfile = state<UserProfile>(profile, { name: "userProfile" });
	graph.add(userProfile, { name: "userProfile" });
	trace("userProfile", "User baseline: daily-average spend + typical categories.");

	// 4. Anomaly score — composes txn × vendor stats × user profile. This is
	// the structural join point; `deps` above are what `explainPath` walks.
	const anomalyScore = derived<AnomalyScore>(
		[txFeed, vendorStats, userProfile],
		([rawTxn, rawStats, rawProfile]) => {
			const txn = rawTxn as Transaction;
			const stats = rawStats as VendorStats;
			const prof = rawProfile as UserProfile;
			const scale = stats.std > 0 ? stats.std : Math.max(stats.mean, 1);
			const zScore = (txn.amount - stats.mean) / scale;
			const dailyRatio = txn.amount / Math.max(prof.dailyAverage, 1);
			const categoryFamiliarity: AnomalyScore["categoryFamiliarity"] =
				prof.typicalCategories.includes(txn.category) ? "known" : "unknown";
			return { zScore, dailyRatio, categoryFamiliarity, txn };
		},
		{ name: "anomalyScore" },
	);
	graph.add(anomalyScore, { name: "anomalyScore" });
	trace("anomalyScore", "z-score vs vendor history + daily-spend ratio + category familiarity.");

	// 5. Threshold gate — binary flagged? + the threshold used. Echoes
	// the txn + score so `reasonFactors` has what it needs without
	// shortcutting back to `txFeed` or `anomalyScore`.
	const thresholdGate = derived<Flagged>(
		[anomalyScore],
		([rawScore]) => {
			const score = rawScore as AnomalyScore;
			const flagged =
				score.zScore > zThreshold ||
				score.dailyRatio > dailyRatioThreshold ||
				score.categoryFamiliarity === "unknown";
			return { flagged, threshold: zThreshold, txn: score.txn, score };
		},
		{ name: "thresholdGate" },
	);
	graph.add(thresholdGate, { name: "thresholdGate" });
	trace(
		"thresholdGate",
		`Flag when zScore > ${zThreshold} OR dailyRatio > ${dailyRatioThreshold} OR category is unknown.`,
	);

	// 6. Reason factors — structured list of contributing signals + the
	// originating txn. Only depends on `thresholdGate` so the causal spine
	// stays `txFeed → anomalyScore → thresholdGate → reasonFactors →
	// alertMessage`.
	const reasonFactors = derived<ReasonFactors>(
		[thresholdGate],
		([rawGate]) => {
			const gate = rawGate as Flagged;
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
	graph.add(reasonFactors, { name: "reasonFactors" });
	trace("reasonFactors", "Decomposes the flag into contributing signals — trustable breakdown.");

	// 7. Alert message — human-readable final output. Only depends on
	// `reasonFactors` so `graph.describe({ explain: { from: 'txFeed', to: 'alertMessage' } })` walks
	// through every intermediate on the reasoning spine. Pluggable via
	// `justifier` (deterministic template here; swap for a `promptNode` in
	// the browser demo — the graph topology is identical either way).
	const alertMessage = derived<string>(
		[reasonFactors],
		([rawReason]) => {
			const reason = rawReason as ReasonFactors;
			return justifier(reason, reason.txn);
		},
		{ name: "alertMessage" },
	);
	graph.add(alertMessage, { name: "alertMessage" });
	trace(
		"alertMessage",
		"Final human-readable alert. Swap the justifier for a promptNode to get LLM-authored rationale.",
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
