import { describe, expect, it } from "vitest";
import { dryRunAdapter } from "../../../../utils/ai/adapters/providers/dry-run.js";

describe("DryRunAdapter", () => {
	it("echoes last user message by default", async () => {
		const adapter = dryRunAdapter();
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hello world" }]));
		expect(resp.content).toMatch(/hello world/);
		expect(resp.usage.input.regular).toBeGreaterThan(0);
		expect(resp.usage.output.regular).toBeGreaterThan(0);
	});

	it("honors custom respond fn", async () => {
		const adapter = dryRunAdapter({ respond: () => "scripted" });
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "anything" }]));
		expect(resp.content).toBe("scripted");
	});

	it("streams tokens + terminal usage + finish", async () => {
		const adapter = dryRunAdapter({ respond: () => "abcdef", streamChunkSize: 2 });
		const deltas: unknown[] = [];
		for await (const d of adapter.stream([{ role: "user", content: "x" }])) {
			deltas.push(d);
		}
		const tokens = deltas.filter((d) => (d as { type: string }).type === "token");
		const usage = deltas.find((d) => (d as { type: string }).type === "usage");
		const finish = deltas.find((d) => (d as { type: string }).type === "finish");
		expect(tokens.length).toBe(3); // "ab" "cd" "ef"
		expect(usage).toBeDefined();
		expect(finish).toBeDefined();
	});
});
