import { describe, expect, it } from "vitest";
import { createRootEvalHttpTransportLeaf } from "../../evals/graph-native-rerun-avoidance/http-transport-leaf.js";
import { graph } from "../graph/graph.js";

const options = {
	endpoint: "https://example.invalid/api",
	maxExecutions: 2,
	timeoutMs: 10_000,
	maxResponseBytes: 100,
};
const summary = {
	status: 200,
	bodyBytes: 12,
	bodyRef: { kind: "response-digest", id: "digest-only" },
};

describe("D153 existing HTTP runtime leaf", () => {
	it("rejects a late 2xx after cancellation while retaining a factual HTTP error status", async () => {
		for (const status of [200, 429]) {
			const owner = graph();
			const leaf = createRootEvalHttpTransportLeaf<string>(owner, options);
			const cancellation = new AbortController();
			let finish!: () => void;
			const ready = new Promise<void>((resolve) => {
				finish = resolve;
			});
			const operation = leaf.run(
				`admission-${status}`,
				async () => {
					await ready;
					return { material: "body", summary: { ...summary, status } };
				},
				cancellation.signal,
			);
			const checked =
				status === 200
					? expect(operation).rejects.toThrow("cancelled")
					: expect(operation).resolves.toBe("body");
			cancellation.abort(new Error("cancelled"));
			finish();
			await checked;
			await leaf.dispose();
		}
	});
	it("runs explicit requests in the supplied Graph and exposes no transport material", async () => {
		const owner = graph();
		const leaf = createRootEvalHttpTransportLeaf<string>(owner, options);
		const events: unknown[] = [];
		const stop = owner.observe().subscribe((event) => events.push(event));
		try {
			expect(
				await leaf.run(
					"admission-1",
					async () => ({ material: "private-response-token", summary }),
					new AbortController().signal,
				),
			).toBe("private-response-token");
			expect(JSON.stringify(events)).not.toContain("private-response-token");
			expect(JSON.stringify(events)).toContain("http-result");
			expect(
				owner
					.describe()
					.nodes.some((node) => node.id === "eval/executor/provider-http/runs/requests"),
			).toBe(true);
			await expect(
				leaf.run(
					"admission-1",
					async () => ({ material: "duplicate", summary }),
					new AbortController().signal,
				),
			).rejects.toThrow("replay");
			await leaf.run(
				"admission-2",
				async () => ({ material: "second", summary }),
				new AbortController().signal,
			);
			await expect(
				leaf.run(
					"admission-3",
					async () => ({ material: "overflow", summary }),
					new AbortController().signal,
				),
			).rejects.toThrow("capacity");
		} finally {
			await leaf.dispose();
			stop();
		}
	});
	it("keeps the original failure private and waits for cancellation settlement before disposing", async () => {
		const owner = graph();
		const leaf = createRootEvalHttpTransportLeaf<string>(owner, options);
		const events: unknown[] = [];
		const stop = owner.observe().subscribe((event) => events.push(event));
		const cancellation = new AbortController();
		const privateError = new Error("secret request payload");
		let started!: () => void;
		const start = new Promise<void>((resolve) => {
			started = resolve;
		});
		const result = leaf.run(
			"admission-1",
			async (signal) => {
				started();
				return await new Promise<never>((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(privateError), { once: true }),
				);
			},
			cancellation.signal,
		);
		const rejected = expect(result).rejects.toBe(privateError);
		await start;
		let disposed = false;
		const disposal = leaf.dispose().then(() => {
			disposed = true;
		});
		await Promise.resolve();
		expect(disposed).toBe(false);
		cancellation.abort();
		await rejected;
		await disposal;
		expect(JSON.stringify(events)).not.toContain("secret request payload");
		stop();
	});
});
