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
	const count = opts?.count ?? 80; // enough for a 5-minute run (~52 alerts produced across phases)
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
// Returns next delay-in-ms based on elapsed run time (not alert index).
// 5-minute round with a long readable ramp-up:
//   0:00 – 1:00  → 30s between alerts   (calm, you read carefully)
//   1:00 – 2:00  → 20s between alerts   (steady)
//   2:00 – 3:00  → 15s between alerts   (elevated)
//   3:00 – 4:50  → 10s between alerts   (pressured)
//   4:50 – 5:00  → 1s burst             (chaos finale)

export const EMISSION_PHASES = [
	{ untilMs: 60_000, delayMs: 30_000, label: "calm (30s)" },
	{ untilMs: 120_000, delayMs: 20_000, label: "steady (20s)" },
	{ untilMs: 180_000, delayMs: 15_000, label: "elevated (15s)" },
	{ untilMs: 290_000, delayMs: 10_000, label: "pressured (10s)" },
	{ untilMs: 300_000, delayMs: 1_000, label: "burst (1s)" },
] as const;

export function emissionDelayMs(elapsedMs: number): number {
	for (const phase of EMISSION_PHASES) {
		if (elapsedMs < phase.untilMs) return phase.delayMs;
	}
	return EMISSION_PHASES[EMISSION_PHASES.length - 1].delayMs;
}

export function emissionPhaseLabel(elapsedMs: number): string {
	for (const phase of EMISSION_PHASES) {
		if (elapsedMs < phase.untilMs) return phase.label;
	}
	return EMISSION_PHASES[EMISSION_PHASES.length - 1].label;
}
