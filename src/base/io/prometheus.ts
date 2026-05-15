/**
 * Prometheus scrape IO — `fromPrometheus` polls a `/metrics` endpoint via
 * `fromTimer + switchMap` (reactive timer, not bare `setInterval`) and emits
 * one `DATA` per parsed metric per scrape. `parsePrometheusText` exposes the
 * exposition-format parser as a pure helper.
 */

import { COMPLETE, ERROR, type Node, node, wallClockNs } from "@graphrefly/pure-ts/core";
import type { AsyncSourceOpts } from "@graphrefly/pure-ts/extra";
import { fromTimer, switchMap } from "@graphrefly/pure-ts/extra";
import { NS_PER_MS, NS_PER_SEC } from "../../utils/resilience/backoff.js";

/** Parsed Prometheus metric. */
export type PrometheusMetric = {
	name: string;
	labels: Record<string, string>;
	value: number;
	timestampMs?: number;
	type?: "counter" | "gauge" | "histogram" | "summary" | "untyped";
	help?: string;
	timestampNs: number;
};

/** Options for {@link fromPrometheus}. */
export type FromPrometheusOptions = AsyncSourceOpts & {
	/** Scrape interval in nanoseconds. Default `15 * NS_PER_SEC` (15s). */
	intervalNs?: number;
	/** Request headers for the scrape. */
	headers?: Record<string, string>;
	/** Request timeout in nanoseconds. Default `10 * NS_PER_SEC` (10s). */
	timeoutNs?: number;
	/**
	 * Maximum consecutive scrape errors before terminating the source. Prevents
	 * error storms when the endpoint is down. Default: `1` (terminate on first error — preserves pre-switchMap back-compat). Raise it (or set `Infinity`)
	 * to keep retrying indefinitely.
	 */
	maxConsecutiveErrors?: number;
};

/**
 * Scrapes a Prometheus `/metrics` endpoint on a reactive timer interval.
 *
 * Each scrape parses the exposition format and emits one `DATA` per metric line.
 * Uses `fromTimer` semantics internally (reactive timer source, not polling).
 *
 * @param endpoint - URL of the Prometheus metrics endpoint.
 * @param opts - Scrape interval, headers, timeout.
 * @returns `Node<PrometheusMetric>` — one `DATA` per metric per scrape.
 *
 * @example
 * ```ts
 * import { fromPrometheus } from "@graphrefly/graphrefly-ts";
 *
 * const prom$ = fromPrometheus("http://localhost:9090/metrics", { intervalNs: 30 * NS_PER_SEC });
 * ```
 *
 * @category extra
 */
export function fromPrometheus(
	endpoint: string,
	opts?: FromPrometheusOptions,
): Node<PrometheusMetric> {
	const {
		intervalNs = 15 * NS_PER_SEC,
		headers,
		timeoutNs = 10 * NS_PER_SEC,
		signal: externalSignal,
		maxConsecutiveErrors = 1,
	} = opts ?? {};
	const intervalMs = Math.ceil(intervalNs / NS_PER_MS);
	// Circuit breaker shared across switchMap inners — resets on any successful
	// scrape, trips when consecutive errors hit the cap.
	let consecutiveErrors = 0;

	// Timer drives scrapes: first tick at t=0, then every intervalMs. Each tick
	// switches to a fresh inner producer that does one scrape and completes —
	// switchMap cancels any in-flight scrape when the next tick arrives.
	return switchMap(fromTimer(0, { period: intervalMs, signal: externalSignal }), () =>
		node<PrometheusMetric>([], (_data, a) => {
			let active = true;
			const abort = new AbortController();
			const timeoutId = setTimeout(
				() => abort.abort(new Error("Scrape timeout")),
				Math.ceil(timeoutNs / NS_PER_MS),
			);
			const run = async () => {
				try {
					const res = await fetch(endpoint, {
						headers: { Accept: "text/plain", ...headers },
						signal: abort.signal,
					});
					clearTimeout(timeoutId);
					if (!active) return;
					if (!res.ok) throw new Error(`Prometheus scrape ${res.status}: ${res.statusText}`);
					const text = await res.text();
					if (!active) return;
					const metrics = parsePrometheusText(text);
					for (const m of metrics) a.emit(m);
					consecutiveErrors = 0;
					a.down([[COMPLETE]]);
				} catch (err) {
					clearTimeout(timeoutId);
					if (!active) return;
					if (err instanceof Error && err.name === "AbortError") return;
					consecutiveErrors += 1;
					if (consecutiveErrors >= maxConsecutiveErrors) {
						a.down([[ERROR, err]]);
					}
					// else: swallow transient error; next tick retries.
				}
			};
			void run();
			return () => {
				active = false;
				clearTimeout(timeoutId);
				abort.abort();
			};
		}),
	);
}

/**
 * Parses Prometheus exposition format text into structured metrics.
 *
 * @category extra
 */
export function parsePrometheusText(text: string): PrometheusMetric[] {
	const results: PrometheusMetric[] = [];
	const types = new Map<string, string>();
	const helps = new Map<string, string>();

	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;

		if (line.startsWith("# TYPE ")) {
			const rest = line.slice(7);
			const spaceIdx = rest.indexOf(" ");
			if (spaceIdx > 0) {
				types.set(rest.slice(0, spaceIdx), rest.slice(spaceIdx + 1).trim());
			}
			continue;
		}
		if (line.startsWith("# HELP ")) {
			const rest = line.slice(7);
			const spaceIdx = rest.indexOf(" ");
			if (spaceIdx > 0) {
				helps.set(rest.slice(0, spaceIdx), rest.slice(spaceIdx + 1).trim());
			}
			continue;
		}
		if (line.startsWith("#")) continue;

		// metric_name{label="value"} 123 timestamp?
		let name: string;
		let labels: Record<string, string> = {};
		let valueStr: string;
		let tsStr: string | undefined;

		const braceIdx = line.indexOf("{");
		if (braceIdx >= 0) {
			name = line.slice(0, braceIdx);
			const closeBrace = line.indexOf("}", braceIdx);
			if (closeBrace < 0) continue;
			const labelStr = line.slice(braceIdx + 1, closeBrace);
			labels = parsePrometheusLabels(labelStr);
			const after = line
				.slice(closeBrace + 1)
				.trim()
				.split(/\s+/);
			valueStr = after[0] ?? "";
			tsStr = after[1];
		} else {
			const parts = line.split(/\s+/);
			name = parts[0] ?? "";
			valueStr = parts[1] ?? "";
			tsStr = parts[2];
		}

		if (!name || !valueStr) continue;

		const baseName = name.replace(/(_total|_count|_sum|_bucket|_created|_info)$/, "");
		results.push({
			name,
			labels,
			value: Number(valueStr),
			timestampMs: tsStr ? Number(tsStr) : undefined,
			type: (types.get(baseName) ?? types.get(name)) as PrometheusMetric["type"],
			help: helps.get(baseName) ?? helps.get(name),
			timestampNs: wallClockNs(),
		});
	}

	return results;
}

function parsePrometheusLabels(str: string): Record<string, string> {
	const labels: Record<string, string> = {};
	const re = /(\w+)="((?:[^"\\]|\\.)*)"/g;
	let m: RegExpExecArray | null = re.exec(str);
	while (m !== null) {
		labels[m[1]] = m[2].replace(/\\(.)/g, "$1");
		m = re.exec(str);
	}
	return labels;
}
