/**
 * Runs every canonical operator trace of the pinned root commit against the TS operators and
 * writes the package's report (graphrefly-ts:D191 (6), operators/README.md "Running the traces in
 * a package"). Run with `pnpm --filter @graphrefly/ts run traces:report`; not part of `pnpm test`.
 *
 * The traces are read from the sibling root checkout (or GRAPHREFLY_ROOT) and must match the pinned
 * digest: a missing or different file fails closed. The clock is vitest's fake timers, installed
 * per trace, so no time passes for the operators but by an `advance` step.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import {
	CONTRACT_OPERATORS,
	NOT_SHIPPED,
	NOT_THE_CONTRACTS,
	runTrace,
	type Trace,
	type TraceResult,
} from "./runner.js";

declare const __GRAPHREFLY_TS_PACKAGE_REVISION__: string;

const packageRoot = resolve(import.meta.dirname, "../../..");
const pinPath = resolve(packageRoot, "qualification/operator-traces/pin.json");
const reportPath = resolve(packageRoot, "qualification/operator-traces/report.json");
const pin = JSON.parse(readFileSync(pinPath, "utf8")) as {
	readonly rootCommit: string;
	readonly tracesSha256: string;
};
const root = process.env.GRAPHREFLY_ROOT ?? resolve(packageRoot, "../../../graphrefly");
const tracesPath = resolve(root, "operators/traces.jsonl");

const raw = readFileSync(tracesPath);
const digest = createHash("sha256").update(raw).digest("hex");
if (digest !== pin.tracesSha256) {
	throw new Error(
		`operator traces: ${tracesPath} has sha256 ${digest}, not the pinned ${pin.tracesSha256} (root ${pin.rootCommit})`,
	);
}
const traces = raw
	.toString("utf8")
	.split("\n")
	.filter((line) => line.trim() !== "")
	.map((line) => JSON.parse(line) as Trace)
	.filter((trace) => trace.succeeded_by === undefined);

const results: TraceResult[] = [];

for (const trace of traces) {
	it(`${trace.id} ${trace.name}`, async () => {
		vi.useFakeTimers();
		try {
			results.push(await runTrace(trace));
		} finally {
			vi.clearAllTimers();
			vi.useRealTimers();
		}
	});
}

afterAll(() => {
	expect(results.length).toBe(traces.length);
	const count = (pred: (r: TraceResult) => boolean) => results.filter(pred).length;
	const byClass: Record<string, number> = {};
	for (const r of results) if (r.result === "fail") byClass[r.class] = (byClass[r.class] ?? 0) + 1;
	const report = {
		format: "graphrefly-ts.operator-trace-report.v1",
		rootCommit: pin.rootCommit,
		tracesSha256: pin.tracesSha256,
		packageRevision: __GRAPHREFLY_TS_PACKAGE_REVISION__,
		sourceRevision: process.env.GRAPHREFLY_TS_SOURCE_REVISION ?? "working tree",
		clock: "vitest fake timers (vi.useFakeTimers), advanced only by advance steps",
		baseline:
			"Phase 0 of graphrefly-ts:D817-KERNEL-REPORT-TS, on the kernel before its re-port: failures are classified, not diagnosed",
		ships: CONTRACT_OPERATORS.filter((op) => NOT_SHIPPED[op] === undefined),
		notShipped: NOT_SHIPPED,
		notTheContracts: NOT_THE_CONTRACTS,
		summary: {
			traces: results.length,
			pass: count((r) => r.result === "pass"),
			fail: count((r) => r.result === "fail"),
			notRun: count((r) => r.result === "not-run"),
			failByClass: byClass,
		},
		results: [...results].sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3))),
	};
	writeFileSync(reportPath, `${JSON.stringify(report, null, "\t")}\n`);
});
