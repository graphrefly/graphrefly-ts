/**
 * Spending alerts — runnable Node example.
 *
 * Feeds a handful of transactions through the graph defined in
 * `pipeline.ts`, prints each alert, and — on the first flagged txn —
 * renders the structural causal chain via `graph.explain`.
 *
 * Run:
 *   pnpm --filter @graphrefly-examples/spending-alerts start
 *
 * Or with `npx`:
 *   npx tsx examples/spending-alerts/index.ts
 */

import { DATA } from "@graphrefly/graphrefly";
import { spendingAlertsGraph, type Transaction } from "./pipeline.js";

const { graph, feed } = spendingAlertsGraph({
	profile: {
		dailyAverage: 45,
		typicalCategories: ["groceries", "coffee", "utilities"],
	},
});

const alertMessage = graph.resolve("alertMessage");

// Subscribe BEFORE feeding — sources push lazily on activation.
let firstFlagExplained = false;
alertMessage.subscribe((msgs) => {
	for (const [type, value] of msgs) {
		if (type !== DATA) continue;
		const text = value as string;
		const rule = "─".repeat(60);
		console.log(`\n${rule}`);
		console.log(text);
		// When the text mentions "flagged" AND we haven't rendered the
		// chain yet, explain what led here. The chain's text is the
		// answer to homepage pain-point 02 — "why was this flagged?"
		if (!firstFlagExplained && text.includes("flagged")) {
			firstFlagExplained = true;
			const chain = graph.explain("txFeed", "alertMessage");
			const heavy = "═".repeat(60);
			console.log(`\n${heavy}`);
			console.log("Causal chain — graph.explain('txFeed', 'alertMessage'):");
			console.log(heavy);
			console.log(chain.text);
		}
	}
});

// Four transactions — two normal, then one highly anomalous, then another
// normal. The flagged one triggers the causal-chain print.
const TRANSACTIONS: readonly Transaction[] = [
	{
		id: "tx-001",
		vendor: "TRADER-JOES",
		category: "groceries",
		amount: 42.3,
		timestampIso: "2026-04-21T09:14:00Z",
	},
	{
		id: "tx-002",
		vendor: "TRADER-JOES",
		category: "groceries",
		amount: 38.9,
		timestampIso: "2026-04-22T10:02:00Z",
	},
	// The flag: unknown vendor + ~20× daily average + unknown category.
	{
		id: "tx-003",
		vendor: "UNKNOWN-OFFSHORE-LLC",
		category: "wire-transfer",
		amount: 847.0,
		timestampIso: "2026-04-23T03:47:00Z",
	},
	{
		id: "tx-004",
		vendor: "BLUE-BOTTLE",
		category: "coffee",
		amount: 6.5,
		timestampIso: "2026-04-23T08:15:00Z",
	},
];

for (const txn of TRANSACTIONS) feed(txn);

graph.destroy();
