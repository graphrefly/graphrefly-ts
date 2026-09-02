import { describe, expect, it } from "vitest";
import { createPrivateDiagnosticSink } from "../../evals/graph-native-rerun-avoidance/private-diagnostic-sink.js";

describe("D153 optional diagnostic I/O isolation", () => {
	it("does not throw a synchronous or asynchronous writer failure into an effect", async () => {
		for (const write of [
			() => {
				throw new Error("private failure");
			},
			async () => {
				throw new Error("private failure");
			},
		]) {
			const sink = createPrivateDiagnosticSink({ maxPending: 1, write });
			expect(() => sink.write("result")).not.toThrow();
			await sink.drain(new AbortController().signal);
			expect(sink.status()).toEqual({ persisted: 0, failed: 1, dropped: 0, pending: 0 });
		}
	});
	it("bounds pending material and cancels diagnostic drain without holding critical cleanup", async () => {
		let writerSignal: AbortSignal | undefined;
		const sink = createPrivateDiagnosticSink({
			maxPending: 1,
			write: async (_: string, signal) => {
				writerSignal = signal;
				await new Promise<void>((resolve) =>
					signal.addEventListener("abort", () => resolve(), { once: true }),
				);
			},
		});
		sink.write("first");
		sink.write("overflow");
		const cancellation = new AbortController();
		const drained = sink.drain(cancellation.signal);
		await Promise.resolve();
		cancellation.abort();
		await drained;
		expect(writerSignal?.aborted).toBe(true);
		expect(sink.status().dropped).toBe(1);
		sink.write("closed");
		expect(sink.status().dropped).toBe(2);
	});
});
