import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED } from "../../core/messages.js";
import { producer, state } from "../../core/sugar.js";
import { fromMCP, fromWebhook, fromWebSocket, toSSE, toWebSocket } from "../../extra/adapters.js";
import { parseCron } from "../../extra/cron.js";
import { fromGitHook } from "../../extra/git-hook.js";
import { valve } from "../../extra/operators.js";
import {
	awaitSettled,
	cached,
	empty,
	firstValueFrom,
	firstWhere,
	forEach,
	fromAny,
	fromAsyncIter,
	fromCron,
	fromEvent,
	fromIter,
	fromPromise,
	fromRaf,
	fromTimer,
	never,
	of,
	replay,
	share,
	throwError,
	toArray,
} from "../../extra/sources.js";
import { fromFSWatch } from "../../extra/sources-fs.js";
import { collect } from "../test-helpers.js";

/** Next macrotick (GraphReFly + Vitest: do not use `vi.waitFor` with a sync boolean — it resolves immediately). */
function tick(ms = 0): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function readSSE(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let out = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		out += decoder.decode(value, { stream: true });
	}
	out += decoder.decode();
	return out;
}

describe("extra sources & sinks (roadmap §2.3)", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("fromTimer emits then completes", async () => {
		const n = fromTimer(15);
		const { batches, unsub } = collect(n);
		await tick(50);
		const data = batches.flat().filter((m) => m[0] === DATA);
		expect(data.length).toBeGreaterThanOrEqual(1);
		expect(data[0]?.[1]).toBe(0);
		expect(batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		unsub();
	});

	it("fromTimer periodic mode", async () => {
		vi.useFakeTimers();
		const n = fromTimer(10, { period: 5 });
		const { batches, unsub } = collect(n);
		vi.advanceTimersByTime(10);
		const d0 = batches.flat().filter((m) => m[0] === DATA);
		expect(d0.map((m) => m[1])).toContain(0);
		vi.advanceTimersByTime(5);
		const d1 = batches.flat().filter((m) => m[0] === DATA);
		expect(d1.map((m) => m[1])).toContain(1);
		vi.advanceTimersByTime(5);
		const d2 = batches.flat().filter((m) => m[0] === DATA);
		expect(d2.map((m) => m[1])).toContain(2);
		// Should NOT have completed
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(false);
		unsub();
	});

	it("fromRaf emits frame timestamps while subscribed", async () => {
		const n = fromRaf();
		const { batches, unsub } = collect(n);
		// rAF fires at display refresh; give it a few frames.
		await tick(120);
		const data = batches.flat().filter((m) => m[0] === DATA);
		expect(data.length).toBeGreaterThanOrEqual(2);
		// Timestamps monotonically non-decreasing.
		for (let i = 1; i < data.length; i++) {
			expect((data[i]![1] as number) >= (data[i - 1]![1] as number)).toBe(true);
		}
		unsub();
	});

	it("fromRaf stops emitting after unsubscribe", async () => {
		const n = fromRaf();
		const { batches, unsub } = collect(n);
		await tick(60);
		unsub();
		const countAfterUnsub = batches.flat().filter((m) => m[0] === DATA).length;
		await tick(120);
		const countLater = batches.flat().filter((m) => m[0] === DATA).length;
		expect(countLater).toBe(countAfterUnsub);
	});

	it("fromRaf aborts with ERROR via signal", async () => {
		const ac = new AbortController();
		const n = fromRaf({ signal: ac.signal });
		const { batches, unsub } = collect(n);
		await tick(30);
		ac.abort(new Error("raf-abort"));
		expect(
			batches.some((b) => b.some((m) => m[0] === ERROR && (m[1] as Error).message === "raf-abort")),
		).toBe(true);
		unsub();
	});

	it("fromTimer aborts with ERROR", () => {
		vi.useFakeTimers();
		const ac = new AbortController();
		const n = fromTimer(1000, { signal: ac.signal });
		const { batches, unsub } = collect(n);
		ac.abort(new Error("x"));
		expect(batches.some((b) => b.some((m) => m[0] === ERROR))).toBe(true);
		unsub();
	});

	it("fromIter / of", () => {
		const a = collect(fromIter([10, 20]));
		// No post-terminal replay — terminal guard blocks push-on-subscribe (§1.3.4)
		expect(
			a.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([10, 20]);
		expect(a.batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		a.unsub();

		const b = collect(of(1, 2, 3));
		expect(
			b.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([1, 2, 3]);
		b.unsub();
	});

	it("fromIter with throwing iterator emits ERROR", () => {
		function* badIter() {
			yield 1;
			throw new Error("iter-boom");
		}
		const { batches, unsub } = collect(fromIter(badIter()));
		expect(batches.flat().some((m) => m[0] === DATA && m[1] === 1)).toBe(true);
		expect(
			batches.flat().some((m) => m[0] === ERROR && (m[1] as Error).message === "iter-boom"),
		).toBe(true);
		unsub();
	});

	it("empty / never / throwError", () => {
		const e = collect(empty());
		expect(e.batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		expect(e.batches.flat().some((m) => m[0] === DATA)).toBe(false);
		e.unsub();

		const n = collect(never());
		expect(n.batches.length).toBe(0);
		n.unsub();

		const t = collect(throwError("boom"));
		expect(t.batches.some((b) => b.some((m) => m[0] === ERROR && m[1] === "boom"))).toBe(true);
		t.unsub();
	});

	it("fromPromise", async () => {
		const ok = collect(fromPromise(Promise.resolve(7)));
		await tick(0);
		expect(ok.batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		expect(ok.batches.flat().find((m) => m[0] === DATA)?.[1]).toBe(7);
		ok.unsub();

		const bad = collect(fromPromise(Promise.reject(new Error("no"))));
		await tick(0);
		expect(bad.batches.some((b) => b.some((m) => m[0] === ERROR))).toBe(true);
		bad.unsub();
	});

	it("fromAny dispatches iterable", () => {
		const a = collect(fromAny([1, 2]));
		// No post-terminal replay — terminal guard blocks push-on-subscribe
		expect(
			a.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([1, 2]);
		a.unsub();
	});

	it("fromAny with scalar fallback", () => {
		const a = collect(fromAny(42));
		expect(
			a.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([42]);
		a.unsub();
	});

	it("fromAny handles null/undefined as scalar values", () => {
		const a = collect(fromAny(null));
		expect(
			a.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([null]);
		a.unsub();

		const b = collect(fromAny(undefined));
		expect(b.batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
		expect(b.batches.flat().some((m) => m[0] === ERROR)).toBe(false);
		b.unsub();
	});

	it("fromAny with existing Node returns same reference", () => {
		const s = state(99);
		const result = fromAny(s);
		expect(result).toBe(s);
	});

	it("fromAsyncIter", async () => {
		async function* gen() {
			yield 1;
			yield 2;
		}
		const { batches, unsub } = collect(fromAsyncIter(gen()));
		await tick(0);
		expect(
			batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([1, 2]);
		unsub();
	});

	it("toArray", () => {
		const src = fromIter(["a", "b"]);
		const { batches, unsub } = collect(toArray(src));
		const data = batches.flat().filter((m) => m[0] === DATA);
		expect(data[data.length - 1]?.[1]).toEqual(["a", "b"]);
		unsub();
	});

	it("forEach runs side effect and returns unsub", () => {
		const acc: number[] = [];
		const src = fromIter([1, 2]);
		const unsub = forEach(src, (v) => acc.push(v as number));
		// No post-terminal replay — terminal guard blocks push-on-subscribe
		expect(acc).toEqual([1, 2]);
		expect(typeof unsub).toBe("function");
		unsub();
	});

	it("share uses one upstream subscription", () => {
		let subs = 0;
		const src = producer<number>((a) => {
			subs += 1;
			a.emit(1);
			return () => {
				subs -= 1;
			};
		});
		const hub = share(src);
		const a = collect(hub);
		const b = collect(hub);
		expect(subs).toBe(1);
		a.unsub();
		b.unsub();
	});

	it("replay replays buffer to late subscriber", async () => {
		const s = state(0);
		const r = replay(s, 2);
		const first = collect(r);
		await tick(0);
		s.down([[DIRTY], [DATA, 1]]);
		s.down([[DIRTY], [DATA, 2]]);
		await tick(0);
		const second = collect(r);
		await tick(0);
		const earlyData = second.batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(earlyData.slice(0, 2)).toEqual([1, 2]);
		first.unsub();
		second.unsub();
	});

	it("cached is replay(1)", async () => {
		const s = state(0);
		const c = cached(s);
		const { batches, unsub } = collect(c);
		await tick(0);
		s.down([[DIRTY], [DATA, 42]]);
		await tick(0);
		expect(batches.flat().some((m) => m[0] === DATA && m[1] === 42)).toBe(true);
		unsub();
	});

	it("fromEvent", () => {
		const target = {
			listeners: [] as ((e: unknown) => void)[],
			addEventListener(_type: string, fn: (e: unknown) => void) {
				this.listeners.push(fn);
			},
			removeEventListener(_type: string, fn: (e: unknown) => void) {
				const i = this.listeners.indexOf(fn);
				if (i >= 0) this.listeners.splice(i, 1);
			},
		};
		const { batches, unsub } = collect(fromEvent<{ x: number }>(target, "x"));
		target.listeners[0]?.({ x: 1 });
		expect(
			batches.some((b) => b.some((m) => m[0] === DATA && (m[1] as { x: number }).x === 1)),
		).toBe(true);
		unsub();
	});

	it("fromFSWatch emits debounced filesystem changes without polling", async () => {
		const dir = await mkdtemp(join(tmpdir(), "graphrefly-fswatch-"));
		try {
			const fileTs = join(dir, "alpha.ts");
			const fileTxt = join(dir, "ignore.txt");
			const fsNode = fromFSWatch(dir, {
				debounce: 25,
				recursive: true,
				include: ["**/*.ts"],
			});
			const { batches, unsub } = collect(fsNode);
			await writeFile(fileTs, "v1");
			await writeFile(fileTs, "v2");
			await writeFile(fileTxt, "nope");
			await tick(200);
			const events = batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map(
					(m) =>
						m[1] as {
							type: "change" | "create" | "delete" | "rename";
							path: string;
							root: string;
							relative_path: string;
							timestamp_ns: number;
						},
				);
			expect(events.some((evt) => evt.path.endsWith("alpha.ts"))).toBe(true);
			expect(events.some((evt) => evt.path.endsWith("ignore.txt"))).toBe(false);
			expect(events.length).toBeGreaterThanOrEqual(1);
			expect(events[0]?.root).toContain("graphrefly-fswatch-");
			expect(events[0]?.relative_path).toBe("alpha.ts");
			expect(["change", "create", "delete", "rename"]).toContain(events[0]?.type);
			expect(typeof events[0]?.timestamp_ns).toBe("number");
			unsub();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("fromFSWatch surfaces watcher setup failures as ERROR tuples", async () => {
		const badPath = join(tmpdir(), "graphrefly-fswatch-missing", `${Date.now()}`);
		const node = fromFSWatch(badPath, { debounce: 5 });
		const { batches, unsub } = collect(node);
		await tick(50);
		expect(batches.flat().some((m) => m[0] === ERROR)).toBe(true);
		unsub();
	});

	it("fromFSWatch rejects empty path list", () => {
		expect(() => fromFSWatch([])).toThrow("at least one path");
	});

	it("fromWebhook bridges callback payloads and cleanup", () => {
		let hook:
			| {
					emit: (payload: { id: string }) => void;
					error: (err: unknown) => void;
					complete: () => void;
			  }
			| undefined;
		let cleaned = false;
		const node = fromWebhook<{ id: string }>((handlers) => {
			hook = handlers;
			return () => {
				cleaned = true;
			};
		});
		const { batches, unsub } = collect(node);
		hook?.emit({ id: "evt-1" });
		expect(
			batches.some((b) => b.some((m) => m[0] === DATA && (m[1] as { id: string }).id === "evt-1")),
		).toBe(true);
		unsub();
		expect(cleaned).toBe(true);
	});

	it("fromWebhook forwards register errors as ERROR", () => {
		const node = fromWebhook(() => {
			throw new Error("register-failed");
		});
		const { batches, unsub } = collect(node);
		expect(
			batches.some((b) =>
				b.some((m) => m[0] === ERROR && (m[1] as Error).message === "register-failed"),
			),
		).toBe(true);
		unsub();
	});

	it("fromWebSocket forwards message and close tuples", () => {
		type WsEvent = { data?: unknown; error?: unknown };
		class FakeWebSocket {
			private readonly listeners = new Map<string, Set<(ev: unknown) => void>>();
			removed = 0;
			send(_data: string | ArrayBufferLike | Blob | ArrayBufferView) {}
			close() {}
			addEventListener(type: "message" | "error" | "close", listener: (ev: unknown) => void) {
				const set = this.listeners.get(type) ?? new Set<(ev: unknown) => void>();
				set.add(listener);
				this.listeners.set(type, set);
			}
			removeEventListener(type: "message" | "error" | "close", listener: (ev: unknown) => void) {
				this.listeners.get(type)?.delete(listener);
				this.removed += 1;
			}
			emit(type: "message" | "error" | "close", event: WsEvent) {
				for (const listener of this.listeners.get(type) ?? []) listener(event);
			}
		}
		const ws = new FakeWebSocket();
		const node = fromWebSocket<{ id: string }>(ws, {
			parse: (payload) => payload as { id: string },
		});
		const { batches, unsub } = collect(node);
		ws.emit("message", { data: { id: "m1" } });
		ws.emit("close", {});
		expect(
			batches.some((b) => b.some((m) => m[0] === DATA && (m[1] as { id: string }).id === "m1")),
		).toBe(true);
		expect(batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		expect(ws.removed).toBe(3);
		ws.emit("message", { data: { id: "m2" } });
		expect(
			batches.some((b) => b.some((m) => m[0] === DATA && (m[1] as { id: string }).id === "m2")),
		).toBe(false);
		unsub();
	});

	it("fromWebSocket supports register-style wiring and raw payload fallback", () => {
		let emitFn: ((payload: unknown) => void) | undefined;
		let completeFn: (() => void) | undefined;
		let cleaned = false;
		const node = fromWebSocket<{ id: string }>(
			(emit, _error, complete) => {
				emitFn = emit;
				completeFn = complete;
				return () => {
					cleaned = true;
				};
			},
			{ parse: (payload) => payload as { id: string } },
		);
		const { batches, unsub } = collect(node);
		emitFn?.({ id: "direct" });
		completeFn?.();
		expect(
			batches.some((b) => b.some((m) => m[0] === DATA && (m[1] as { id: string }).id === "direct")),
		).toBe(true);
		expect(batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		unsub();
		expect(cleaned).toBe(true);
	});

	it("fromWebSocket emits ERROR when register throws", () => {
		const node = fromWebSocket(() => {
			throw new Error("register-failed");
		});
		const { batches, unsub } = collect(node);
		expect(
			batches.some((b) =>
				b.some((m) => m[0] === ERROR && (m[1] as Error).message === "register-failed"),
			),
		).toBe(true);
		unsub();
	});

	it("fromWebSocket enforces register cleanup contract", () => {
		const node = fromWebSocket(
			((_emit, _error, _complete) => undefined) as unknown as (
				emit: (payload: { id: string }) => void,
				error: (err: unknown) => void,
				complete: () => void,
			) => () => void,
		);
		const { batches, unsub } = collect(node);
		expect(
			batches.some((b) =>
				b.some(
					(m) =>
						m[0] === ERROR && String(m[1]).includes("fromWebSocket register contract violation"),
				),
			),
		).toBe(true);
		unsub();
	});

	it("fromWebSocket forwards error tuple", () => {
		class FakeWebSocket {
			private readonly listeners = new Map<string, Set<(ev: unknown) => void>>();
			send(_data: string | ArrayBufferLike | Blob | ArrayBufferView) {}
			close() {}
			addEventListener(type: "message" | "error" | "close", listener: (ev: unknown) => void) {
				const set = this.listeners.get(type) ?? new Set<(ev: unknown) => void>();
				set.add(listener);
				this.listeners.set(type, set);
			}
			removeEventListener(type: "message" | "error" | "close", listener: (ev: unknown) => void) {
				this.listeners.get(type)?.delete(listener);
			}
			emit(type: "message" | "error" | "close", event: { data?: unknown; error?: unknown }) {
				for (const listener of this.listeners.get(type) ?? []) listener(event);
			}
		}
		const ws = new FakeWebSocket();
		const node = fromWebSocket(ws);
		const { batches, unsub } = collect(node);
		ws.emit("error", { error: "boom" });
		expect(batches.some((b) => b.some((m) => m[0] === ERROR))).toBe(true);
		unsub();
	});

	it("toWebSocket sends DATA and closes on COMPLETE", () => {
		class FakeWebSocket {
			sent: unknown[] = [];
			closed = 0;
			send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
				this.sent.push(data);
			}
			close() {
				this.closed += 1;
			}
			addEventListener(_type: "message" | "error" | "close", _listener: (ev: unknown) => void) {}
			removeEventListener(_type: "message" | "error" | "close", _listener: (ev: unknown) => void) {}
		}
		const ws = new FakeWebSocket();
		const handle = toWebSocket(fromIter([1, 2]), ws, { serialize: (v) => `n:${v}` });
		expect(ws.sent).toEqual(["n:1", "n:2"]);
		expect(ws.closed).toBe(1);
		handle.dispose();
	});

	it("toWebSocket reports serialize-returning-undefined as serialize error", () => {
		const errors: Array<{ stage: string; error: Error }> = [];
		class FakeWebSocket {
			sent: unknown[] = [];
			send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
				this.sent.push(data);
			}
			close() {}
			addEventListener(_type: "message" | "error" | "close", _listener: (ev: unknown) => void) {}
			removeEventListener(_type: "message" | "error" | "close", _listener: (ev: unknown) => void) {}
		}
		const ws = new FakeWebSocket();
		const handle = toWebSocket(fromIter([1]), ws, {
			serialize: () => undefined as never,
			closeOnComplete: false,
			onTransportError: (event) => errors.push({ stage: event.stage, error: event.error }),
		});
		expect(ws.sent).toEqual([]);
		expect(errors).toHaveLength(1);
		expect(errors[0].stage).toBe("serialize");
		handle.dispose();
	});

	it("toWebSocket reports structured send failures", () => {
		const errors: Array<{ stage: string; error: Error; value: unknown }> = [];
		class FakeWebSocket {
			send(_data: string | ArrayBufferLike | Blob | ArrayBufferView) {
				throw new Error("send-failed");
			}
			close(_code?: number, _reason?: string) {}
			addEventListener(_type: "message" | "error" | "close", _listener: (ev: unknown) => void) {}
			removeEventListener(_type: "message" | "error" | "close", _listener: (ev: unknown) => void) {}
		}
		const ws = new FakeWebSocket();
		expect(() =>
			toWebSocket(fromIter([1]), ws, {
				closeOnComplete: false,
				onTransportError: (event) =>
					errors.push({ stage: event.stage, error: event.error, value: event.value }),
			}),
		).not.toThrow();
		expect(errors).toHaveLength(1);
		expect(errors[0].stage).toBe("send");
		expect(errors[0].error.message).toBe("send-failed");
		expect(errors[0].value).toBe(1);
	});

	it("toWebSocket reports close failure and closes idempotently", () => {
		const errors: Array<{ stage: string; error: Error; message?: [symbol, unknown?] | undefined }> =
			[];
		const repeatedTerminal = producer((a) => {
			a.down([[COMPLETE], [ERROR, new Error("late")]]);
			return () => {};
		});
		class FakeWebSocket {
			closed = 0;
			send(_data: string | ArrayBufferLike | Blob | ArrayBufferView) {}
			close(_code?: number, _reason?: string) {
				this.closed += 1;
				throw new Error("close-failed");
			}
			addEventListener(_type: "message" | "error" | "close", _listener: (ev: unknown) => void) {}
			removeEventListener(_type: "message" | "error" | "close", _listener: (ev: unknown) => void) {}
		}
		const ws = new FakeWebSocket();
		expect(() =>
			toWebSocket(repeatedTerminal, ws, {
				onTransportError: (event) =>
					errors.push({
						stage: event.stage,
						error: event.error,
						message: event.message as [symbol, unknown?] | undefined,
					}),
			}),
		).not.toThrow();
		expect(ws.closed).toBe(1);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.stage).toBe("close");
		expect(errors[0]?.error.message).toBe("close-failed");
		expect(errors[0]?.message?.[0]).toBe(COMPLETE);
	});

	it("parseCron rejects bad expressions", () => {
		expect(() => parseCron("bad")).toThrow();
		expect(() => parseCron("* *")).toThrow();
	});

	it("fromCron fires on matching minute (timestamp_ns)", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 28, 9, 0, 0));
		const n = fromCron("0 9 * * *", { tickMs: 1000 });
		const { batches, unsub } = collect(n);
		vi.advanceTimersByTime(0);
		const data = batches.flat().filter((m) => m[0] === DATA);
		expect(data.length).toBeGreaterThanOrEqual(1);
		expect(typeof data[0]?.[1]).toBe("number");
		// Should be a nanosecond timestamp
		expect(data[0]?.[1]).toBeGreaterThan(1_000_000_000_000_000);
		unsub();
	});

	it("firstValueFrom resolves with first DATA", async () => {
		const result = await firstValueFrom(fromIter([10, 20, 30]));
		expect(result).toBe(10);
	});

	it("firstValueFrom rejects on empty", async () => {
		await expect(firstValueFrom(empty())).rejects.toThrow("completed without DATA");
	});

	it("firstValueFrom resolves synchronously — shouldUnsub path", async () => {
		// state(42) pushes DATA synchronously inside subscribe; unsub is
		// not yet assigned when the callback fires, so shouldUnsub = true
		// must clean up after subscribe returns.
		const result = await firstValueFrom(state(42));
		expect(result).toBe(42);
	});

	it("firstValueFrom rejects on ERROR", async () => {
		await expect(firstValueFrom(throwError(new Error("boom")))).rejects.toThrow("boom");
	});

	it("firstWhere resolves with first matching value (skips earlier)", async () => {
		const result = await firstWhere(fromIter([1, 2, 3, 4]), (v) => v > 2);
		expect(result).toBe(3);
	});

	it("awaitSettled resolves on first non-nullish DATA (default predicate)", async () => {
		const s = state<string | null>(null);
		const p = awaitSettled(s);
		s.emit("hello");
		expect(await p).toBe("hello");
	});

	it("awaitSettled respects custom predicate", async () => {
		const s = state<number>(0);
		const p = awaitSettled(s, { predicate: (v) => v > 5 });
		s.emit(3);
		s.emit(7);
		expect(await p).toBe(7);
	});

	it("awaitSettled rejects with TimeoutError on deadline", async () => {
		const s = state<string | null>(null);
		await expect(awaitSettled(s, { timeoutMs: 25 })).rejects.toThrow(/Timed out/);
	});

	it("awaitSettled with timeoutMs resolves before deadline", async () => {
		const s = state<string | null>(null);
		const p = awaitSettled(s, { timeoutMs: 500 });
		setTimeout(() => s.emit("before-deadline"), 5);
		expect(await p).toBe("before-deadline");
	});

	it("firstWhere resolves on synchronous source — shouldUnsub path", async () => {
		const result = await firstWhere(state(42), (v) => v === 42);
		expect(result).toBe(42);
	});

	it("firstWhere rejects when predicate never satisfied (COMPLETE)", async () => {
		await expect(firstWhere(fromIter([1, 2, 3]), (v) => v > 99)).rejects.toThrow(
			"completed without matching value",
		);
	});

	it("firstWhere rejects on ERROR before match", async () => {
		await expect(firstWhere(throwError(new Error("fail")), (_v) => true)).rejects.toThrow("fail");
	});

	it("toSSE writes standard DATA and COMPLETE frames", async () => {
		const text = await readSSE(toSSE(fromIter([1, 2])));
		expect(text).toContain("event: data\ndata: 1\n\n");
		expect(text).toContain("event: data\ndata: 2\n\n");
		expect(text).toContain("event: complete\n\n");
	});

	it("toSSE writes ERROR frame and closes", async () => {
		const text = await readSSE(toSSE(throwError(new Error("boom"))));
		expect(text).toContain("event: error\n");
		expect(text).toContain("data: boom");
	});

	it("toSSE supports custom serializer for Error payloads", async () => {
		const text = await readSSE(
			toSSE(throwError(new Error("boom")), {
				serialize: (v) => (v instanceof Error ? v.message : JSON.stringify(v)),
			}),
		);
		expect(text).toContain("event: error\ndata: boom\n\n");
	});

	it("toSSE abort closes without synthetic error frame", async () => {
		const ac = new AbortController();
		const stream = toSSE(never(), { signal: ac.signal });
		ac.abort(new Error("stop"));
		const text = await readSSE(stream);
		expect(text).toBe("");
	});

	it("toSSE can include DIRTY and RESOLVED events", async () => {
		const n = producer((a) => {
			a.down([[DIRTY], [RESOLVED], [COMPLETE]]);
			return () => {};
		});
		const text = await readSSE(toSSE(n, { includeDirty: true, includeResolved: true }));
		expect(text).toContain(`event: ${String(DIRTY.description ?? "")}`);
		expect(text).toContain(`event: ${String(RESOLVED.description ?? "")}`);
	});

	it("toSSE emits keepalive comments until abort", async () => {
		const ac = new AbortController();
		const stream = toSSE(never(), { keepAliveMs: 5, signal: ac.signal });
		setTimeout(() => ac.abort(), 20);
		const text = await readSSE(stream);
		expect(text).toContain(": keepalive\n\n");
	});

	it("toSSE preserves trailing newline lines", async () => {
		const text = await readSSE(toSSE(of("a\n")));
		expect(text).toContain("event: data\ndata: a\ndata: \n\n");
	});

	it("valve forwards DATA when control is truthy", () => {
		const src = state(42);
		const ctrl = state(true);
		const g = valve(src, ctrl);
		const { batches, unsub } = collect(g);
		expect(batches.flat().some((m) => m[0] === DATA && m[1] === 42)).toBe(true);
		unsub();
	});

	it("valve emits RESOLVED when control is falsy", () => {
		const src = state(42);
		const ctrl = state(false);
		const g = valve(src, ctrl);
		const { batches, unsub } = collect(g);
		expect(batches.flat().some((m) => m[0] === RESOLVED)).toBe(true);
		expect(batches.flat().some((m) => m[0] === DATA && m[1] === 42)).toBe(false);
		unsub();
	});
});

// ——————————————————————————————————————————————————————————————
//  fromMCP (roadmap §5.2)
// ——————————————————————————————————————————————————————————————

describe("fromMCP", () => {
	it("emits DATA for each notification", () => {
		let handler: ((n: unknown) => void) | undefined;
		const client = {
			setNotificationHandler(_method: string, h: (n: unknown) => void) {
				handler = h;
			},
		};

		const node = fromMCP(client, { method: "notifications/tools/list_changed" });
		const { batches, unsub } = collect(node);

		handler!({ tools: ["a", "b"] });
		handler!({ tools: ["a", "b", "c"] });

		const dataBatches = batches.filter((b) => b.some((m) => m[0] === DATA));
		expect(dataBatches.length).toBe(2);
		expect(dataBatches[0]).toEqual([[DATA, { tools: ["a", "b"] }]]);
		expect(dataBatches[1]).toEqual([[DATA, { tools: ["a", "b", "c"] }]]);
		unsub();
	});

	it("defaults to notifications/message method", () => {
		let registeredMethod: string | undefined;
		const client = {
			setNotificationHandler(method: string, _h: (n: unknown) => void) {
				registeredMethod = method;
			},
		};

		const node = fromMCP(client);
		const unsub = node.subscribe(() => {});
		expect(registeredMethod).toBe("notifications/message");
		unsub();
	});

	it("detaches handler on teardown (sets no-op)", () => {
		const handlers: Array<(n: unknown) => void> = [];
		const client = {
			setNotificationHandler(_method: string, h: (n: unknown) => void) {
				handlers.push(h);
			},
		};

		const node = fromMCP(client);
		const unsub = node.subscribe(() => {});
		unsub();

		// After teardown, the last registered handler should be a no-op (doesn't throw).
		expect(handlers.length).toBeGreaterThanOrEqual(2);
		const noopHandler = handlers[handlers.length - 1];
		expect(() => noopHandler("should-not-propagate")).not.toThrow();
	});

	it("suppresses emissions after teardown", () => {
		let handler: ((n: unknown) => void) | undefined;
		const client = {
			setNotificationHandler(_method: string, h: (n: unknown) => void) {
				handler = h;
			},
		};

		const node = fromMCP(client);
		const { batches, unsub } = collect(node);

		handler!("before");
		unsub();
		// Save ref to old handler before teardown replaced it.
		// The producer's active flag prevents emission even if the old ref is called.
		// (No new batches should appear.)
		const countBefore = batches.length;
		// Calling the *new* no-op handler should not emit.
		handler!("after");
		expect(batches.length).toBe(countBefore);
	});

	it("emits ERROR via onDisconnect hook", () => {
		let disconnectCb: ((err?: unknown) => void) | undefined;
		const client = {
			setNotificationHandler(_method: string, _h: (n: unknown) => void) {},
		};

		const node = fromMCP(client, {
			onDisconnect: (cb) => {
				disconnectCb = cb;
			},
		});
		const { batches, unsub } = collect(node);

		disconnectCb!(new Error("transport closed"));

		const errorBatches = batches.filter((b) => b.some((m) => m[0] === ERROR));
		expect(errorBatches.length).toBe(1);
		expect((errorBatches[0][0][1] as Error).message).toBe("transport closed");
		unsub();
	});
});

// ——————————————————————————————————————————————————————————————
//  fromGitHook (roadmap §5.2)
// ——————————————————————————————————————————————————————————————

describe("fromGitHook", () => {
	const childProcess = require("node:child_process");
	const originalExecFileSync = childProcess.execFileSync;

	afterEach(() => {
		childProcess.execFileSync = originalExecFileSync;
		vi.useRealTimers();
	});

	/** Mock helper: `execFileSync("git", args, ...)` receives args as an array. */
	function mockGit(handler: (args: string[]) => string) {
		childProcess.execFileSync = (_cmd: string, args: string[]) => handler(args);
	}

	it("emits GitEvent when HEAD changes", () => {
		vi.useFakeTimers();
		let callCount = 0;
		const sha1 = "aaa111";
		const sha2 = "bbb222";

		mockGit((args) => {
			const joined = args.join(" ");
			if (joined.startsWith("rev-parse HEAD")) {
				callCount++;
				return callCount <= 1 ? sha1 : sha2;
			}
			if (joined.startsWith("diff --name-only")) return "src/foo.ts\nsrc/bar.ts\n";
			if (joined.includes("--format=%s")) return "fix: something";
			if (joined.includes("--format=%an")) return "Alice";
			return "";
		});

		const node = fromGitHook("/fake/repo", { pollMs: 100 });
		const { batches, unsub } = collect(node);

		vi.advanceTimersByTime(100);

		const dataBatches = batches.filter((b) => b.some((m) => m[0] === DATA));
		expect(dataBatches.length).toBe(1);
		const gitEvent = dataBatches[0][0][1] as {
			commit: string;
			files: string[];
			message: string;
			author: string;
			timestamp_ns: number;
		};
		expect(gitEvent.commit).toBe(sha2);
		expect(gitEvent.files).toEqual(["src/foo.ts", "src/bar.ts"]);
		expect(gitEvent.message).toBe("fix: something");
		expect(gitEvent.author).toBe("Alice");
		expect(gitEvent.timestamp_ns).toBeGreaterThan(0);

		unsub();
	});

	it("does not emit when HEAD is unchanged", () => {
		vi.useFakeTimers();
		mockGit(() => "aaa111");

		const node = fromGitHook("/fake/repo", { pollMs: 100 });
		const { batches, unsub } = collect(node);

		vi.advanceTimersByTime(500);
		// No DATA batches when HEAD doesn't change. Non-DATA tier-1 signals
		// (DIRTY/RESOLVED) may appear from the switchMap pipeline and are
		// filtered here.
		const dataBatches = batches.filter((b) => b.some((m) => m[0] === DATA));
		expect(dataBatches.length).toBe(0);

		unsub();
	});

	it("filters files with include/exclude globs", () => {
		vi.useFakeTimers();
		let callCount = 0;

		mockGit((args) => {
			const joined = args.join(" ");
			if (joined.startsWith("rev-parse HEAD")) {
				callCount++;
				return callCount <= 1 ? "aaa" : "bbb";
			}
			if (joined.startsWith("diff --name-only")) return "src/foo.ts\ndocs/readme.md\ntest/bar.ts\n";
			if (joined.includes("--format=%s")) return "update";
			if (joined.includes("--format=%an")) return "Bob";
			return "";
		});

		const node = fromGitHook("/fake/repo", {
			pollMs: 100,
			include: ["src/**"],
			exclude: ["**/*.md"],
		});
		const { batches, unsub } = collect(node);

		vi.advanceTimersByTime(100);

		const dataBatches = batches.filter((b) => b.some((m) => m[0] === DATA));
		expect(dataBatches.length).toBe(1);
		const gitEvent = dataBatches[0][0][1] as { files: string[] };
		expect(gitEvent.files).toEqual(["src/foo.ts"]);

		unsub();
	});

	it("emits ERROR when git command fails during poll", () => {
		vi.useFakeTimers();
		let callCount = 0;

		mockGit((args) => {
			if (args[0] === "rev-parse") {
				callCount++;
				if (callCount <= 1) return "aaa111";
				throw new Error("git not found");
			}
			return "";
		});

		const node = fromGitHook("/fake/repo", { pollMs: 100 });
		const { batches, unsub } = collect(node);

		vi.advanceTimersByTime(100);

		// switchMap pipeline may interleave tier-1 signals with the terminal
		// ERROR; locate the ERROR batch instead of asserting exactly one batch.
		const errorBatches = batches.filter((b) => b.some((m) => m[0] === ERROR));
		expect(errorBatches.length).toBe(1);
		expect(errorBatches[0].find((m) => m[0] === ERROR)?.[0]).toBe(ERROR);

		unsub();
	});

	it("clears timer on teardown", () => {
		vi.useFakeTimers();
		mockGit(() => "aaa111");

		const node = fromGitHook("/fake/repo", { pollMs: 100 });
		const { batches, unsub } = collect(node);

		unsub();

		vi.advanceTimersByTime(500);
		expect(batches.length).toBe(0);
	});
});
