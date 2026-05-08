import { describe, expect, it } from "vitest";
import { DATA, DIRTY } from "../../core/messages.js";
import { node } from "../../core/node.js";

/**
 * Loose perf smoke — parity with graphrefly-py `tests/test_perf_smoke.py` (roadmap 0.7).
 * Correctness always; wall-clock only when `CI` is unset (GitHub Actions sets `CI=true`).
 */
describe("perf smoke", () => {
	it("many sequential DIRTY+DATA updates: correctness; wall clock off CI", () => {
		const src = node<number>({ initial: 0 });
		const d = node(
			[src],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived" },
		);
		d.subscribe(() => undefined);
		const n = 40_000;
		const t0 = performance.now();
		for (let i = 0; i < n; i++) {
			src.down([[DIRTY], [DATA, i]]);
		}
		const elapsed = (performance.now() - t0) / 1000;
		expect(d.cache).toBe(n);
		if (process.env.CI) {
			return;
		}
		expect(elapsed).toBeLessThan(30);
	});
});
