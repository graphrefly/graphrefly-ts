/**
 * OpenTelemetry (OTLP/HTTP) IO — `fromOTel` exposes traces/metrics/logs as
 * three reactive nodes via `externalBundle`. The caller owns the HTTP server
 * and wires the registrar callback to OTLP routes.
 */

import { batch } from "../../core/batch.js";
import type { Node } from "../../core/node.js";
import { type BundleTriad, externalBundle } from "../external-register.js";
import type { ExtraOpts } from "./_internal.js";

/** Structured OTel span. */
export type OTelSpan = {
	traceId: string;
	spanId: string;
	operationName: string;
	serviceName: string;
	startTimeNs: number;
	endTimeNs: number;
	status: "OK" | "ERROR" | "UNSET";
	attributes: Record<string, unknown>;
	events: Array<{ name: string; timestampNs: number; attributes?: Record<string, unknown> }>;
};

/** Structured OTel metric data point. */
export type OTelMetric = {
	name: string;
	description?: string;
	unit?: string;
	type: "gauge" | "sum" | "histogram" | "summary";
	value: number;
	attributes: Record<string, unknown>;
	timestampNs: number;
};

/** Structured OTel log record. */
export type OTelLog = {
	timestampNs: number;
	severityNumber?: number;
	severityText?: string;
	body: unknown;
	attributes: Record<string, unknown>;
	traceId?: string;
	spanId?: string;
};

/** Registration callback for the OTLP/HTTP receiver. */
export type OTelRegister = (handlers: {
	onTraces: (spans: OTelSpan[]) => void;
	onMetrics: (metrics: OTelMetric[]) => void;
	onLogs: (logs: OTelLog[]) => void;
	onError: (err: unknown) => void;
}) => (() => void) | undefined;

/** Options for {@link fromOTel}. */
export type FromOTelOptions = ExtraOpts & {};

/** Bundle returned by {@link fromOTel}. */
export type OTelBundle = {
	traces: Node<OTelSpan>;
	metrics: Node<OTelMetric>;
	logs: Node<OTelLog>;
	/** Unconditional teardown — calls the registrar's cleanup and fires COMPLETE on every channel. */
	dispose(): void;
};

/**
 * OTLP/HTTP receiver — accepts traces, metrics, and logs as separate reactive nodes.
 *
 * The caller owns the HTTP server. `fromOTel` receives a `register` callback that
 * wires OTLP POST endpoints to the three signal handlers. Each signal type gets
 * its own `Node` so downstream can subscribe selectively.
 *
 * @param register - Wires OTLP HTTP routes to `onTraces`, `onMetrics`, `onLogs` handlers.
 * @param opts - Optional producer options.
 * @returns {@link OTelBundle} — `{ traces, metrics, logs }` nodes.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { fromOTel } from "@graphrefly/graphrefly-ts";
 *
 * const app = express();
 * app.use(express.json());
 *
 * const otel = fromOTel(({ onTraces, onMetrics, onLogs }) => {
 *   app.post("/v1/traces", (req, res) => { onTraces(req.body.resourceSpans ?? []); res.sendStatus(200); });
 *   app.post("/v1/metrics", (req, res) => { onMetrics(req.body.resourceMetrics ?? []); res.sendStatus(200); });
 *   app.post("/v1/logs", (req, res) => { onLogs(req.body.resourceLogs ?? []); res.sendStatus(200); });
 *   return () => {};
 * });
 * ```
 *
 * @category extra
 */
export function fromOTel(register: OTelRegister, opts?: FromOTelOptions): OTelBundle {
	type OTelChannels = { traces: OTelSpan; metrics: OTelMetric; logs: OTelLog };
	const nodes = externalBundle<OTelChannels>(
		({ traces, metrics, logs, error }: BundleTriad<OTelChannels>) => {
			return (
				register({
					onTraces: (spans) => {
						batch(() => {
							for (const s of spans) traces(s);
						});
					},
					onMetrics: (ms) => {
						batch(() => {
							for (const m of ms) metrics(m);
						});
					},
					onLogs: (ls) => {
						batch(() => {
							for (const l of ls) logs(l);
						});
					},
					onError: error,
				}) ?? undefined
			);
		},
		["traces", "metrics", "logs"],
		opts?.name ? { name: opts.name } : undefined,
	);
	return nodes;
}
