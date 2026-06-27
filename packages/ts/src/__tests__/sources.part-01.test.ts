import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { CTX_NODE_BINDING } from "../ctx/types.js";
import type { Message } from "../index.js";
import {
	EnvironmentDrivers,
	type FromCronOptions,
	fromCron,
	fromHttp,
	fromHttpWithOptions,
	fromProcess,
	fromSSE,
	fromSSEWithOptions,
	fromTimer,
	fromWebhook,
	fromWebhookWithOptions,
	fromWebSocket,
	fromWebSocketWithOptions,
	graph,
	type HttpRequest,
	type HttpResponse,
	initNode,
	interval,
	type LocalHttpDriver,
	type LocalProcessDriver,
	type LocalSseDriver,
	type LocalWebhookDriver,
	type LocalWebSocketDriver,
	matchesCron,
	type Node,
	type Operator,
	type ProcessCommand,
	type ProcessResult,
	parseCron,
	runProcess,
	runProcessWithOptions,
	type SseDriverEvent,
	type SseEvent,
	type SseRequest,
	timer,
	type WebhookDriverEvent,
	type WebhookEvent,
	type WebhookRegistration,
	type WebSocketDriverEvent,
	type WebSocketEvent,
	type WebSocketRequest,
} from "../index.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);

const _flush = () => new Promise((r) => setTimeout(r, 0));

class _FakeEventTarget {
	readonly calls: Array<readonly ["add" | "remove", string, unknown]> = [];
	private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

