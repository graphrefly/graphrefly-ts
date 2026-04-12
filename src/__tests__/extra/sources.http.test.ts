import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromHTTP } from "../../extra/adapters.js";

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

		await vi.waitUntil(() => bundle.node.cache !== undefined);

		expect(bundle.node.cache).toEqual(mockData);
		expect(bundle.status.cache).toBe("completed");
		expect(bundle.fetchCount.cache).toBe(1);
		expect(bundle.lastUpdated.cache).toBeGreaterThan(0);
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

		await vi.waitUntil(() => bundle.status.cache === "errored");

		expect(bundle.status.cache).toBe("errored");
		expect(bundle.error.cache).toBeInstanceOf(Error);
		expect((bundle.error.cache as Error).message).toContain("HTTP 404");
		unsub();
	});

	it("handles fetch rejection as ERROR", async () => {
		(global.fetch as any).mockRejectedValue(new Error("Network failure"));

		const bundle = fromHTTP("https://example.com");
		const unsub = bundle.node.subscribe(() => {});

		await vi.waitUntil(() => bundle.status.cache === "errored");

		expect(bundle.error.cache).toBeInstanceOf(Error);
		expect((bundle.error.cache as Error).message).toBe("Network failure");
		unsub();
	});
});
