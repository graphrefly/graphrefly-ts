/**
 * Tests for reactiveSink factory (src/extra/reactive-sink.ts).
 */

import { COMPLETE, DATA, ERROR, type Messages } from "@graphrefly/pure-ts/core";
import { node } from "@graphrefly/pure-ts/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Helper: SENTINEL source that never pushes on subscribe but supports .down().
function makeSrc<T>(): { src: import("../../core/node.js").Node<T>; emit: (v: T) => void } {
	const src = node<T>();
	return { src, emit: (v: T) => src.down([[DATA, v]]) };
}

import { reactiveSink, type SinkFailure, type SinkTransportError } from "../../../base/io/_sink.js";
import { constant, NS_PER_MS } from "../../../utils/resilience/backoff.js";

type CompanionSnap = {
	sent: unknown[];
	failed: Array<SinkFailure<unknown>>;
	inFlight: number[];
	errors: SinkTransportError[];
	buffered: number[];
	paused: boolean[];
};

function snapCompanions(handle: {
	sent: { subscribe: (s: (m: Messages) => void) => () => void };
	failed: { subscribe: (s: (m: Messages) => void) => () => void };
	inFlight: { subscribe: (s: (m: Messages) => void) => () => void };
	errors: { subscribe: (s: (m: Messages) => void) => () => void };
	buffered?: { subscribe: (s: (m: Messages) => void) => () => void };
	paused?: { subscribe: (s: (m: Messages) => void) => () => void };
}): { snap: CompanionSnap; unsub: () => void } {
	const snap: CompanionSnap = {
		sent: [],
		failed: [],
		inFlight: [],
		errors: [],
		buffered: [],
		paused: [],
	};
	const unsubs: Array<() => void> = [];
	const sub = <K extends keyof CompanionSnap>(
		node: { subscribe: (s: (m: Messages) => void) => () => void } | undefined,
		key: K,
		transform: (v: unknown) => CompanionSnap[K][number] | undefined,
	) => {
		if (!node) return;
		unsubs.push(
			node.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						const v = transform(m[1]);
						if (v !== undefined) (snap[key] as unknown[]).push(v);
					}
				}
			}),
		);
	};
	sub(handle.sent, "sent", (v) => v);
	sub(handle.failed, "failed", (v) => (v == null ? undefined : (v as SinkFailure<unknown>)));
	sub(handle.inFlight, "inFlight", (v) => v as number);
	sub(handle.errors, "errors", (v) => (v == null ? undefined : (v as SinkTransportError)));
	sub(handle.buffered, "buffered", (v) => v as number);
	sub(handle.paused, "paused", (v) => v as boolean);
	return {
		snap,
		unsub: () => {
			for (const u of unsubs) u();
		},
	};
}

