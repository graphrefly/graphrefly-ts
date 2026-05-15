/**
 * StatsD / DogStatsD IO — `fromStatsD` registrar-based source plus
 * `parseStatsD` helper for the line format. The caller owns the UDP socket;
 * the adapter only wires the `emit` triad.
 */

import { wallClockNs } from "@graphrefly/pure-ts/core/clock.js";
import type { Node } from "@graphrefly/pure-ts/core/node.js";
import {
	type EmitTriad,
	type ExternalRegister,
	externalProducer,
} from "../composition/external-register.js";
import type { ExtraOpts } from "./_internal.js";

/** Parsed StatsD metric. */
export type StatsDMetric = {
	name: string;
	value: number;
	type: "counter" | "gauge" | "timer" | "histogram" | "set" | "distribution";
	sampleRate?: number;
	tags: Record<string, string>;
	timestampNs: number;
};

/** Registration callback for StatsD receiver. Alias of {@link ExternalRegister} over {@link EmitTriad}. */
export type StatsDRegister = ExternalRegister<EmitTriad<StatsDMetric>>;

/** Options for {@link fromStatsD}. */
export type FromStatsDOptions = ExtraOpts & {};

/**
 * StatsD/DogStatsD UDP receiver as a reactive source.
 *
 * The caller owns the UDP socket. `fromStatsD` receives a `register` callback
 * that wires datagrams to the `emit` handler with parsed metrics.
 *
 * @param register - Wires socket to emit/error/complete handlers.
 * @param opts - Optional producer options.
 * @returns `Node<StatsDMetric>` — one `DATA` per metric line.
 *
 * @example
 * ```ts
 * import dgram from "node:dgram";
 * import { fromStatsD, parseStatsD } from "@graphrefly/graphrefly-ts";
 *
 * const server = dgram.createSocket("udp4");
 * const stats$ = fromStatsD(({ emit, error }) => {
 *   server.on("message", (buf) => {
 *     for (const line of buf.toString().split("\\n")) {
 *       if (line.trim()) {
 *         try { emit(parseStatsD(line)); }
 *         catch (e) { error(e); }
 *       }
 *     }
 *   });
 *   server.bind(8125);
 *   return () => server.close();
 * });
 * ```
 *
 * @category extra
 */
export function fromStatsD(register: StatsDRegister, opts?: FromStatsDOptions): Node<StatsDMetric> {
	return externalProducer<StatsDMetric>(register, opts);
}

const STATSD_TYPES: Record<string, StatsDMetric["type"]> = {
	c: "counter",
	g: "gauge",
	ms: "timer",
	h: "histogram",
	s: "set",
	d: "distribution",
};

/**
 * Parses a raw StatsD/DogStatsD line into a structured {@link StatsDMetric}.
 *
 * Format: `metric.name:value|type|@sampleRate|#tag1:val1,tag2:val2`
 *
 * @category extra
 */
export function parseStatsD(line: string): StatsDMetric {
	const parts = line.split("|");
	const [name, valueStr] = (parts[0] ?? "").split(":");
	if (!name || valueStr === undefined) {
		throw new Error(`Invalid StatsD line: ${line}`);
	}
	const typeCode = parts[1]?.trim() ?? "c";
	const type = STATSD_TYPES[typeCode] ?? "counter";
	// Set type uses string identifiers (e.g. unique user IDs), not numeric values.
	const value = type === "set" ? 0 : Number(valueStr);

	let sampleRate: number | undefined;
	const tags: Record<string, string> = {};

	for (let i = 2; i < parts.length; i++) {
		const part = parts[i].trim();
		if (part.startsWith("@")) {
			sampleRate = Number(part.slice(1));
		} else if (part.startsWith("#")) {
			for (const tag of part.slice(1).split(",")) {
				const [k, v] = tag.split(":");
				if (k) tags[k] = v ?? "";
			}
		}
	}

	return { name: name.trim(), value, type, sampleRate, tags, timestampNs: wallClockNs() };
}
