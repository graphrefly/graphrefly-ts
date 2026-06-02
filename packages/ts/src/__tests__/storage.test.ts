import { describe, expect, it, vi } from "vitest";
import type { ObserveEvent, ObserveSinkErrorContext } from "../index.js";
import { attachObserveSink, graph } from "../index.js";

const flushMicrotasks = async (turns = 1) => {
	for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

const awaitDone = (run: (done: () => void) => void) =>
	new Promise<void>((resolve) => {
		run(resolve);
	});

describe("attachObserveSink — observe-driven storage binding (D57/D74)", () => {
	it("writes filtered observe events in graph order", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const _b = g.derived([a], (n) => n + 1, { name: "b" });
		const events: ObserveEvent[] = [];

		const handle = attachObserveSink(
			g,
			{ write: (event) => void events.push(event) },
			{ path: "b" },
		);

		a.set(1);
		a.set(2);
		handle.flush();

		expect(events.every((event) => event.path === "b")).toBe(true);
		expect(events.map((event) => event.seq)).toEqual(
			[...events.map((event) => event.seq)].sort((x, y) => x - y),
		);
		expect(events.filter((event) => event.msg[0] === "DATA").map((event) => event.msg[1])).toEqual([
			1, 2, 3,
		]);

		handle.dispose();
	});

	it("serializes thenable writes so later events wait for earlier ones", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const started: number[] = [];
		const finished: number[] = [];
		const releases: Array<() => void> = [];

		const handle = attachObserveSink(
			g,
			{
				write: (value) => {
					started.push(value);
					return new Promise<void>((resolve) => {
						releases.push(() => {
							finished.push(value);
							resolve();
						});
					});
				},
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
			},
		);

		count.set(1);
		count.set(2);
		expect(started).toEqual([0]);

		releases.shift()?.();
		await flushMicrotasks();
		expect(started).toEqual([0, 1]);

		releases.shift()?.();
		await flushMicrotasks();
		expect(started).toEqual([0, 1, 2]);

		const flushed = awaitDone((done) => handle.flush(done));
		releases.shift()?.();
		await flushed;
		expect(finished).toEqual([0, 1, 2]);

		handle.dispose();
	});

	it("routes sync throws and thenable rejections to onError and keeps draining", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const values: number[] = [];
		const errors: Array<{ message: string; ctx: ObserveSinkErrorContext<number> }> = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => {
					if (value === 1) throw new Error("sync boom");
					if (value === 2) return Promise.reject(new Error("async boom"));
					values.push(value);
				},
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
				onError: (error, ctx) => {
					errors.push({ message: (error as Error).message, ctx });
				},
			},
		);

		count.set(1);
		count.set(2);
		count.set(3);
		await awaitDone((done) => handle.flush(done));

		expect(values).toEqual([0, 3]);
		expect(
			errors.map(({ message, ctx }) => ({ message, phase: ctx.phase, value: ctx.value })),
		).toEqual([
			{ message: "sync boom", phase: "write", value: 1 },
			{ message: "async boom", phase: "write", value: 2 },
		]);

		handle.dispose();
	});

	it("routes malformed thenables to onError without wedging the queue", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const values: number[] = [];
		const errors: Array<{ message: string; ctx: ObserveSinkErrorContext<number> }> = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => {
					if (value === 1) {
						const malformed = {};
						Object.defineProperty(malformed, ["th", "en"].join(""), {
							get() {
								throw new Error("bad then");
							},
						});
						return malformed as PromiseLike<void>;
					}
					values.push(value);
				},
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
				onError: (error, ctx) => {
					errors.push({ message: (error as Error).message, ctx });
				},
			},
		);

		count.set(1);
		count.set(2);
		await awaitDone((done) => handle.flush(done));

		expect(values).toEqual([0, 2]);
		expect(
			errors.map(({ message, ctx }) => ({ message, phase: ctx.phase, value: ctx.value })),
		).toEqual([{ message: "bad then", phase: "write", value: 1 }]);

		handle.dispose();
	});

	it("serializes flush/rollback/dispose and stops observing after dispose", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const calls: string[] = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => void calls.push(`write:${value}`),
				flush: () => void calls.push("flush"),
				rollback: () => void calls.push("rollback"),
				dispose: () => void calls.push("dispose"),
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
			},
		);

		count.set(1);
		const order: string[] = [];
		handle.flush(() => order.push("flush.done"));
		handle.rollback(() => order.push("rollback.done"));
		await awaitDone((done) =>
			handle.dispose(() => {
				order.push("dispose.done");
				done();
			}),
		);

		expect(calls).toEqual(["write:0", "write:1", "flush", "rollback", "dispose"]);
		expect(order).toEqual(["flush.done", "rollback.done", "dispose.done"]);

		count.set(2);
		handle.flush();
		expect(calls).toEqual(["write:0", "write:1", "flush", "rollback", "dispose"]);
	});

	it("coalesces repeated dispose callbacks until pending work drains", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const started: number[] = [];
		const releases: Array<() => void> = [];
		const done: string[] = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => {
					started.push(value);
					return new Promise<void>((resolve) => {
						releases.push(resolve);
					});
				},
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
			},
		);

		count.set(1);
		handle.dispose(() => done.push("first"));
		handle.dispose(() => done.push("second"));

		expect(started).toEqual([0]);
		expect(done).toEqual([]);

		releases.shift()?.();
		await flushMicrotasks();
		expect(started).toEqual([0, 1]);
		expect(done).toEqual([]);

		releases.shift()?.();
		await flushMicrotasks();
		expect(done).toEqual(["first", "second"]);

		handle.dispose(() => done.push("third"));
		expect(done).toEqual(["first", "second", "third"]);
	});

	it("reports mapper failures without invoking sink.write", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const write = vi.fn((value: number) => void value);
		const errors: ObserveSinkErrorContext<number>[] = [];

		const handle = attachObserveSink<number>(
			g,
			{ write },
			{
				path: "count",
				map: (event) => {
					if (event.msg[0] !== "DATA") return undefined;
					const value = event.msg[1] as number;
					if (value === 1) throw new Error("bad map");
					return value;
				},
				onError: (_error, ctx) => {
					errors.push(ctx);
				},
			},
		);

		count.set(1);
		count.set(2);
		handle.flush();

		expect(write.mock.calls.map(([value]) => value)).toEqual([0, 2]);
		expect(errors).toEqual([{ phase: "map", event: expect.objectContaining({ path: "count" }) }]);

		handle.dispose();
	});

	it("calls done even when adapter hooks reject or throw, while routing failures to onError", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const phases: string[] = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => {
					if (value === 1) throw new Error("write fail");
				},
				flush: () => Promise.reject(new Error("flush fail")),
				rollback: () => {
					throw new Error("rollback fail");
				},
				dispose: () => Promise.reject(new Error("dispose fail")),
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
				onError: (_error, ctx) => {
					phases.push(ctx.phase);
				},
			},
		);

		count.set(1);
		await awaitDone((done) => handle.flush(done));
		await awaitDone((done) => handle.rollback(done));
		await awaitDone((done) => handle.dispose(done));

		expect(phases).toEqual(["write", "flush", "rollback", "dispose"]);
	});
});