describe("reactiveSink — per-record write-through", () => {
	afterEach(() => vi.useRealTimers());

	it("forwards DATA to send(), populates sent/inFlight companions", async () => {
		const { src, emit } = makeSrc<number>();
		const received: number[] = [];
		const h = reactiveSink<number>(src, {
			send: (v) => {
				received.push(v);
			},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		emit(2);
		await vi.waitFor(() => expect(received).toEqual([1, 2]));
		expect(snap.sent).toEqual([1, 2]);
		// inFlight goes +1 -1 per send, so end-state is 0
		expect(snap.inFlight.at(-1)).toBe(0);
		unsub();
		h.dispose();
	});

	it("reports send() rejection on errors + failed (maxAttempts=1)", async () => {
		const { src, emit } = makeSrc<number>();
		const err = new Error("boom");
		const h = reactiveSink<number>(src, {
			send: () => Promise.reject(err),
		});
		const { snap, unsub } = snapCompanions(h);

		emit(99);
		await vi.waitFor(() => expect(snap.errors).toHaveLength(1));
		expect(snap.errors[0].stage).toBe("send");
		expect(snap.errors[0].error.message).toBe("boom");
		expect(snap.errors[0].value).toBe(99);
		expect(snap.failed).toHaveLength(1);
		expect(snap.failed[0].attempts).toBe(1);
		expect(snap.sent).toEqual([]);
		unsub();
		h.dispose();
	});

	it("retries per-record up to maxAttempts, then fails", async () => {
		vi.useFakeTimers();
		const { src, emit } = makeSrc<number>();
		let attempts = 0;
		const h = reactiveSink<number>(src, {
			retry: { maxAttempts: 3, backoff: constant(10 * NS_PER_MS) },
			send: () => {
				attempts += 1;
				return Promise.reject(new Error(`fail-${attempts}`));
			},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		await vi.advanceTimersByTimeAsync(50);
		expect(attempts).toBe(3);
		expect(snap.errors).toHaveLength(3);
		expect(snap.failed).toHaveLength(1);
		expect(snap.failed[0].attempts).toBe(3);
		unsub();
		h.dispose();
	});

	it("retries per-record and succeeds before exhaustion", async () => {
		vi.useFakeTimers();
		const { src, emit } = makeSrc<number>();
		let attempts = 0;
		const h = reactiveSink<number>(src, {
			retry: { maxAttempts: 3, backoff: constant(0) },
			send: () => {
				attempts += 1;
				if (attempts < 2) return Promise.reject(new Error("once"));
				return Promise.resolve();
			},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(7);
		await vi.advanceTimersByTimeAsync(10);
		expect(attempts).toBe(2);
		expect(snap.sent).toEqual([7]);
		expect(snap.failed).toEqual([]);
		unsub();
		h.dispose();
	});

	it("shouldRetry=false stops retries early", async () => {
		vi.useFakeTimers();
		const { src, emit } = makeSrc<number>();
		let attempts = 0;
		const h = reactiveSink<number>(src, {
			retry: {
				maxAttempts: 5,
				backoff: constant(0),
				shouldRetry: (err) => !/non-retryable/.test(err.message),
			},
			send: () => {
				attempts += 1;
				return Promise.reject(new Error("non-retryable"));
			},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		await vi.advanceTimersByTimeAsync(10);
		expect(attempts).toBe(1);
		expect(snap.failed[0].attempts).toBe(1);
		unsub();
		h.dispose();
	});

	it("serialize transforms value before send", async () => {
		const { src, emit } = makeSrc<number>();
		const received: unknown[] = [];
		const h = reactiveSink<number>(src, {
			serialize: (v) => `v=${v}`,
			send: (payload) => {
				received.push(payload);
			},
		});
		const { unsub } = snapCompanions(h);

		emit(5);
		await vi.waitFor(() => expect(received).toEqual(["v=5"]));
		unsub();
		h.dispose();
	});

	it("onTransportError hook fires alongside errors companion", async () => {
		const { src, emit } = makeSrc<number>();
		const hookErrs: SinkTransportError[] = [];
		const h = reactiveSink<number>(src, {
			onTransportError: (e) => hookErrs.push(e),
			send: () => Promise.reject(new Error("x")),
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		await vi.waitFor(() => expect(hookErrs).toHaveLength(1));
		expect(hookErrs[0].stage).toBe("send");
		expect(snap.errors).toHaveLength(1);
		unsub();
		h.dispose();
	});

	it("dispose fires TEARDOWN on companions", () => {
		const { src } = makeSrc<number>();
		const h = reactiveSink<number>(src, {
			send: () => {},
		});
		// Subscribe raw to capture TEARDOWN tuples
		const received: unknown[] = [];
		const unsub = h.errors.subscribe((msgs) => {
			for (const m of msgs) received.push(String(m[0]));
		});
		h.dispose();
		expect(received).toContain("Symbol(graphrefly/TEARDOWN)");
		unsub();
	});
});

describe("reactiveSink — buffered via sendBatch", () => {
	afterEach(() => vi.useRealTimers());

	it("flushes on batchSize and delivers chunks to sendBatch", async () => {
		const { src, emit } = makeSrc<number>();
		const chunks: number[][] = [];
		const h = reactiveSink<number>(src, {
			batchSize: 3,
			sendBatch: (chunk) => {
				chunks.push([...chunk]);
			},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		emit(2);
		expect(chunks).toEqual([]);
		emit(3);
		await vi.waitFor(() => expect(chunks).toEqual([[1, 2, 3]]));
		expect(snap.sent).toEqual([1, 2, 3]);
		unsub();
		h.dispose();
	});

	it("flushes on flushIntervalMs timer", async () => {
		vi.useFakeTimers();
		const { src, emit } = makeSrc<number>();
		const chunks: number[][] = [];
		const h = reactiveSink<number>(src, {
			flushIntervalMs: 100,
			sendBatch: (chunk) => {
				chunks.push([...chunk]);
			},
		});
		const { unsub } = snapCompanions(h);

		emit(1);
		emit(2);
		expect(chunks).toEqual([]);
		await vi.advanceTimersByTimeAsync(150);
		expect(chunks).toEqual([[1, 2]]);
		unsub();
		h.dispose();
	});

	it("flushes on tier-3 terminal (COMPLETE)", async () => {
		const chunks: number[][] = [];
		const src = node<number>(
			[],
			(_data, a) => {
				a.emit(1);
				a.emit(2);
				a.down([[COMPLETE]]);
			},
			{ describeKind: "producer" },
		);
		const h = reactiveSink<number>(src, {
			batchSize: 100,
			flushIntervalMs: 10_000,
			sendBatch: (chunk) => {
				chunks.push([...chunk]);
			},
		});
		const { unsub } = snapCompanions(h);
		await vi.waitFor(() => expect(chunks).toEqual([[1, 2]]));
		unsub();
		h.dispose();
	});

	it("buffered companion tracks buffer length", async () => {
		const { src, emit } = makeSrc<number>();
		const h = reactiveSink<number>(src, {
			batchSize: 10,
			flushIntervalMs: 1_000,
			sendBatch: () => {},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		emit(2);
		emit(3);
		// buffered emits after each push; last value is 3 (or 0 after flush)
		expect(snap.buffered).toContain(1);
		expect(snap.buffered).toContain(2);
		expect(snap.buffered).toContain(3);
		unsub();
		h.dispose();
	});

	it("flush() drains pending buffer and awaits in-flight", async () => {
		const { src, emit } = makeSrc<number>();
		const chunks: number[][] = [];
		let resolveSend!: () => void;
		const h = reactiveSink<number>(src, {
			batchSize: 100,
			flushIntervalMs: 10_000,
			sendBatch: (chunk) =>
				new Promise<void>((r) => {
					chunks.push([...chunk]);
					resolveSend = r;
				}),
		});
		const { unsub } = snapCompanions(h);
		emit(1);
		emit(2);
		expect(chunks).toEqual([]);

		const flushP = h.flush?.();
		// flush is async — body defers to microtask, so wait one tick before
		// asserting the sync `chunks.push(...)` inside sendBatch has fired.
		await Promise.resolve();
		expect(chunks).toEqual([[1, 2]]);
		resolveSend();
		await flushP;
		unsub();
		h.dispose();
	});

	it("retries whole batch on sendBatch rejection", async () => {
		vi.useFakeTimers();
		const { src, emit } = makeSrc<number>();
		let calls = 0;
		const h = reactiveSink<number>(src, {
			batchSize: 2,
			retry: { maxAttempts: 3, backoff: constant(0) },
			sendBatch: () => {
				calls += 1;
				if (calls < 2) return Promise.reject(new Error("boom"));
				return Promise.resolve();
			},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		emit(2);
		await vi.advanceTimersByTimeAsync(10);
		expect(calls).toBe(2);
		expect(snap.sent).toEqual([1, 2]);
		unsub();
		h.dispose();
	});
});

describe("reactiveSink — backpressure", () => {
	afterEach(() => vi.useRealTimers());

	it("drop-oldest strategy drops oldest items at maxBuffer", async () => {
		const { src, emit } = makeSrc<number>();
		const chunks: number[][] = [];
		const h = reactiveSink<number>(src, {
			batchSize: 100,
			flushIntervalMs: 10_000,
			backpressure: { maxBuffer: 2, strategy: "drop-oldest" },
			sendBatch: (chunk) => {
				chunks.push([...chunk]);
			},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		emit(2);
		emit(3); // overflow — drops 1
		emit(4); // overflow — drops 2

		// Assert paused transitioned to true while overflowing (before flush
		// drains the buffer and flips it back to false).
		expect(snap.paused).toContain(true);
		await h.flush?.();
		expect(chunks).toEqual([[3, 4]]);
		expect(snap.failed.map((f) => f.value)).toEqual([1, 2]);
		expect(snap.failed.every((f) => /dropped oldest/.test(f.error.message))).toBe(true);
		unsub();
		h.dispose();
	});

	it("drop-newest strategy rejects incoming items at maxBuffer", async () => {
		const { src, emit } = makeSrc<number>();
		const chunks: number[][] = [];
		const h = reactiveSink<number>(src, {
			batchSize: 100,
			flushIntervalMs: 10_000,
			backpressure: { maxBuffer: 2, strategy: "drop-newest" },
			sendBatch: (chunk) => {
				chunks.push([...chunk]);
			},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		emit(2);
		emit(3); // overflow — drops 3
		emit(4); // overflow — drops 4

		await h.flush?.();
		expect(chunks).toEqual([[1, 2]]);
		expect(snap.failed.map((f) => f.value)).toEqual([3, 4]);
		unsub();
		h.dispose();
	});

	it("error strategy emits ERROR via errors companion on overflow", async () => {
		const { src, emit } = makeSrc<number>();
		const h = reactiveSink<number>(src, {
			batchSize: 100,
			flushIntervalMs: 10_000,
			backpressure: { maxBuffer: 1, strategy: "error" },
			sendBatch: () => {},
		});
		const { snap, unsub } = snapCompanions(h);

		emit(1);
		emit(2); // overflow

		expect(snap.errors).toHaveLength(1);
		expect(snap.errors[0].error.message).toMatch(/buffer overflow/);
		expect(snap.failed.map((f) => f.value)).toEqual([2]);
		unsub();
		h.dispose();
	});
});

describe("reactiveSink — validation", () => {
	it("throws without send or sendBatch", () => {
		const { src } = makeSrc<number>();
		expect(() => reactiveSink<number>(src, {} as never)).toThrow(/send.*sendBatch/);
	});
});

// ERROR import keeps test compiling without unused-var warning even when the
// matrix grows — referenced here to preserve the symbol.
void ERROR;
