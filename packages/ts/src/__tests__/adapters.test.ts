import { describe, expect, it, vi } from "vitest";
import {
	externalStore,
	jotaiAtom,
	nanoAtom,
	nodeSnapshot,
	readableStore,
	recordReadableStore,
	signalFromNode,
	subscribeNodeValues,
	writableStore,
	zustandStore,
} from "../adapters/index.js";
import {
	fromNestError,
	fromNestGuard,
	fromNestIntercept,
	fromNestLifecycle,
	fromNestReq,
	GRAPHREFLY_REQUEST_GRAPH,
	GRAPHREFLY_ROOT_GRAPH,
	GraphCron,
	GraphInterval,
	getGraphToken,
	getNestBoundaryToken,
	getNodeToken,
	NEST_BOUNDARY_BINDINGS,
	CRON_HANDLERS as NEST_CRON_HANDLERS,
	EVENT_HANDLERS as NEST_EVENT_HANDLERS,
	INTERVAL_HANDLERS as NEST_INTERVAL_HANDLERS,
	NestBoundary,
	type NestBoundaryEnvelope,
	nestProvider,
	OnGraphEvent,
	toNestHttp,
} from "../adapters/nestjs.js";
import { graph } from "../graph/index.js";

describe("framework-neutral store adapters (B61)", () => {
	it("adapts a node to a readable store with one immediate snapshot", () => {
		const g = graph();
		const count = g.state(1);
		const store = readableStore(count);
		const seen: Array<number | undefined> = [];

		const unsubscribe = store.subscribe((value) => seen.push(value));
		count.set(2);
		unsubscribe();
		count.set(3);

		expect(store.get()).toBe(3);
		expect(seen).toEqual([1, 2]);
		expect(nodeSnapshot(count)).toBe(3);
	});

	it("adapts a StateNode to a writable store", () => {
		const g = graph();
		const count = g.state(1);
		const store = writableStore(count);
		const seen: Array<number | undefined> = [];

		const unsubscribe = store.subscribe((value) => seen.push(value));
		store.set(2);
		store.update((value) => (value ?? 0) + 3);
		unsubscribe();

		expect(store.get()).toBe(5);
		expect(count.cache).toBe(5);
		expect(seen).toEqual([1, 2, 5]);
	});

	it("supports change-only value subscriptions", () => {
		const g = graph();
		const count = g.state(1);
		const seen: Array<number | undefined> = [];

		const unsubscribe = subscribeNodeValues(count, (value) => seen.push(value), {
			changesOnly: true,
		});
		count.set(2);
		unsubscribe();
		count.set(3);

		expect(seen).toEqual([2]);
	});

	it("keeps activation DATA while suppressing cached and replayed subscribe history", () => {
		const g = graph();
		const count = g.state(2);
		const doubled = g.derived([count], (value) => value * 2);
		const coldSeen: Array<number | undefined> = [];

		const unsubscribeCold = readableStore(doubled).subscribe((value) => coldSeen.push(value));
		unsubscribeCold();

		const replayed = g.node<number>([], null, { replayBuffer: 3 });
		replayed.down([
			["DATA", 1],
			["DATA", 2],
			["DATA", 3],
		]);
		const changes: Array<number | undefined> = [];
		const unsubscribeChanges = subscribeNodeValues(replayed, (value) => changes.push(value), {
			changesOnly: true,
		});
		replayed.down([["DATA", 4]]);
		unsubscribeChanges();

		expect(coldSeen).toEqual([undefined, 4]);
		expect(changes).toEqual([4]);
	});

	it("routes ERROR and COMPLETE lifecycle messages without exposing protocol internals as values", () => {
		const g = graph();
		const source = g.node<number>([], null, { resubscribable: true });
		const values: Array<number | undefined> = [];
		const errors: unknown[] = [];
		const complete = vi.fn();

		const unsubscribe = subscribeNodeValues(source, (value) => values.push(value), {
			onError: (error) => errors.push(error),
			onComplete: complete,
		});

		source.down([["DATA", 1]]);
		const err = new Error("boom");
		source.down([["ERROR", err]]);

		expect(values).toEqual([1]);
		expect(errors).toEqual([err]);
		expect(complete).not.toHaveBeenCalled();

		unsubscribe();

		const next = g.node<number>([], null);
		subscribeNodeValues(next, (value) => values.push(value), { onComplete: complete });
		next.down([["COMPLETE"]]);
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it("builds a React-compatible external-store shape without importing React", () => {
		const g = graph();
		const count = g.state(1);
		const store = externalStore(count);
		const changed = vi.fn();

		const unsubscribe = store.subscribe(changed);
		expect(store.getSnapshot()).toBe(1);
		expect(store.getServerSnapshot()).toBe(1);

		count.set(2);
		unsubscribe();
		count.set(3);

		expect(changed).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot()).toBe(3);
	});

	it("builds a keyed record store without framework hooks", () => {
		const g = graph();
		const keys = g.state<readonly string[]>(["a"]);
		const a = g.state(1);
		const b = g.state(2);
		const values: Record<string, typeof a> = { a, b };
		const store = recordReadableStore(keys, (key) => ({ value: values[key] }));
		const seen: Array<Record<string, { value: number }>> = [];

		const unsubscribe = store.subscribe((snapshot) => {
			seen.push(snapshot as Record<string, { value: number }>);
		});
		values.a.set(3);
		keys.set(["a", "b"]);
		values.b.set(4);
		unsubscribe();
		values.a.set(5);

		expect(seen).toEqual([
			{ a: { value: 1 } },
			{ a: { value: 3 } },
			{ a: { value: 3 }, b: { value: 2 } },
			{ a: { value: 3 }, b: { value: 4 } },
		]);
	});

	it("builds Zustand/Jotai/Nanostores/signals-style facades over caller-owned nodes", () => {
		const g = graph();
		const state = g.state({ count: 1 });
		const zustand = zustandStore(state);
		const zustandSeen: Array<readonly [number, number]> = [];
		const unsubZustand = zustand.subscribe((next, prev) => {
			zustandSeen.push([next.count, prev.count]);
		});

		zustand.setState((prev) => ({ count: prev.count + 1 }));
		zustand.setState({ count: 10 }, true);
		unsubZustand();

		const jotai = jotaiAtom(state);
		const nano = nanoAtom(state);
		const signal = signalFromNode(state);
		const jotaiSeen: Array<number | undefined> = [];
		const nanoSeen: Array<number | undefined> = [];
		const signalSeen: Array<number | undefined> = [];

		const unsubJotai = jotai.subscribe((value) => jotaiSeen.push(value?.count));
		const unsubNano = nano.listen((value) => nanoSeen.push(value?.count));
		const unsubSignal = signal.subscribe((value) => signalSeen.push(value?.count));

		jotai.set({ count: 11 });
		nano.update((value) => ({ count: (value?.count ?? 0) + 1 }));
		signal.set({ count: 13 });
		unsubJotai();
		unsubNano();
		unsubSignal();
		zustand.destroy();

		expect(zustandSeen).toEqual([
			[2, 1],
			[10, 2],
		]);
		expect(jotai.get()?.count).toBe(13);
		expect(nano.get()?.count).toBe(13);
		expect(signal.get()?.count).toBe(13);
		expect(jotaiSeen).toEqual([11, 12, 13]);
		expect(nanoSeen).toEqual([11, 12, 13]);
		expect(signalSeen).toEqual([11, 12, 13]);
	});

	it("requires writable facades to use StateNode.set or an explicit write bridge", () => {
		const g = graph();
		const readonly = g.node<number>([], null);
		const readonlyObject = g.node<{ count: number }>([], null);
		const unsafeWritableStore = writableStore as unknown as (node: typeof readonly) => unknown;
		const unsafeZustandStore = zustandStore as unknown as (
			node: typeof readonlyObject,
			initialState: { count: number },
		) => unknown;

		expect(() => unsafeWritableStore(readonly)).toThrow(/set\(value\) or opts\.write/);
		expect(() => unsafeZustandStore(readonlyObject, { count: 0 })).toThrow(
			/set\(value\) or opts\.write/,
		);

		const written: number[] = [];
		const explicit = writableStore(readonly, {
			write: (_node, value) => {
				written.push(value);
			},
		});
		explicit.set(7);

		expect(written).toEqual([7]);
	});

	it("exposes dependency-free NestJS tokens and method metadata helpers", () => {
		class Service {
			handle() {}
			tick() {}
			interval() {}
		}
		const eventInitializers: Array<(this: unknown) => void> = [];
		const cronInitializers: Array<(this: unknown) => void> = [];

		OnGraphEvent("orders::created")(Service.prototype.handle, {
			name: "handle",
			addInitializer(fn: (this: unknown) => void) {
				eventInitializers.push(fn);
			},
		} as ClassMethodDecoratorContext);
		GraphCron("* * * * *")(Service.prototype.tick, {
			name: "tick",
			addInitializer(fn: (this: unknown) => void) {
				cronInitializers.push(fn);
			},
		} as ClassMethodDecoratorContext);
		GraphInterval(1000)(Service.prototype, "interval", {
			value: Service.prototype.interval,
		});

		const service = new Service();
		eventInitializers.forEach((fn) => {
			fn.call(service);
			fn.call(service);
		});
		cronInitializers.forEach((fn) => {
			fn.call(service);
			fn.call(service);
		});

		expect(GRAPHREFLY_ROOT_GRAPH).toBe(Symbol.for("graphrefly:root-graph"));
		expect(GRAPHREFLY_REQUEST_GRAPH).toBe(Symbol.for("graphrefly:request-graph"));
		expect(getGraphToken("orders")).toBe(Symbol.for("graphrefly:graph:orders"));
		expect(getNodeToken("orders::created")).toBe(Symbol.for("graphrefly:node:orders::created"));
		expect(NEST_EVENT_HANDLERS.get(Service)).toEqual([
			{ nodeName: "orders::created", methodKey: "handle" },
		]);
		expect(NEST_CRON_HANDLERS.get(Service)).toEqual([{ expr: "* * * * *", methodKey: "tick" }]);
		expect(NEST_INTERVAL_HANDLERS.get(Service)).toEqual([{ ms: 1000, methodKey: "interval" }]);
	});

	it("exposes focused NestJS boundary tokens, provider shapes, and binding metadata", () => {
		class Controller {
			post() {}
		}
		const initializers: Array<(this: unknown) => void> = [];

		NestBoundary("request", "orders.http")(Controller.prototype.post, {
			name: "post",
			addInitializer(fn: (this: unknown) => void) {
				initializers.push(fn);
			},
		} as ClassMethodDecoratorContext);

		const controller = new Controller();
		initializers.forEach((fn) => {
			fn.call(controller);
		});

		const token = getNestBoundaryToken("orders.http");
		expect(token).toBe(Symbol.for("graphrefly:nest-boundary:orders.http"));
		expect(nestProvider(token, "value")).toEqual({ provide: token, useValue: "value" });
		expect(NEST_BOUNDARY_BINDINGS.get(Controller)).toEqual([
			{ kind: "request", bindingId: "orders.http", methodKey: "post" },
		]);
	});

	it("builds keyed Nest ingress envelopes with stable explicit binding ids", () => {
		const g = graph();
		const req = fromNestReq<
			{ requestId: string; body: { readonly orderId: string } },
			{ readonly orderId: string }
		>(g, {
			bindingId: "orders.create",
			payload: (host) => host.body,
		});
		const seen: NestBoundaryEnvelope<{ readonly orderId: string }>[] = [];
		const unsubscribe = req.node.subscribe((msg) => {
			if (msg[0] === "DATA")
				seen.push(msg[1] as NestBoundaryEnvelope<{ readonly orderId: string }>);
		});

		const envelope = req.emit({ requestId: "req-1", body: { orderId: "o-1" } });
		unsubscribe();

		expect(req.bindingId).toBe("orders.create");
		expect(envelope).toEqual({
			requestId: "req-1",
			bindingId: "orders.create",
			version: 1,
			payload: { orderId: "o-1" },
		});
		expect(seen).toEqual([envelope]);
		expect(g.describe().nodes.some((node) => node.id === "nestjs/request/orders.create")).toBe(
			true,
		);
	});

	it("uses deterministic non-random binding ids for Nest ingress fallbacks", () => {
		const g = graph();

		expect(fromNestGuard(g).bindingId).toBe("nestjs.guard");
		expect(fromNestIntercept(g, { name: "orders.intercept" }).bindingId).toBe("orders.intercept");
		expect(fromNestError(g, { bindingId: "orders.error" }).bindingId).toBe("orders.error");
		expect(fromNestLifecycle(g, { bindingId: "app.lifecycle" }).bindingId).toBe("app.lifecycle");
	});

	it("keeps host-private HTTP handles out of graph DATA and resolves only matching request ids", () => {
		const g = graph();
		const egress = g.node<NestBoundaryEnvelope<{ readonly status: number; readonly body: string }>>(
			[],
			null,
			{ name: "nestjs/http/orders.out" },
		);
		const http = toNestHttp(egress, { bindingId: "orders.http" });
		const resolved: unknown[] = [];
		const handle = {
			secret: { socket: true },
			resolve(payload: unknown) {
				resolved.push(payload);
			},
			reject: vi.fn(),
		};

		http.attach({ requestId: "req-1", handle });
		egress.down([
			[
				"DATA",
				{
					requestId: "req-stale",
					bindingId: "orders.http",
					version: 1,
					payload: { status: 200, body: "stale" },
				},
			],
		]);
		egress.down([
			[
				"DATA",
				{
					requestId: "req-1",
					bindingId: "other.http",
					version: 1,
					payload: { status: 200, body: "wrong binding" },
				},
			],
		]);
		egress.down([
			[
				"DATA",
				{
					requestId: "req-1",
					bindingId: "orders.http",
					version: 1,
					payload: { status: 201, body: "created" },
				},
			],
		]);

		expect(resolved).toEqual([{ status: 201, body: "created" }]);
		expect(http.pendingCount()).toBe(0);
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual([
			"stale-egress",
			"binding-mismatch",
		]);
		(http.diagnostics() as unknown[]).length = 0;
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual([
			"stale-egress",
			"binding-mismatch",
		]);
		expect(JSON.stringify(resolved)).not.toContain("socket");
		http.dispose();
	});

	it("matches Nest HTTP egress by request id by default and scopes by binding id only when requested", () => {
		const g = graph();
		const egress = g.node<NestBoundaryEnvelope<{ readonly ok: true }>>([], null, {
			name: "nestjs/http/default.out",
		});
		const http = toNestHttp(egress);
		const resolved: unknown[] = [];

		http.attach({
			requestId: "req-1",
			handle: {
				resolve(payload) {
					resolved.push(payload);
				},
				reject: vi.fn(),
			},
		});
		egress.down([
			[
				"DATA",
				{ requestId: "req-1", bindingId: "caller.binding", version: 1, payload: { ok: true } },
			],
		]);

		expect(resolved).toEqual([{ ok: true }]);
		expect(http.diagnostics()).toEqual([]);
		http.dispose();
	});

	it("guards Nest HTTP pending lifecycle and diagnostic retention", () => {
		const g = graph();
		const egress = g.node<NestBoundaryEnvelope<{ readonly ok: boolean }>>([], null, {
			name: "nestjs/http/guarded.out",
		});
		const onDiagnostic = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error("diagnostic handler failed");
			})
			.mockImplementation(() => undefined);
		const http = toNestHttp(egress, {
			bindingId: "orders.http",
			maxDiagnostics: 2,
			onDiagnostic,
		});
		const handle = { resolve: vi.fn(), reject: vi.fn() };

		http.attach({ requestId: "req-1", handle });
		expect(() => http.attach({ requestId: "req-1", handle })).toThrow(/duplicate pending/);

		egress.down([
			[
				"DATA",
				{ requestId: "stale-1", bindingId: "orders.http", version: 1, payload: { ok: false } },
			],
			[
				"DATA",
				{ requestId: "stale-2", bindingId: "orders.http", version: 1, payload: { ok: false } },
			],
			[
				"DATA",
				{ requestId: "stale-3", bindingId: "orders.http", version: 1, payload: { ok: false } },
			],
		]);

		expect(onDiagnostic).toHaveBeenCalledTimes(3);
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual([
			"stale-egress",
			"stale-egress",
		]);
		const cleanup = http.attach({ requestId: "req-2", handle });
		expect(cleanup()).toBe(true);
		expect(cleanup()).toBe(false);
		http.dispose();
		expect(() => http.attach({ requestId: "req-3", handle })).toThrow(/disposed/);
	});

	it("rejects pending Nest HTTP handles on terminal egress and dispose", () => {
		const g = graph();
		const egress = g.node<NestBoundaryEnvelope<{ readonly ok: boolean }>>([], null, {
			name: "nestjs/http/terminal.out",
		});
		const http = toNestHttp(egress, { bindingId: "orders.http" });
		const terminalHandle = { resolve: vi.fn(), reject: vi.fn() };
		const disposeHandle = { resolve: vi.fn(), reject: vi.fn() };

		http.attach({ requestId: "req-terminal", handle: terminalHandle });
		egress.down([["ERROR", new Error("egress closed")]]);

		expect(terminalHandle.resolve).not.toHaveBeenCalled();
		expect(terminalHandle.reject).toHaveBeenCalledTimes(1);
		expect(http.pendingCount()).toBe(0);
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toContain("terminal-egress");

		http.attach({ requestId: "req-dispose", handle: disposeHandle });
		http.dispose();

		expect(disposeHandle.resolve).not.toHaveBeenCalled();
		expect(disposeHandle.reject).toHaveBeenCalledTimes(1);
		expect(http.pendingCount()).toBe(0);
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toContain("dispose-pending");
	});

	it("rejects non-data Nest boundary payload material on ingress and egress", () => {
		const g = graph();
		const req = fromNestReq(g, { bindingId: "orders.strict", maxPayloadBytes: 24 });
		const sparse = [] as unknown[];
		sparse[1] = "hole";
		const hidden = { ok: true } as { ok: boolean; runtime?: unknown };
		Object.defineProperty(hidden, "runtime", {
			enumerable: false,
			value: () => undefined,
		});
		const accessorArray: unknown[] = [];
		Object.defineProperty(accessorArray, "0", {
			enumerable: true,
			get() {
				throw new Error("getter executed");
			},
		});

		expect(() => req.emit({ requestId: "req-1" }, { payload: sparse })).toThrow(/sparse/);
		expect(() => req.emit({ requestId: "req-1" }, { payload: accessorArray })).toThrow(
			/enumerable plain data/,
		);
		expect(() => req.emit({ requestId: "req-1" }, { payload: hidden })).toThrow(
			/enumerable plain data/,
		);
		expect(() =>
			req.emit({ requestId: "req-1" }, { payload: { text: "this is too large" } }),
		).toThrow(/exceeds/);
		expect(() => req.emit({ requestId: "req-1" }, { payload: Number.NaN })).toThrow(/finite/);
		expect(() => fromNestReq(g, { bindingId: "bad.version", version: 0 })).toThrow(
			/positive safe integer/,
		);
		expect(() => req.emit({ requestId: "req-1" }, { version: Number.NaN, payload: null })).toThrow(
			/positive safe integer/,
		);

		const egress = g.node<NestBoundaryEnvelope<unknown>>([], null, {
			name: "nestjs/http/strict.out",
		});
		const http = toNestHttp(egress, { bindingId: "orders.strict", maxPayloadBytes: 24 });
		const handle = { resolve: vi.fn(), reject: vi.fn() };

		http.attach({ requestId: "req-1", handle });
		egress.down([
			["DATA", { requestId: "req-1", bindingId: "orders.strict", version: 1, payload: undefined }],
			[
				"DATA",
				{
					requestId: "req-1",
					bindingId: "orders.strict",
					version: 1,
					payload: { socket: () => undefined },
				},
			],
		]);

		expect(handle.resolve).not.toHaveBeenCalled();
		expect(http.pendingCount()).toBe(1);
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual([
			"malformed-egress",
			"malformed-egress",
		]);
		http.dispose();
	});

	it("guards Nest ingress payloads against host runtime objects", () => {
		const g = graph();
		const req = fromNestReq(g, { bindingId: "orders.raw" });

		expect(() =>
			req.emit({ requestId: "req-1" }, { payload: { body: "ok", response: () => undefined } }),
		).toThrow(/data-only/);
		expect(() =>
			req.emit({ requestId: "req-1" }, { payload: { socket: new Map<string, string>() } }),
		).toThrow(/plain data object/);
	});
});
