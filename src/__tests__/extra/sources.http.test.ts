import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromHTTP } from "../../extra/sources.js";

describe("fromHTTP", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		global.fetch = vi.fn();
	});

	afterEach(() => {
		global.fetch = originalFetch;
		vi.useRealTimers();
	});

	it("fetches data and completes", async () => {
		const mockData = { foo: "bar" };
		(global.fetch as any).mockResolvedValue({
			ok: true,
			json: async () => mockData,
		});

		const bundle = fromHTTP("https://example.com");
		const unsub = bundle.node.subscribe(() => {});

		await vi.waitUntil(() => bundle.node.get() !== undefined);

		expect(bundle.node.get()).toEqual(mockData);
		expect(bundle.status.get()).toBe("completed");
		expect(bundle.fetchCount.get()).toBe(1);
		expect(bundle.lastUpdated.get()).toBeGreaterThan(0);
		expect(global.fetch).toHaveBeenCalledWith("https://example.com", expect.any(Object));
		unsub();
	});

	it("handles non-ok responses as ERROR", async () => {
		(global.fetch as any).mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
		});

		const bundle = fromHTTP("https://example.com");
		const unsub = bundle.node.subscribe(() => {});

		await vi.waitUntil(() => bundle.status.get() === "errored");

		expect(bundle.status.get()).toBe("errored");
		expect(bundle.error.get()).toBeInstanceOf(Error);
		expect((bundle.error.get() as Error).message).toContain("HTTP 404");
		unsub();
	});

	it("handles fetch rejection as ERROR", async () => {
		(global.fetch as any).mockRejectedValue(new Error("Network failure"));

		const bundle = fromHTTP("https://example.com");
		const unsub = bundle.node.subscribe(() => {});

		await vi.waitUntil(() => bundle.status.get() === "errored");

		expect(bundle.error.get()).toBeInstanceOf(Error);
		expect((bundle.error.get() as Error).message).toBe("Network failure");
		unsub();
	});
});
