import { firstValueFrom } from "@graphrefly/pure-ts/extra";
import { describe, expect, it } from "vitest";
import { observableAdapter } from "../../../../patterns/ai/adapters/core/observable.js";
import { dryRunAdapter } from "../../../../patterns/ai/adapters/providers/dry-run.js";

describe("observableAdapter", () => {
	it("records invoke calls to allCalls + totals", async () => {
		const inner = dryRunAdapter({ respond: () => "abcdefghij" });
		const { adapter, stats } = observableAdapter(inner);
		await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(stats.totalCalls.cache).toBe(2);
		expect(stats.totalInputTokens.cache).toBeGreaterThan(0);
		expect(stats.totalOutputTokens.cache).toBeGreaterThan(0);
		expect(stats.allCalls.size).toBe(2);
	});

	it("lastCall emits null initially, then the event after invoke", async () => {
		const inner = dryRunAdapter();
		const { adapter, stats } = observableAdapter(inner);
		// First subscribe gets push-on-subscribe with null.
		expect(await firstValueFrom(stats.lastCall)).toBeNull();
		// Kick the call and wait for the next event.
		await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		const ev = stats.lastCall.cache;
		expect(ev).not.toBeNull();
		expect(ev?.provider).toBe("dry-run");
		expect(ev?.method).toBe("invoke");
	});

	it("reset clears log and counters", async () => {
		const inner = dryRunAdapter();
		const { adapter, stats } = observableAdapter(inner);
		await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(stats.totalCalls.cache).toBe(1);
		stats.reset();
		expect(stats.totalCalls.cache).toBe(0);
		expect(stats.allCalls.size).toBe(0);
	});

	it("streaming records usage from terminal usage delta", async () => {
		const inner = dryRunAdapter({ respond: () => "hello" });
		const { adapter, stats } = observableAdapter(inner);
		for await (const _d of adapter.stream([{ role: "user", content: "x" }])) {
			/* drain */
		}
		expect(stats.totalCalls.cache).toBe(1);
		const last = stats.allCalls.at(0);
		expect(last?.method).toBe("stream");
		expect(last?.usage.output.regular).toBeGreaterThan(0);
	});
});