	addEventListener(type: string, listener: (event: unknown) => void, options?: unknown): void {
		this.calls.push(["add", type, options]);
		const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: unknown) => void, options?: unknown): void {
		this.calls.push(["remove", type, options]);
		this.listeners.get(type)?.delete(listener);
	}

	emit(type: string, event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

class ManualProcessDriver implements LocalProcessDriver {
	readonly runs: Array<{
		command: ProcessCommand;
		active: { value: boolean };
		callback: (result: { ok: true; value: ProcessResult } | { ok: false; error: unknown }) => void;
	}> = [];

	run(
		command: ProcessCommand,
		callback: (result: { ok: true; value: ProcessResult } | { ok: false; error: unknown }) => void,
	): () => void {
		const active = { value: true };
		this.runs.push({ command, active, callback });
		return () => {
			active.value = false;
		};
	}

	finish(result: { ok: true; value: ProcessResult } | { ok: false; error: unknown }): void {
		const run = this.runs.shift();
		if (run?.active.value) run.callback(result);
	}

	finishIgnoringCancel(
		result: { ok: true; value: ProcessResult } | { ok: false; error: unknown },
	): void {
		this.runs.shift()?.callback(result);
	}

	activeCount(): number {
		return this.runs.filter((run) => run.active.value).length;
	}
}

class ManualHttpDriver implements LocalHttpDriver {
	readonly requests: Array<{
		request: HttpRequest;
		active: { value: boolean };
		callback: (result: { ok: true; value: HttpResponse } | { ok: false; error: unknown }) => void;
	}> = [];

	request(
		request: HttpRequest,
		callback: (result: { ok: true; value: HttpResponse } | { ok: false; error: unknown }) => void,
	): () => void {
		const active = { value: true };
		this.requests.push({ request, active, callback });
		return () => {
			active.value = false;
		};
	}

	finish(result: { ok: true; value: HttpResponse } | { ok: false; error: unknown }): void {
		const request = this.requests.shift();
		if (request?.active.value) request.callback(result);
	}
}

class ManualSseDriver implements LocalSseDriver {
	readonly connections: Array<{
		request: SseRequest;
		active: { value: boolean };
		callback: (event: SseDriverEvent) => void;
	}> = [];

	connect(request: SseRequest, callback: (event: SseDriverEvent) => void): () => void {
		const active = { value: true };
		this.connections.push({ request, active, callback });
		return () => {
			active.value = false;
		};
	}

	emit(event: SseDriverEvent): void {
		const connection = this.connections[0];
		if (connection?.active.value) connection.callback(event);
	}
}

class ManualWebSocketDriver implements LocalWebSocketDriver {
	readonly connections: Array<{
		request: WebSocketRequest;
		active: { value: boolean };
		callback: (event: WebSocketDriverEvent) => void;
	}> = [];

	connect(request: WebSocketRequest, callback: (event: WebSocketDriverEvent) => void): () => void {
		const active = { value: true };
		this.connections.push({ request, active, callback });
		return () => {
			active.value = false;
		};
	}

	emit(event: WebSocketDriverEvent): void {
		const connection = this.connections[0];
		if (connection?.active.value) connection.callback(event);
	}
}

class ManualWebhookDriver implements LocalWebhookDriver {
	readonly registrations: Array<{
		registration: WebhookRegistration;
		active: { value: boolean };
		callback: (event: WebhookDriverEvent) => void;
	}> = [];

	register(
		registration: WebhookRegistration,
		callback: (event: WebhookDriverEvent) => void,
	): () => void {
		const active = { value: true };
		this.registrations.push({ registration, active, callback });
		return () => {
			active.value = false;
		};
	}

	emit(event: WebhookDriverEvent): void {
		const registration = this.registrations[0];
		if (registration?.active.value) registration.callback(event);
	}

	emitIgnoringCancel(event: WebhookDriverEvent): void {
		this.registrations[0]?.callback(event);
	}

	activeCount(): number {
		return this.registrations.filter((registration) => registration.active.value).length;
	}
}

// D43/D40: async sources are binding-layer producer sugar — depless Operator specs run once on
// activation, schedule their work, and emit later via the captured ctx.down (R-no-raw-async:
// setTimeout/Promise confined here). Instantiated via the generic g.initNode funnel.
describe("timer / interval sources (fake timers, D43)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("timer one-shot emits DATA(0) then COMPLETE", () => {
		const g = graph();
		const n = g.initNode(timer(50), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		vi.advanceTimersByTime(50);
		expect(data(msgs)).toEqual([0]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
		expect(n.status).toBe("completed");
	});

	it("timer one-shot is canceled by deactivation before its first tick", () => {
		const g = graph();
		const n = g.initNode(timer(50), []);
		const msgs: Message[] = [];
		const unsub = n.subscribe((x) => msgs.push(x));
		expect(vi.getTimerCount()).toBe(1);

		unsub();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(50);

		expect(data(msgs)).toEqual([]);
		expect(msgs).toEqual([["START"]]);
	});

	it("fromTimer preserves the frozen source name and supports AbortSignal", () => {
		const g = graph();
		const ac = new AbortController();
		const n = g.initNode(fromTimer(50, { signal: ac.signal }), [], { name: "clock" });
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		ac.abort(false);
		vi.advanceTimersByTime(50);

		const byId = Object.fromEntries(g.describe().nodes.map((node) => [node.id, node]));
		const last = msgs[msgs.length - 1];
		expect(byId.clock.factory).toBe("fromTimer");
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		expect(data(msgs)).toEqual([]);
	});

	it("fromTimer reports an already-aborted signal without scheduling DATA", () => {
		const g = graph();
		const ac = new AbortController();
		ac.abort(false);
		const n = g.initNode(fromTimer(50, { signal: ac.signal }), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		vi.advanceTimersByTime(50);

		const last = msgs[msgs.length - 1];
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		expect(data(msgs)).toEqual([]);
		expect(n.status).toBe("errored");
	});

	it("fromTimer periodic mode stops emitting after abort", () => {
		const g = graph();
		const ac = new AbortController();
		const n = g.initNode(fromTimer(50, { period: 100, signal: ac.signal }), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		vi.advanceTimersByTime(50);
		vi.advanceTimersByTime(100);
		ac.abort(true);
		vi.advanceTimersByTime(500);

		const last = msgs[msgs.length - 1];
		expect(data(msgs)).toEqual([0, 1]);
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		expect(n.status).toBe("errored");
	});

	it("interval emits periodic ticks 0,1,2,…", () => {
		const g = graph();
		const n = g.initNode(interval(100), []);
		const vals: number[] = [];
		const unsub = n.subscribe((m) => {
			if (m[0] === "DATA") vals.push(m[1] as number);
		});
		vi.advanceTimersByTime(100); // first tick → 0
		vi.advanceTimersByTime(100); // → 1
		vi.advanceTimersByTime(100); // → 2
		expect(vals).toEqual([0, 1, 2]);
		unsub(); // deactivate → onDeactivation clears the interval (no leak)
	});

	it("interval preserves its real source factory name in describe (D6)", () => {
		const g = graph();
		g.initNode(interval(100), [], { name: "ticks" });
		const byId = Object.fromEntries(g.describe().nodes.map((node) => [node.id, node]));
		expect(byId.ticks.factory).toBe("interval");
	});

	it("deactivation stops the source — no emit after unsubscribe (cleanup contract)", () => {
		const g = graph();
		const n = g.initNode(interval(100), []);
		const vals: number[] = [];
		const unsub = n.subscribe((m) => {
			if (m[0] === "DATA") vals.push(m[1] as number);
		});
		vi.advanceTimersByTime(100); // tick 0
		unsub(); // deactivate → ctx.onDeactivation clears the interval (D28)
		vi.advanceTimersByTime(500); // no live timer → no further ticks
		expect(vals).toEqual([0]); // nothing emitted after deactivation
	});
});

describe("cron sources (B60 source-boundary re-derive)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("parseCron supports lists, ranges, and steps", () => {
		const schedule = parseCron("0,30 9-17/2 * 1-3 1-5");

		expect([...schedule.minutes]).toEqual([0, 30]);
		expect([...schedule.hours]).toEqual([9, 11, 13, 15, 17]);
		expect([...schedule.months]).toEqual([1, 2, 3]);
		expect([...schedule.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
		expect(() => parseCron("60 * * * *")).toThrow(RangeError);
		expect(() => parseCron("* * * *")).toThrow(/expected 5 fields/);
		expect(() => parseCron("0 * * * * *")).toThrow(/expected 5 fields/);
		expect(() => parseCron("*/5foo * * * *")).toThrow(/Invalid cron step/);
		expect(() => parseCron("1/2/3 * * * *")).toThrow(/Invalid cron step/);
		expect(() => parseCron("8-12bar * * * *")).toThrow(/Invalid cron field/);
	});

	it("matchesCron checks the local five-field schedule", () => {
		const schedule = parseCron("30 8 * * 1");
		expect(matchesCron(schedule, new Date(2026, 2, 30, 8, 30))).toBe(true);
		expect(matchesCron(schedule, new Date(2026, 2, 30, 8, 31))).toBe(false);
	});

	it("matchesCron projects dates through an IANA timezone", () => {
		const schedule = parseCron("30 1 * * 0");

		expect(
			matchesCron(schedule, new Date("2026-03-08T09:30:00.000Z"), {
				timezone: "America/Los_Angeles",
			}),
		).toBe(true);
		expect(
			matchesCron(parseCron("30 2 8 3 0"), new Date("2026-03-08T10:30:00.000Z"), {
				timezone: "America/Los_Angeles",
			}),
		).toBe(false);
	});

	it("fromCron emits at most once per matching minute and tears down its interval", () => {
		const now = new Date(2026, 2, 30, 8, 30, 0);
		vi.setSystemTime(now);
		const g = graph();
		const n = g.initNode(fromCron("30 8 * * 1", { tickMs: 1000 }), [], { name: "cron" });
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((msg) => msgs.push(msg));

		const expected = (BigInt(now.getTime()) * 1_000_000n).toString();
		expect(data(msgs)).toEqual([expected]);
		vi.advanceTimersByTime(30_000);
		expect(data(msgs)).toEqual([expected]);
		expect(vi.getTimerCount()).toBe(1);
		unsubscribe();
		expect(vi.getTimerCount()).toBe(0);
		expect(g.describe().nodes.find((node) => node.id === "cron")?.factory).toBe("fromCron");
	});

	it("fromCron resumes from current time without catch-up or missed-status payloads", () => {
		const first = new Date(2026, 2, 30, 8, 30, 0);
		const resumed = new Date(2026, 2, 30, 8, 35, 0);
		vi.setSystemTime(first);
		const g = graph();
		const n = g.initNode(fromCron("* * * * *", { tickMs: 1000, output: "timestamp_ms" }), []);
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((msg) => msgs.push(msg));

		vi.setSystemTime(new Date(resumed.getTime() - 1000));
		vi.advanceTimersByTime(1000);

		expect(data(msgs)).toEqual([first.getTime(), resumed.getTime()]);
		expect(data(msgs)).not.toHaveLength(6);
		for (const payload of data(msgs)) {
			expect(typeof payload).toBe("number");
		}
		unsubscribe();
	});

	it("fromCron can emit Date values", () => {
		vi.setSystemTime(new Date(2026, 2, 30, 8, 30, 0));
		const g = graph();
		const n = g.initNode(fromCron("30 8 * * 1", { tickMs: 1000, output: "date" }), []);
		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		expect(data(msgs)[0]).toBeInstanceOf(Date);
	});

	it("fromCron validates timezone and fires a repeated DST wall-clock minute once", () => {
		const firstRepeated = new Date("2026-11-01T08:30:00.000Z");
		vi.setSystemTime(firstRepeated);
		const g = graph();
		const n = g.initNode(
			fromCron("30 1 1 11 0", { tickMs: 60 * 60 * 1000, timezone: "America/Los_Angeles" }),
			[],
		);
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((msg) => msgs.push(msg));

		expect(data(msgs)).toEqual([(BigInt(firstRepeated.getTime()) * 1_000_000n).toString()]);
		vi.advanceTimersByTime(60 * 60 * 1000);
		expect(data(msgs)).toHaveLength(1);
		expect(() => fromCron("* * * * *", { timezone: "Not/A_Zone" })).toThrow(/unsupported/);

		unsubscribe();
	});

	it("fromCron accepts the exported FromCronOptions type", () => {
		const opts: FromCronOptions =
			Math.random() > 2
				? { output: "date", timezone: "UTC", dst: { nonexistent: "skip", repeated: "once" } }
				: { output: "timestamp_ns" };

		expectTypeOf(fromCron("* * * * *", opts)).toEqualTypeOf<
			Operator<never, Date | number | string>
		>();
	});
});

describe("environment driver-backed sources (D130/D131)", () => {
	it("empty EnvironmentDrivers is frozen to protect graph-local defaults", () => {
		expect(Object.isFrozen(EnvironmentDrivers.empty())).toBe(true);
	});

	it("GraphOptions.environment is visible from ctx.environment", () => {
		const process = new ManualProcessDriver();
		const env = EnvironmentDrivers.empty().withProcess(process);
		const g = graph({ environment: env });
		const n = g.producer<boolean>((ctx) => {
			ctx.down([["DATA", ctx.environment().processDriver() === process], ["COMPLETE"]]);
		});

		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		expect(data(msgs)).toEqual([true]);
	});

	it("graph-local helper-created nodes inherit EnvironmentDrivers", () => {
		const driver = new ManualHttpDriver();
		const g = graph({ environment: EnvironmentDrivers.empty().withHttp(driver) });
		let inner: Node<HttpResponse> | undefined;
		const outer = g.producer((ctx) => {
			const binding = ctx[CTX_NODE_BINDING];
			if (binding === undefined) throw new Error("missing ctx node binding");
			inner = binding.create(() =>
				initNode(fromHttp("https://example.test/inner"), [], {
					dispatcher: binding.dispatcher,
				}),
			);
			ctx.down([["COMPLETE"]]);
		});

		outer.subscribe(() => {});
		expect(inner).toBeDefined();
		const msgs: Message[] = [];
		inner?.subscribe((msg) => msgs.push(msg));

		expect(driver.requests.map((request) => request.request)).toEqual([
			{ method: "GET", url: "https://example.test/inner" },
		]);
		expect(msgs).toEqual([["START"]]);
	});

	it("driver-backed source factory names are stable in describe", () => {
		const g = graph();
		g.initNode(runProcess("echo", ["ok"]), [], { name: "run_process" });
		g.initNode(fromProcess("echo", ["ok"]), [], { name: "from_process" });
		g.initNode(fromHttp("https://example.invalid"), [], { name: "from_http" });
		g.initNode(fromSSE("https://example.invalid/events"), [], { name: "from_sse" });
		g.initNode(fromWebSocket("wss://example.invalid/socket"), [], { name: "from_websocket" });
		g.initNode(fromWebhook("stripe"), [], { name: "from_webhook" });

		const factories = Object.fromEntries(g.describe().nodes.map((node) => [node.id, node.factory]));
		expect(factories.run_process).toBe("runProcess");
		expect(factories.from_process).toBe("fromProcess");
		expect(factories.from_http).toBe("fromHttp");
		expect(factories.from_sse).toBe("fromSSE");
		expect(factories.from_websocket).toBe("fromWebSocket");
		expect(factories.from_webhook).toBe("fromWebhook");
	});

	it("missing environment drivers route source activation ERROR", () => {
		const g = graph();
		const cases: Array<readonly [Operator<never, unknown>, string]> = [
			[runProcess("echo", ["ok"]), "runProcess: missing process driver"],
			[fromHttp("https://example.invalid"), "fromHttp: missing http driver"],
			[fromSSE("https://example.invalid/events"), "fromSSE: missing sse driver"],
			[fromWebSocket("wss://example.invalid/socket"), "fromWebSocket: missing websocket driver"],
			[fromWebhook("stripe"), "fromWebhook: missing webhook driver"],
		];

		for (const [op, expected] of cases) {
			const node = g.initNode(op, []);
			const msgs: Message[] = [];
			node.subscribe((msg) => msgs.push(msg));
			expect(msgs[msgs.length - 1]).toEqual(["ERROR", expected]);
		}
	});

	it("runProcess/fromProcess use the graph-local process driver", () => {
		const driver = new ManualProcessDriver();
		const g = graph({ environment: EnvironmentDrivers.empty().withProcess(driver) });
		const node = g.initNode(runProcessWithOptions({ program: "echo", args: ["ok"] }), []);
		const msgs: Message[] = [];
		node.subscribe((msg) => msgs.push(msg));

		expect(driver.runs.map((run) => run.command)).toEqual([{ program: "echo", args: ["ok"] }]);
		driver.finish({
			ok: true,
			value: { stdout: "ok\n", stderr: "", exitCode: 0, signal: null },
		});

		expect(data(msgs)).toEqual([{ stdout: "ok\n", stderr: "", exitCode: 0, signal: null }]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");

		const alias = g.initNode(fromProcess("echo", ["again"]), []);
		const aliasMsgs: Message[] = [];
		alias.subscribe((msg) => aliasMsgs.push(msg));
		expect(driver.runs.map((run) => run.command)).toEqual([{ program: "echo", args: ["again"] }]);
		expect(aliasMsgs).toEqual([["START"]]);
	});

	it("driver cancel errors do not suppress one-shot terminal delivery", () => {
		let callback:
			| ((result: { ok: true; value: ProcessResult } | { ok: false; error: unknown }) => void)
			| undefined;
		const driver: LocalProcessDriver = {
			run(_command, cb) {
				callback = cb;
				return () => {
					throw new Error("cancel failed");
				};
			},
		};
		const g = graph({ environment: EnvironmentDrivers.empty().withProcess(driver) });
		const node = g.initNode(runProcess("echo", ["ok"]), []);
		const msgs: Message[] = [];
		node.subscribe((msg) => msgs.push(msg));

		callback?.({
			ok: true,
			value: { stdout: "ok\n", stderr: "", exitCode: 0, signal: null },
		});

		expect(data(msgs)).toEqual([{ stdout: "ok\n", stderr: "", exitCode: 0, signal: null }]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
	});

	it("one-shot driver start errors route to graph-visible ERROR", () => {
		const driver: LocalHttpDriver = {
			request() {
				throw new Error("request setup failed");
			},
		};
		const g = graph({ environment: EnvironmentDrivers.empty().withHttp(driver) });
		const node = g.initNode(fromHttp("https://example.test/fail"), []);
		const msgs: Message[] = [];

		expect(() => node.subscribe((msg) => msgs.push(msg))).not.toThrow();
		expect(msgs[msgs.length - 1][0]).toBe("ERROR");
	});

	it("fromHttp uses the graph-local HTTP driver", () => {
		const driver = new ManualHttpDriver();
		const g = graph({ environment: EnvironmentDrivers.empty().withHttp(driver) });
		const node = g.initNode(
			fromHttpWithOptions({
				method: "POST",
				url: "https://example.test/resource",
				headers: [["content-type", "application/json"]],
				body: "{}",
			}),
			[],
		);
		const msgs: Message[] = [];
		node.subscribe((msg) => msgs.push(msg));

		expect(driver.requests.map((request) => request.request)).toEqual([
			{
				method: "POST",
				url: "https://example.test/resource",
				headers: [["content-type", "application/json"]],
				body: "{}",
			},
		]);
		const response: HttpResponse = {
			status: 202,
			headers: [["x-test", "yes"]],
			body: new Uint8Array([1, 2, 3]),
		};
		driver.finish({ ok: true, value: response });

		expect(data(msgs)).toEqual([response]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
	});

	it("fromSSE and fromWebSocket emit stream driver events", () => {
		const sseDriver = new ManualSseDriver();
		const wsDriver = new ManualWebSocketDriver();
		const g = graph({
			environment: EnvironmentDrivers.empty().withSse(sseDriver).withWebSocket(wsDriver),
		});
		const sse = g.initNode(fromSSEWithOptions({ url: "https://example.test/events" }), []);
		const ws = g.initNode(fromWebSocketWithOptions({ url: "wss://example.test/socket" }), []);
		const sseMsgs: Message[] = [];
		const wsMsgs: Message[] = [];
		sse.subscribe((msg) => sseMsgs.push(msg));
		ws.subscribe((msg) => wsMsgs.push(msg));

		const sseEvent: SseEvent = { event: "message", data: "hello", id: "1", retryMs: 1000 };
		const wsEvent: WebSocketEvent = { kind: "text", data: "hello" };
		sseDriver.emit({ kind: "event", event: sseEvent });
		sseDriver.emit({ kind: "complete" });
		wsDriver.emit({ kind: "event", event: { kind: "open" } });
		wsDriver.emit({ kind: "event", event: wsEvent });
		wsDriver.emit({ kind: "complete" });

		expect(data(sseMsgs)).toEqual([sseEvent]);
		expect(sseMsgs[sseMsgs.length - 1][0]).toBe("COMPLETE");
		expect(data(wsMsgs)).toEqual([{ kind: "open" }, wsEvent]);
		expect(wsMsgs[wsMsgs.length - 1][0]).toBe("COMPLETE");
	});

	it("stream driver start errors route to graph-visible ERROR", () => {
		const driver: LocalWebhookDriver = {
			register() {
				throw new Error("register setup failed");
			},
		};
		const g = graph({ environment: EnvironmentDrivers.empty().withWebhook(driver) });
		const node = g.initNode(fromWebhook("github"), []);
		const msgs: Message[] = [];

		expect(() => node.subscribe((msg) => msgs.push(msg))).not.toThrow();
		expect(msgs[msgs.length - 1][0]).toBe("ERROR");
	});

	it("fromWebhook registers the graph-local webhook bridge and fences late callbacks", () => {
		const driver = new ManualWebhookDriver();
		const registration: WebhookRegistration = { id: "stripe", method: "POST", path: "/stripe" };
		const g = graph({ environment: EnvironmentDrivers.empty().withWebhook(driver) });
		const node = g.initNode(fromWebhookWithOptions(registration), []);
		const msgs: Message[] = [];
		node.subscribe((msg) => msgs.push(msg));

		expect(driver.registrations.map((entry) => entry.registration)).toEqual([registration]);
		const event: WebhookEvent = {
			registrationId: "stripe",
			method: "POST",
			path: "/stripe",
			headers: [["content-type", "application/json"]],
			query: [["source", "test"]],
			body: new Uint8Array([123, 125]),
		};
		driver.emit({ kind: "event", event });
		driver.emit({ kind: "complete" });
		expect(driver.activeCount()).toBe(0);
		driver.emitIgnoringCancel({
			kind: "event",
			event: { ...event, body: new Uint8Array([108, 97, 116, 101]) },
		});

		expect(data(msgs)).toEqual([event]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
	});

	it("fromWebhook unsubscribe cancels registration and suppresses late events", () => {
		const driver = new ManualWebhookDriver();
		const g = graph({ environment: EnvironmentDrivers.empty().withWebhook(driver) });
		const node = g.initNode(fromWebhook("github"), []);
		const msgs: Message[] = [];
		const unsubscribe = node.subscribe((msg) => msgs.push(msg));

		unsubscribe();
		expect(driver.activeCount()).toBe(0);
		driver.emitIgnoringCancel({
			kind: "event",
			event: {
				registrationId: "github",
				method: "POST",
				path: "/github",
				headers: [],
				query: [],
				body: new Uint8Array([1]),
			},
		});

		expect(msgs).toEqual([["START"]]);
	});
});
