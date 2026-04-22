// ── Alert generator ──────────────────────────────────────────────
// Scaffolded vocabulary that randomly combines into realistic PagerDuty alerts.
// A seeded PRNG ensures reproducibility across Baseline / GraphReFly runs.

export type Severity = "critical" | "high" | "warning" | "low" | "info";

export interface Alert {
	readonly id: string;
	readonly service: string;
	readonly severity: Severity;
	readonly summary: string;
	readonly timestamp: number;
}

// ── Vocabulary ──────────────────────────────────────────────────

const SERVICES = [
	"payment-api",
	"auth-service",
	"db-primary",
	"db-replica",
	"user-service",
	"order-service",
	"notification-svc",
	"search-index",
	"cdn-edge",
	"ml-inference",
] as const;

const ERROR_TEMPLATES: readonly { tpl: string; severities: readonly Severity[] }[] = [
	{ tpl: "Connection timeout after 30s", severities: ["critical", "high"] },
	{ tpl: "Connection refused on port 5432", severities: ["critical", "high"] },
	{ tpl: "5xx error rate exceeded 5% threshold", severities: ["critical", "high"] },
	{ tpl: "Disk usage exceeded 90%", severities: ["high", "warning"] },
	{ tpl: "Memory usage exceeded 85%", severities: ["high", "warning"] },
	{ tpl: "CPU utilization at 95% for 5 minutes", severities: ["high", "warning"] },
	{ tpl: "Latency p99 exceeded 2000ms", severities: ["high", "warning"] },
	{ tpl: "SSL certificate expires in 7 days", severities: ["warning", "low"] },
	{ tpl: "Health check failing on 2/5 instances", severities: ["high", "warning"] },
	{ tpl: "Queue depth exceeded 10000 messages", severities: ["high", "warning"] },
	{ tpl: "Pod restart loop detected (CrashLoopBackOff)", severities: ["critical", "high"] },
	{ tpl: "DNS resolution failure", severities: ["critical", "high"] },
	{ tpl: "Rate limiter engaged — 429 responses climbing", severities: ["warning", "low"] },
	{ tpl: "Deployment rollback triggered", severities: ["high", "warning"] },
	{ tpl: "Log ingestion pipeline stalled", severities: ["warning", "low"] },
];

// ── Seeded PRNG (mulberry32) ────────────────────────────────────

function mulberry32(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ── Generator ───────────────────────────────────────────────────

export interface AlertGeneratorOptions {
	seed?: number;
	count?: number;
}

export function generateAlerts(opts?: AlertGeneratorOptions): readonly Alert[] {
	const seed = opts?.seed ?? Date.now() ^ 0xdeadbeef;
	const count = opts?.count ?? 60; // enough for a 3-minute run
	const rng = mulberry32(seed);

	const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;

	const alerts: Alert[] = [];
	for (let i = 0; i < count; i++) {
		const service = pick(SERVICES);
		const error = pick(ERROR_TEMPLATES);
		const severity = pick(error.severities);
		alerts.push({
			id: `PD-${String(i + 1).padStart(4, "0")}`,
			service,
			severity,
			summary: `[${service}] ${error.tpl}`,
			timestamp: 0, // filled at emission time
		});
	}
	return alerts;
}

// ── Emission schedule ───────────────────────────────────────────
// Returns delay-in-ms for the Nth alert. Starts slow, accelerates.
//   0–20:  one every 4s  (0:00–1:20)
//   20–40: one every 2s  (1:20–2:00)
//   40+:   one every 1s  (2:00–3:00)

export function emissionDelayMs(index: number): number {
	if (index < 20) return 4000;
	if (index < 40) return 2000;
	return 1000;
}

// Total alerts that fit in 3 minutes with the above schedule:
// 20×4 + 20×2 + 60×1 = 80+40+60 = 180s worth ≈ 60 alerts is a good default.
