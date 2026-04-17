import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA } from "../../core/messages.js";
import { node } from "../../core/node.js";
import { fromHTTP, toHTTP } from "../../extra/adapters.js";

describe("fromHTTP", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		global.fetch = vi.fn();
	});

	afterEach(() => {
		global.fetch = originalFetch;
		vi.useRealTimers();
	});

	it("fetches data and caches it without completing (default)", async () => {
		const mockData = { foo: "bar" };
		(global.fetch as any).mockResolvedValue({
			ok: true,
			json: async () => mockData,
		});

		const bundle = fromHTTP("https://example.com");
		const unsub = bundle.node.subscribe(() => {});

		await vi.waitUntil(() => bundle.node.cache !== undefined);

		expect(bundle.node.cache).toEqual(mockData);
		// Default does NOT emit COMPLETE — node stays live so late subscribers
		// get the cached DATA via push-on-subscribe.
		expect(bundle.status.cache).toBe("active");
		expect(bundle.fetchCount.cache).toBe(1);
		expect(bundle.lastUpdated.cache).toBeGreaterThan(0);
		expect(global.fetch).toHaveBeenCalledWith("https://example.com", expect.any(Object));

		// Late subscriber receives cached DATA.
		const late: unknown[] = [];
		const unsubLate = bundle.node.subscribe((msgs) => {
			for (const m of msgs) if (String(m[0]) === "Symbol(graphrefly/DATA)") late.push(m[1]);
		});
		expect(late).toEqual([mockData]);
		expect(global.fetch).toHaveBeenCalledTimes(1); // no refetch
		unsubLate();
		unsub();
	});

	it("completeAfterFetch: true emits COMPLETE after first DATA", async () => {
		const mockData = { foo: "bar" };
		(global.fetch as any).mockResolvedValue({
			ok: true,
			json: async () => mockData,
		});

		const bundle = fromHTTP("https://example.com", { completeAfterFetch: true });
		const unsub = bundle.node.subscribe(() => {});
		await vi.waitUntil(() => bundle.status.cache === "completed");
		expect(bundle.node.cache).toEqual(mockData);
		expect(bundle.status.cache).toBe("completed");
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

describe("toHTTP", () => {
	const originalFetch = global.fetch;
	beforeEach(() => {
		global.fetch = vi.fn();
	});
	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("POSTs each DATA as a JSON body by default", async () => {
		(global.fetch as any).mockResolvedValue({
			ok: true,
			status: 200,
			arrayBuffer: async () => new ArrayBuffer(0),
		});
		const src = node<{ v: number }>();
		const handle = toHTTP(src, "https://example.com/ingest");
		src.down([[DATA, { v: 1 }]]);
		src.down([[DATA, { v: 2 }]]);
		await vi.waitFor(() => expect((global.fetch as any).mock.calls.length).toBe(2));
		const firstCall = (global.fetch as any).mock.calls[0];
		expect(firstCall[0]).toBe("https://example.com/ingest");
		expect(firstCall[1].method).toBe("POST");
		expect(firstCall[1].body).toBe(JSON.stringify({ v: 1 }));
		handle.dispose();
	});

	it("batches into a single JSON array request", async () => {
		(global.fetch as any).mockResolvedValue({
			ok: true,
			status: 200,
			arrayBuffer: async () => new ArrayBuffer(0),
		});
		const src = node<number>();
		const handle = toHTTP(src, "https://example.com/bulk", { batchSize: 3 });
		src.down([[DATA, 1]]);
		src.down([[DATA, 2]]);
		src.down([[DATA, 3]]);
		await vi.waitFor(() => expect((global.fetch as any).mock.calls.length).toBe(1));
		expect((global.fetch as any).mock.calls[0][1].body).toBe("[1,2,3]");
		handle.dispose();
	});

	it("surfaces non-ok responses as send errors", async () => {
		(global.fetch as any).mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Server Error",
		});
		const src = node<number>();
		const errs: unknown[] = [];
		const handle = toHTTP(src, "https://example.com/bad", {
			onTransportError: (e) => errs.push(e),
		});
		src.down([[DATA, 1]]);
		await vi.waitFor(() => expect(errs).toHaveLength(1));
		expect((errs[0] as { error: Error }).error.message).toContain("HTTP 500");
		handle.dispose();
	});
});
