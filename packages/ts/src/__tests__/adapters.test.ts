import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
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
	createGraphMessageBridge,
	fromNestMessage,
	GRAPHREFLY_NEST_MESSAGE_BRIDGE,
	GraphMessage,
	type GraphMessageBridge,
	GraphMessageReply,
	provideGraphMessageProviders,
} from "../adapters/nestjs/microservices.js";
import {
	createGraphCronController,
	createGraphExceptionFilter,
	createGraphGuardDeniedFilter,
	GraphGuardDeniedException,
	GraphGuardDeniedFilter,
	graphCronTarget,
	graphLifecycleTarget,
	isGraphGuardDeniedException,
	provideGraphBoundaryInterceptor,
	provideGraphCronScheduler,
	provideGraphExceptionFilter,
	provideGraphGuard,
	provideGraphGuardDeniedFilter,
	provideGraphLifecycleHooks,
	provideGraphNativeHttpProviders,
	provideGraphNativeProviders,
} from "../adapters/nestjs/native.js";
import {
	createGraphWsBridge,
	fromNestWs,
	GRAPHREFLY_NEST_WS_BRIDGE,
	GraphWs,
	GraphWsAck,
	type GraphWsBridge,
	GraphWsReply,
	provideGraphWsProviders,
} from "../adapters/nestjs/websockets.js";
import {
	createNestGraphBoundaryInterceptor,
	createNestGraphBoundaryRunner,
	fromNestCron,
	fromNestDiagnostics,
	fromNestError,
	fromNestGuard,
	fromNestIntercept,
	fromNestLifecycle,
	fromNestReq,
	GRAPHREFLY_REQUEST_GRAPH,
	GRAPHREFLY_ROOT_GRAPH,
	GraphCron,
	GraphError,
	GraphFilter,
	GraphGuard,
	GraphGuardDecision,
	type GraphGuardDecision as GraphGuardDecisionPayload,
	GraphHttpReply,
	GraphInterval,
	GraphLifecycle,
	GraphReq,
	getGraphToken,
	getNestBoundaryBindings,
	getNestBoundaryToken,
	getNodeToken,
	type HttpDataIssue,
	issueResponse,
	lowerHttpReplyPayload,
	lowerProtocolError,
	NEST_BOUNDARY_BINDINGS,
	CRON_HANDLERS as NEST_CRON_HANDLERS,
	EVENT_HANDLERS as NEST_EVENT_HANDLERS,
	INTERVAL_HANDLERS as NEST_INTERVAL_HANDLERS,
	type NestBoundaryEnvelope,
	type NestDiagnosticIngressBoundary,
	type NestReplyEnvelope,
	nestProvider,
	OnGraphEvent,
	protocolError,
	sanitizeNestDiagnostic,
	toNestHttp,
} from "../adapters/nestjs.js";
import { depLatest } from "../ctx/types.js";
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
			interval() {}
		}
		const eventInitializers: Array<(this: unknown) => void> = [];

		OnGraphEvent("orders::created")(Service.prototype.handle, {
			name: "handle",
			addInitializer(fn: (this: unknown) => void) {
				eventInitializers.push(fn);
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

		expect(GRAPHREFLY_ROOT_GRAPH).toBe(Symbol.for("graphrefly:root-graph"));
		expect(GRAPHREFLY_REQUEST_GRAPH).toBe(Symbol.for("graphrefly:request-graph"));
		expect(getGraphToken("orders")).toBe(Symbol.for("graphrefly:graph:orders"));
		expect(getNodeToken("orders::created")).toBe(Symbol.for("graphrefly:node:orders::created"));
		expect(NEST_EVENT_HANDLERS.get(Service)).toEqual([
			{ nodeName: "orders::created", methodKey: "handle" },
		]);
		expect(NEST_CRON_HANDLERS.get(Service)).toBeUndefined();
		expect(NEST_INTERVAL_HANDLERS.get(Service)).toEqual([{ ms: 1000, methodKey: "interval" }]);
	});

	it("records concrete D478 GraphReq and GraphHttpReply binding metadata", () => {
		const g = graph();
		const req = fromNestReq(g, { bindingId: "node.http.in" });
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null, {
			name: "reply/node",
		});
		class Controller {
			post() {}
		}
		const initializers: Array<(this: unknown) => void> = [];

		GraphReq(req, { bindingId: "http.orders.create.in" })(Controller.prototype.post, {
			name: "post",
			addInitializer(fn: (this: unknown) => void) {
				initializers.push(fn);
			},
		} as ClassMethodDecoratorContext);
		GraphHttpReply(reply, { bindingId: "http.orders.create.out" })(Controller.prototype.post, {
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
			expect.objectContaining({
				direction: "ingress",
				kind: "request",
				bindingId: "http.orders.create.in",
				methodKey: "post",
				boundary: req,
			}),
			expect.objectContaining({
				direction: "egress",
				kind: "http",
				bindingId: "http.orders.create.out",
				methodKey: "post",
				replyNode: reply,
			}),
		]);
		expect(() => GraphReq(fromNestGuard(g))).toThrow(/expected a request boundary/);
		expect(() => GraphHttpReply(reply, {} as { readonly bindingId: string })).toThrow(/bindingId/);
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
		expect(g.describe().nodes.some((node) => node.meta?.bindingId === "orders.create")).toBe(true);
	});

	it("allows lifecycle and cron ingress envelopes without fake request ids", () => {
		const g = graph();
		const lifecycle = fromNestLifecycle(g, {
			bindingId: "lifecycle.app.in",
			payload: (host: { readonly event: string }) => ({ event: host.event }),
		});
		const cron = fromNestCron(g, {
			bindingId: "cron.daily.in",
			payload: (host: { readonly tick: string }) => ({ tick: host.tick }),
		});

		expect(lifecycle.emit({ event: "module-destroy" })).toEqual({
			bindingId: "lifecycle.app.in",
			version: 1,
			payload: { event: "module-destroy" },
		});
		expect(cron.emit({ tick: "midnight" })).toEqual({
			bindingId: "cron.daily.in",
			version: 1,
			payload: { tick: "midnight" },
		});
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
		const egress = g.node<NestReplyEnvelope<{ readonly status: number; readonly body: string }>>(
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
		const egress = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null, {
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

	it("rejects future Nest HTTP attaches after terminal egress", () => {
		const g = graph();
		const egress = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null, {
			name: "nestjs/http/terminal.out",
		});
		const http = toNestHttp(egress, { bindingId: "terminal.http" });
		const error = new Error("terminal boom");
		const firstRejected: unknown[] = [];
		const laterRejected: unknown[] = [];

		http.attach({
			requestId: "req-1",
			handle: {
				resolve: vi.fn(),
				reject(rejected) {
					firstRejected.push(rejected);
				},
			},
		});
		egress.down([["ERROR", error]]);
		const cleanup = http.attach({
			requestId: "req-2",
			handle: {
				resolve: vi.fn(),
				reject(rejected) {
					laterRejected.push(rejected);
				},
			},
		});

		expect(firstRejected).toEqual([error]);
		expect(laterRejected).toEqual([error]);
		expect(cleanup()).toBe(false);
		expect(http.pendingCount()).toBe(0);
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual([
			"terminal-egress",
			"terminal-egress",
		]);
		http.dispose();
	});

	it("brackets decorator-bound attach, emit, and cleanup in the high-level runner", async () => {
		const g = graph();
		const req = fromNestReq<
			{ readonly requestId: string; readonly body: { readonly ok: true }; readonly fail?: boolean },
			{ readonly ok: true }
		>(g, {
			bindingId: "node.orders.in",
			requestId: (host) => host.requestId,
			payload: (host) => {
				if (host.fail) throw new Error("payload failed");
				return host.body;
			},
		});
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>(
			[req.node],
			(ctx) => {
				const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly ok: true }>;
				if (envelope.requestId === undefined) return;
				ctx.down([
					[
						"DATA",
						{
							requestId: envelope.requestId,
							bindingId: "http.orders.out",
							version: 1,
							payload: envelope.payload,
						},
					],
				]);
			},
			{ name: "http.orders.out" },
		);
		class Controller {
			post() {}
		}
		GraphReq(req, { bindingId: "http.orders.in" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		GraphHttpReply(reply, { bindingId: "http.orders.out" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		const runner = createNestGraphBoundaryRunner();

		expect(() =>
			runner.run(Controller, "post", { requestId: "req-1", body: { ok: true }, fail: true }),
		).toThrow(/payload failed/);
		await expect(
			runner.run(Controller, "post", { requestId: "req-1", body: { ok: true } }),
		).resolves.toEqual({ ok: true });
		expect(() => runner.run(Controller, "post", { body: { ok: true } })).toThrow(
			/GraphHttpReply requires/,
		);
		runner.dispose();
	});

	it("uses binding-level request ids when attaching high-level HTTP replies", async () => {
		const g = graph();
		const req = fromNestReq<
			{ readonly routeRequestId: string; readonly body: { readonly ok: true } },
			{ readonly ok: true }
		>(g, {
			bindingId: "node.binding-request.in",
			payload: (host) => host.body,
		});
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([req.node], (ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly ok: true }>;
			if (envelope.requestId === undefined) return;
			ctx.down([
				[
					"DATA",
					{
						requestId: envelope.requestId,
						bindingId: "http.binding-request.out",
						version: 1,
						payload: envelope.payload,
					},
				],
			]);
		});
		class Controller {
			post() {}
		}
		GraphReq(req, {
			bindingId: "http.binding-request.in",
			requestId: (host) => host.routeRequestId,
		})(Controller.prototype, "post", { value: Controller.prototype.post });
		GraphHttpReply(reply, { bindingId: "http.binding-request.out" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		const runner = createNestGraphBoundaryRunner();

		await expect(
			runner.run(Controller, "post", {
				routeRequestId: "req-binding",
				body: { ok: true },
			}),
		).resolves.toEqual({ ok: true });
		runner.dispose();
	});

	it("limits the high-level interceptor runner to request/interceptor ingress and HTTP egress", () => {
		const g = graph();
		const req = fromNestReq<{ readonly requestId: string }, { readonly ok: true }>(g, {
			bindingId: "node.phase.request.in",
			payload: () => ({ ok: true }),
		});
		const guard = fromNestGuard<{ readonly requestId: string }, { readonly guard: true }>(g, {
			bindingId: "node.phase.guard.in",
			payload: () => ({ guard: true }),
		});
		const decision = g.node<NestReplyEnvelope<GraphGuardDecisionPayload>>([], null);
		const requestSeen: unknown[] = [];
		const guardSeen: unknown[] = [];
		req.node.subscribe((msg) => msg[0] === "DATA" && requestSeen.push(msg[1]));
		guard.node.subscribe((msg) => msg[0] === "DATA" && guardSeen.push(msg[1]));
		class Controller {
			post() {}
		}
		GraphReq(req, { bindingId: "http.phase.request.in" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		GraphGuard(guard, { bindingId: "guard.phase.in" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		GraphGuardDecision(decision, { bindingId: "guard.phase.out" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		const runner = createNestGraphBoundaryRunner();

		expect(runner.run(Controller, "post", { requestId: "req-phase" })).toBeUndefined();
		expect(requestSeen).toHaveLength(1);
		expect(guardSeen).toHaveLength(0);
		runner.dispose();
	});

	it("fails fast when GraphHttpReply is configured without a matching ingress binding", () => {
		const g = graph();
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null, {
			name: "http.reply-only.out",
		});
		class Controller {
			post() {}
		}
		GraphHttpReply(reply, { bindingId: "http.reply-only.out" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		const runner = createNestGraphBoundaryRunner();

		expect(() => runner.run(Controller, "post", { requestId: "req-reply-only" })).toThrow(
			/requires at least one ingress/,
		);
		runner.dispose();
	});

	it("does not emit ingress when high-level reply attach fails", () => {
		const g = graph();
		const req = fromNestReq<{ readonly requestId: string }, { readonly ok: true }>(g, {
			bindingId: "node.duplicate.in",
			payload: () => ({ ok: true }),
		});
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null, {
			name: "http.duplicate.out",
		});
		const seen: unknown[] = [];
		const unsubscribe = req.node.subscribe((msg) => {
			if (msg[0] === "DATA") seen.push(msg[1]);
		});
		class Controller {
			post() {}
		}
		GraphReq(req, { bindingId: "http.duplicate.in" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		GraphHttpReply(reply, { bindingId: "http.duplicate.out" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		const runner = createNestGraphBoundaryRunner();
		const pending = runner.run(Controller, "post", { requestId: "req-dup" });
		if (pending) pending.catch(() => undefined);

		expect(() => runner.run(Controller, "post", { requestId: "req-dup" })).toThrow(
			/duplicate pending/,
		);
		expect(seen).toHaveLength(1);
		unsubscribe();
		runner.dispose();
	});

	it("resolves inherited Nest boundary metadata for subclass controllers", async () => {
		const g = graph();
		const req = fromNestReq<{ readonly requestId: string }, { readonly ok: true }>(g, {
			bindingId: "node.inherited.in",
			payload: () => ({ ok: true }),
		});
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>(
			[req.node],
			(ctx) => {
				const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly ok: true }>;
				if (envelope.requestId === undefined) return;
				ctx.down([
					[
						"DATA",
						{
							requestId: envelope.requestId,
							bindingId: "http.inherited.out",
							version: 1,
							payload: envelope.payload,
						},
					],
				]);
			},
			{ name: "http.inherited.out" },
		);
		class BaseController {
			post() {}
		}
		class ChildController extends BaseController {}
		GraphReq(req, { bindingId: "http.inherited.in" })(BaseController.prototype, "post", {
			value: BaseController.prototype.post,
		});
		GraphHttpReply(reply, { bindingId: "http.inherited.out" })(BaseController.prototype, "post", {
			value: BaseController.prototype.post,
		});
		const runner = createNestGraphBoundaryRunner();

		await expect(
			runner.run(ChildController, "post", { requestId: "req-inherited" }),
		).resolves.toEqual({ ok: true });
		runner.dispose();
	});

	it("derives a default request id in the high-level interceptor for plain Nest HTTP requests", async () => {
		const g = graph();
		const req = fromNestReq<{ readonly requestId: string }, { readonly ok: true }>(g, {
			bindingId: "node.default-interceptor.in",
			payload: () => ({ ok: true }),
		});
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>(
			[req.node],
			(ctx) => {
				const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly ok: true }>;
				if (envelope.requestId === undefined) return;
				ctx.down([
					[
						"DATA",
						{
							requestId: envelope.requestId,
							bindingId: "http.default-interceptor.out",
							version: 1,
							payload: envelope.payload,
						},
					],
				]);
			},
			{ name: "http.default-interceptor.out" },
		);
		class Controller {
			post() {}
		}
		GraphReq(req, { bindingId: "http.default-interceptor.in" })(Controller.prototype, "post", {
			value: Controller.prototype.post,
		});
		GraphHttpReply(reply, { bindingId: "http.default-interceptor.out" })(
			Controller.prototype,
			"post",
			{ value: Controller.prototype.post },
		);
		const interceptor = createNestGraphBoundaryInterceptor();
		const context = {
			getClass: () => Controller,
			getHandler: () => Controller.prototype.post,
			switchToHttp: () => ({
				getRequest: () => ({ headers: { "x-request-id": "header-req" } }),
			}),
		};

		await expect(interceptor.intercept(context)).resolves.toEqual({ ok: true });
		interceptor.dispose();
	});

	it("ignores lifecycle-only metadata in the interceptor phase bridge", () => {
		const g = graph();
		const lifecycle = fromNestLifecycle<unknown, { readonly event: string }>(g, {
			bindingId: "node.lifecycle.only",
			payload: () => ({ event: "teardown" }),
		});
		const seen: NestBoundaryEnvelope<{ readonly event: string }>[] = [];
		const unsubscribe = lifecycle.node.subscribe((msg) => {
			if (msg[0] === "DATA") seen.push(msg[1] as NestBoundaryEnvelope<{ readonly event: string }>);
		});
		class Controller {
			teardown() {}
		}
		GraphLifecycle(lifecycle, { bindingId: "lifecycle.only" })(Controller.prototype, "teardown", {
			value: Controller.prototype.teardown,
		});
		const interceptor = createNestGraphBoundaryInterceptor();
		const context = {
			getClass: () => Controller,
			getHandler: () => Controller.prototype.teardown,
			switchToHttp: () => ({
				getRequest: () => ({ headers: {} }),
			}),
		};

		expect(interceptor.intercept(context, { handle: () => "next" })).toBe("next");
		expect(seen).toEqual([]);
		unsubscribe();
		interceptor.dispose();
	});

	it("guards Nest HTTP pending lifecycle and low-level diagnostic retention", () => {
		const g = graph();
		const egress = g.node<NestReplyEnvelope<{ readonly ok: boolean }>>([], null, {
			name: "nestjs/http/guarded.out",
		});
		const http = toNestHttp(egress, {
			bindingId: "orders.http",
			maxDiagnostics: 2,
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
		const egress = g.node<NestReplyEnvelope<{ readonly ok: boolean }>>([], null, {
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

		const terminalCleanup = http.attach({ requestId: "req-after-terminal", handle: disposeHandle });
		http.dispose();

		expect(disposeHandle.resolve).not.toHaveBeenCalled();
		expect(disposeHandle.reject).toHaveBeenCalledTimes(1);
		expect(terminalCleanup()).toBe(false);
		expect(http.pendingCount()).toBe(0);
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).not.toContain(
			"dispose-pending",
		);

		const disposeEgress = g.node<NestReplyEnvelope<{ readonly ok: boolean }>>([], null, {
			name: "nestjs/http/dispose.out",
		});
		const disposeHttp = toNestHttp(disposeEgress, { bindingId: "orders.dispose" });
		const liveDisposeHandle = { resolve: vi.fn(), reject: vi.fn() };

		disposeHttp.attach({ requestId: "req-dispose", handle: liveDisposeHandle });
		disposeHttp.dispose();

		expect(liveDisposeHandle.resolve).not.toHaveBeenCalled();
		expect(liveDisposeHandle.reject).toHaveBeenCalledTimes(1);
		expect(disposeHttp.pendingCount()).toBe(0);
		expect(disposeHttp.diagnostics().map((diagnostic) => diagnostic.kind)).toContain(
			"dispose-pending",
		);
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
		expect(() => fromNestReq(g, { bindingId: "bad.version", version: 0 })).toThrow(/must be 1/);
		expect(() => fromNestReq(g, { bindingId: "future.version", version: 2 })).toThrow(/must be 1/);
		expect(() => req.emit({ requestId: "req-1" }, { version: Number.NaN, payload: null })).toThrow(
			/must be 1/,
		);

		const egress = g.node<NestReplyEnvelope<unknown>>([], null, {
			name: "nestjs/http/strict.out",
		});
		const http = toNestHttp(egress, { bindingId: "orders.strict", maxPayloadBytes: 24 });
		const handle = { resolve: vi.fn(), reject: vi.fn() };

		http.attach({ requestId: "req-1", handle });
		egress.down([
			["DATA", { bindingId: "orders.strict", version: 1, payload: { ok: true } }],
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
			[
				"DATA",
				{
					requestId: "req-1",
					bindingId: "orders.strict",
					version: 2,
					payload: { ok: true },
				},
			],
		]);

		expect(handle.resolve).not.toHaveBeenCalled();
		expect(handle.reject).toHaveBeenCalledTimes(1);
		expect(http.pendingCount()).toBe(0);
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual([
			"malformed-egress",
			"malformed-egress",
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

	it("lets binding-level payload and requestId override factory defaults", () => {
		const g = graph();
		const req = fromNestReq<{ requestId: string; body: { value: string } }, { value: string }>(g, {
			bindingId: "node.shared.in",
			payload: () => ({ value: "factory" }),
			requestId: "factory-req",
		});
		const seen: unknown[] = [];
		req.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		class Controller {
			a() {}
			b() {}
		}
		GraphReq(req, {
			bindingId: "route.a",
			payload: (host) => host.body,
			requestId: (host) => host.requestId,
			order: 2,
		})(Controller.prototype, "a", { value: Controller.prototype.a });
		GraphReq(req, {
			bindingId: "route.b",
			payload: () => ({ value: "binding-b" }),
			requestId: "route-b-req",
			order: 1,
		})(Controller.prototype, "b", { value: Controller.prototype.b });

		const runner = createNestGraphBoundaryRunner();
		runner.run(Controller, "a", { requestId: "route-a-req", body: { value: "binding-a" } });
		runner.run(Controller, "b", { requestId: "ignored", body: { value: "ignored" } });

		expect(seen).toEqual([
			{
				bindingId: "route.a",
				version: 1,
				requestId: "route-a-req",
				payload: { value: "binding-a" },
			},
			{
				bindingId: "route.b",
				version: 1,
				requestId: "route-b-req",
				payload: { value: "binding-b" },
			},
		]);
		expect(getNestBoundaryBindings(Controller, "a")[0]).toMatchObject({
			bindingId: "route.a",
			order: 2,
		});
		runner.dispose();
	});

	it("records GraphFilter, GraphError sugar, GraphGuardDecision, and lowerers", () => {
		const g = graph();
		const error = fromNestError(g, { bindingId: "node.error.in" });
		const guard = fromNestGuard(g, { bindingId: "node.guard.in" });
		const decision = g.node<NestReplyEnvelope<GraphGuardDecisionPayload>>([], null);
		class Controller {
			filtered() {}
			guarded() {}
		}

		GraphFilter(error, { bindingId: "filter.generic", mode: "observe", order: 1 })(
			Controller.prototype,
			"filtered",
			{ value: Controller.prototype.filtered },
		);
		GraphError(error, { bindingId: "filter.error", mode: "handle", order: 2 })(
			Controller.prototype,
			"filtered",
			{ value: Controller.prototype.filtered },
		);
		GraphGuard(guard, { bindingId: "guard.in" })(Controller.prototype, "guarded", {
			value: Controller.prototype.guarded,
		});
		GraphGuardDecision(decision, { bindingId: "guard.out" })(Controller.prototype, "guarded", {
			value: Controller.prototype.guarded,
		});

		expect(
			getNestBoundaryBindings(Controller, "filtered").map((binding) => binding.bindingId),
		).toEqual(["filter.generic", "filter.error"]);
		expect(getNestBoundaryBindings(Controller, "guarded").map((binding) => binding.kind)).toEqual([
			"guard",
			"guard-decision",
		]);

		const httpIssue: HttpDataIssue = {
			kind: "issue",
			code: "orders.closed",
			message: "Orders are closed.",
			status: 409,
			body: { ok: false },
			headers: { "x-graphrefly-issue": "orders.closed" },
		};
		expect(issueResponse(httpIssue)).toEqual({
			status: 409,
			body: { ok: false },
			headers: { "x-graphrefly-issue": "orders.closed" },
		});
		expect(lowerHttpReplyPayload({ status: 202, body: { ok: true } }, {})).toEqual({
			status: 202,
			body: { ok: true },
		});
		expect(lowerHttpReplyPayload({ kind: "issue", code: "bad", message: "Bad" }, {})).toEqual({
			status: 400,
			body: { code: "bad", message: "Bad" },
		});
		expect(protocolError(new Error("secret")).status).toBe(500);
		expect(
			lowerProtocolError("boom", {}, { protocolError: () => ({ status: 599, body: "masked" }) }),
		).toEqual({ status: 599, body: "masked" });
	});

	it("exports Nest-native provider bridge objects without leaking them through the generic barrel", () => {
		expect(provideGraphBoundaryInterceptor()).toMatchObject({ provide: expect.anything() });
		expect(provideGraphGuard()).toMatchObject({ provide: expect.anything() });
		expect(typeof createGraphExceptionFilter({ target: () => undefined }).catch).toBe("function");
		expect(provideGraphExceptionFilter({ target: () => undefined })).toMatchObject({
			provide: expect.anything(),
		});
		const guardDeniedProvider = provideGraphGuardDeniedFilter();
		expect(createGraphGuardDeniedFilter()).toBeInstanceOf(GraphGuardDeniedFilter);
		expect(guardDeniedProvider).toBe(GraphGuardDeniedFilter);
		expect(guardDeniedProvider).not.toBe(APP_FILTER);
		expect(provideGraphExceptionFilter({ target: () => undefined }).provide).not.toBe(APP_FILTER);
		expect(provideGraphCronScheduler({ targets: [] })).toMatchObject({
			provide: expect.any(Symbol),
		});
		expect(provideGraphLifecycleHooks({ targets: [] })).toMatchObject({
			provide: expect.any(Symbol),
		});
		expect("GraphReq" in ({} as typeof import("../adapters/index.js"))).toBe(false);
	});

	it("builds explicit native provider bundles without scanning or creating graphs", () => {
		const target = () => ({ target: class Target {}, methodKey: "handle" });
		const httpProviders = provideGraphNativeHttpProviders({
			boundaryInterceptor: { host: () => ({ requestId: "req-1" }) },
			guard: {},
			exceptionFilter: { target },
		});

		expect(
			httpProviders.map((provider) =>
				typeof provider === "function" ? provider : provider.provide,
			),
		).toEqual([APP_INTERCEPTOR, APP_GUARD, GraphGuardDeniedFilter, expect.any(Symbol)]);
		expect(provideGraphNativeHttpProviders({ guardDeniedFilter: false })).toHaveLength(2);

		class Controller {
			tick() {}
			stop() {}
		}
		const cronTarget = graphCronTarget(Controller, "tick", {
			expr: "* * * * *",
			timezone: "UTC",
			target: class WrongCronTarget {},
			methodKey: "wrong",
		} as Parameters<typeof graphCronTarget>[2]);
		const lifecycleTarget = graphLifecycleTarget(Controller, "stop", {
			event: "module-destroy",
			target: class WrongLifecycleTarget {},
			methodKey: "wrong",
		});
		const nativeProviders = provideGraphNativeProviders({
			http: false,
			cronScheduler: { targets: [cronTarget] },
			lifecycleHooks: { targets: [lifecycleTarget] },
		});

		expect(cronTarget).toMatchObject({ target: Controller, methodKey: "tick" });
		expect(lifecycleTarget).toMatchObject({ target: Controller, methodKey: "stop" });
		expect(nativeProviders).toHaveLength(2);
		expect(nativeProviders.every((provider) => typeof provider !== "function")).toBe(true);
	});

	it("builds D495 focused WebSocket and message provider bundles over explicit bridge options", async () => {
		vi.useFakeTimers();
		try {
			const g = graph();
			const diagnostics = fromNestDiagnostics(g, {
				bindingId: "node.transport.bundle.diagnostics",
			});
			const seenDiagnostics: unknown[] = [];
			diagnostics.node.subscribe((msg) => {
				if (msg[0] === "DATA") seenDiagnostics.push((msg[1] as NestBoundaryEnvelope).payload);
			});

			const wsIngress = fromNestWs(g, {
				bindingId: "node.bundle.ws.in",
				payload: (host: { readonly payload: unknown }) => host.payload,
			});
			const wsReply = g.node<NestReplyEnvelope<unknown>>([], null, {
				name: "bundle.ws.reply",
			});
			class BundleGateway {
				handle() {}
			}
			GraphWs(wsIngress, {
				bindingId: "bundle.ws.in",
				requestId: (host: { readonly requestId: string }) => host.requestId,
				payload: (host: { readonly payload: unknown }) => host.payload,
			})(BundleGateway.prototype, "handle", { value: BundleGateway.prototype.handle });
			GraphWsReply(wsReply, { bindingId: "bundle.ws.reply" })(BundleGateway.prototype, "handle", {
				value: BundleGateway.prototype.handle,
			});

			const wsProviders = provideGraphWsProviders({
				bridge: {
					diagnosticBoundary: diagnostics,
					maxDiagnostics: 1,
					timeoutMs: 20,
				},
			});
			expect(wsProviders.map((provider) => provider.provide)).toEqual([GRAPHREFLY_NEST_WS_BRIDGE]);
			expect(provideGraphWsProviders({ bridge: false })).toEqual([]);
			const wsProvider = wsProviders[0];
			if (wsProvider === undefined || !("useValue" in wsProvider)) {
				throw new Error("Expected GraphWs provider bundle to return an explicit useValue provider");
			}
			const wsBridge = wsProvider.useValue as GraphWsBridge<{
				readonly requestId: string;
				readonly payload: unknown;
			}>;
			const wsPending = wsBridge.handleMessage(BundleGateway, "handle", {
				requestId: "req-bundle-ws",
				payload: { ok: true },
			});
			vi.advanceTimersByTime(20);
			await expect(wsPending).rejects.toThrow(/timed out/);
			expect(wsBridge.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual(["timeout"]);

			const messageIngress = fromNestMessage(g, {
				bindingId: "node.bundle.message.in",
				payload: (host: { readonly payload: unknown }) => host.payload,
			});
			const messageReply = g.node<NestReplyEnvelope<unknown>>([], null, {
				name: "bundle.message.reply",
			});
			class BundleMessageController {
				handle() {}
			}
			GraphMessage(messageIngress, {
				bindingId: "bundle.message.in",
				requestId: (host: { readonly requestId: string }) => host.requestId,
				payload: (host: { readonly payload: unknown }) => host.payload,
			})(BundleMessageController.prototype, "handle", {
				value: BundleMessageController.prototype.handle,
			});
			GraphMessageReply(messageReply, { bindingId: "bundle.message.reply" })(
				BundleMessageController.prototype,
				"handle",
				{ value: BundleMessageController.prototype.handle },
			);

			const messageProviders = provideGraphMessageProviders({
				bridge: {
					diagnosticBoundary: diagnostics,
					maxDiagnostics: 1,
					timeoutMs: 20,
				},
			});
			expect(messageProviders.map((provider) => provider.provide)).toEqual([
				GRAPHREFLY_NEST_MESSAGE_BRIDGE,
			]);
			expect(provideGraphMessageProviders({ bridge: false })).toEqual([]);
			const messageProvider = messageProviders[0];
			if (messageProvider === undefined || !("useValue" in messageProvider)) {
				throw new Error(
					"Expected GraphMessage provider bundle to return an explicit useValue provider",
				);
			}
			const messageBridge = messageProvider.useValue as GraphMessageBridge<{
				readonly requestId: string;
				readonly payload: unknown;
			}>;
			const messagePending = messageBridge.handleMessage(BundleMessageController, "handle", {
				requestId: "req-bundle-message",
				payload: { ok: true },
			});
			vi.advanceTimersByTime(20);
			await expect(messagePending).rejects.toThrow(/timed out/);
			expect(messageBridge.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual(["timeout"]);

			expect(seenDiagnostics).toEqual([
				expect.objectContaining({
					kind: "timeout",
					phase: "ws",
					requestId: "req-bundle-ws",
				}),
				expect.objectContaining({
					kind: "timeout",
					phase: "message",
					requestId: "req-bundle-message",
				}),
			]);
			wsBridge.dispose();
			messageBridge.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("emits graph-visible Nest diagnostics only through an explicit sanitized boundary", () => {
		const g = graph();
		const diagnostics = fromNestDiagnostics(g, {
			bindingId: "node.nest.diagnostics",
			phase: "http",
		});
		const seen: unknown[] = [];
		diagnostics.node.subscribe((msg) => {
			if (msg[0] === "DATA") seen.push((msg[1] as NestBoundaryEnvelope).payload);
		});
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null, {
			name: "nestjs/diagnostic/reply",
		});
		const hiddenHandle = { socket: { id: "raw" }, callback: () => undefined };
		const error = Object.assign(new Error("private failure"), hiddenHandle);
		const http = toNestHttp(reply, {
			bindingId: "http.diagnostics.out",
			diagnosticBoundary: diagnostics,
		});
		http.attach({
			requestId: "req-diagnostic",
			bindingId: "http.diagnostics.out",
			handle: {
				resolve: vi.fn(),
				reject: vi.fn(),
			},
		});

		reply.down([["ERROR", error]]);

		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual(["terminal-egress"]);
		expect(seen).toEqual([
			{
				kind: "terminal-egress",
				phase: "http",
				bindingId: "http.diagnostics.out",
				message: "toNestHttp(http.diagnostics.out) rejected pending requests after ERROR",
				error: { name: "Error", message: "private failure" },
			},
		]);
		expect(JSON.stringify(seen)).not.toContain("socket");
		expect(JSON.stringify(seen)).not.toContain("callback");
	});

	it("keeps host cleanup alive when explicit diagnostic ingress rejects DATA", () => {
		const g = graph();
		const diagnostics = fromNestDiagnostics(g, {
			bindingId: "node.nest.tight-diagnostics",
			maxPayloadBytes: 1,
		});
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null);
		const reject = vi.fn();
		const http = toNestHttp(reply, {
			bindingId: "http.tight-diagnostics.out",
			diagnosticBoundary: diagnostics,
		});
		http.attach({
			requestId: "req-tight",
			bindingId: "http.tight-diagnostics.out",
			handle: {
				resolve: vi.fn(),
				reject,
			},
		});

		expect(() =>
			reply.down([["ERROR", new Error("too large for diagnostic ingress")]]),
		).not.toThrow();
		expect(reject).toHaveBeenCalledOnce();
		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual(["terminal-egress"]);
	});

	it("passes sanitized diagnostics into structural diagnostic boundaries", () => {
		const g = graph();
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null);
		const emitted: Array<{ readonly host: unknown; readonly payload: unknown }> = [];
		const diagnosticBoundary: NestDiagnosticIngressBoundary = {
			kind: "diagnostics",
			bindingId: "custom.diagnostics",
			version: 1,
			node: fromNestDiagnostics(g).node,
			envelope(host, opts) {
				return {
					bindingId: opts?.bindingId ?? "custom.diagnostics",
					version: opts?.version ?? 1,
					payload: opts?.payload ?? host,
				};
			},
			emit(host, opts) {
				emitted.push({ host, payload: opts?.payload });
				return this.envelope(host, opts);
			},
		};
		const http = toNestHttp(reply, {
			bindingId: "http.custom-diagnostics.out",
			diagnosticBoundary,
		});

		reply.down([["ERROR", Object.assign(new Error("masked"), { socket: { id: "raw" } })]]);

		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual(["terminal-egress"]);
		expect(emitted).toEqual([
			{
				host: {
					kind: "terminal-egress",
					phase: "http",
					bindingId: "http.custom-diagnostics.out",
					message: "toNestHttp(http.custom-diagnostics.out) rejected pending requests after ERROR",
					error: { name: "Error", message: "masked" },
				},
				payload: {
					kind: "terminal-egress",
					phase: "http",
					bindingId: "http.custom-diagnostics.out",
					message: "toNestHttp(http.custom-diagnostics.out) rejected pending requests after ERROR",
					error: { name: "Error", message: "masked" },
				},
			},
		]);
		expect(JSON.stringify(emitted)).not.toContain("socket");
	});

	it("keeps Nest diagnostics as host snapshots by default", () => {
		const g = graph();
		const diagnostics = fromNestDiagnostics(g, { bindingId: "node.unwired.diagnostics" });
		const seen: unknown[] = [];
		diagnostics.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null);
		const http = toNestHttp(reply, { bindingId: "http.host-snapshot.out" });

		reply.down([
			[
				"DATA",
				{
					requestId: "stale",
					bindingId: "http.host-snapshot.out",
					version: 1,
					payload: { ok: true },
				},
			],
		]);

		expect(http.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual(["stale-egress"]);
		expect(seen).toEqual([]);
		expect(sanitizeNestDiagnostic({ kind: "timeout", message: "late", error: "deadline" })).toEqual(
			{
				kind: "timeout",
				phase: "adapter",
				message: "late",
				error: { message: "deadline" },
			},
		);
		expect(
			sanitizeNestDiagnostic({
				kind: "timeout",
				message: "opaque",
				error: {
					get message() {
						throw new Error("hostile getter");
					},
					toString() {
						throw new Error("hostile toString");
					},
				},
			}),
		).toEqual({
			kind: "timeout",
			phase: "adapter",
			message: "opaque",
			error: { message: "opaque diagnostic error" },
		});
		function hiddenCallback() {
			return "host-private source";
		}
		hiddenCallback.toString = () => {
			throw new Error("hostile function toString");
		};
		expect(
			sanitizeNestDiagnostic({
				kind: "timeout",
				message: "function",
				error: hiddenCallback,
			}),
		).toEqual({
			kind: "timeout",
			phase: "adapter",
			message: "function",
			error: { message: "opaque diagnostic function" },
		});
	});

	it("targeted guard-denial filter rethrows ordinary exceptions", () => {
		const filter = createGraphGuardDeniedFilter();
		const host = {
			switchToHttp: () => ({
				getResponse: () => ({
					status: vi.fn(),
					json: vi.fn(),
				}),
			}),
		} as Parameters<GraphGuardDeniedFilter["catch"]>[1];

		expect(() => filter.catch(new Error("ordinary"), host)).toThrow("ordinary");
		const denial = new GraphGuardDeniedException({ status: 403, body: { denied: true } });
		expect(isGraphGuardDeniedException(denial)).toBe(true);
	});

	it("native guard provider consumes GraphGuard and GraphGuardDecision metadata", async () => {
		const g = graph();
		const guard = fromNestGuard<
			{ readonly requestId: string; readonly allow: boolean },
			{ allow: boolean }
		>(g, { bindingId: "node.native.guard.in" });
		const decision = g.node<NestReplyEnvelope<GraphGuardDecisionPayload>>([guard.node], (ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ allow: boolean }>;
			if (envelope.requestId === undefined) return;
			ctx.down([
				[
					"DATA",
					{
						requestId: envelope.requestId,
						bindingId: "native.guard.out",
						version: 1,
						payload: envelope.payload.allow
							? { kind: "allow" }
							: {
									kind: "deny",
									status: 409,
									body: { accepted: false },
									headers: { "x-graphrefly-guard": "denied" },
								},
					},
				],
			]);
		});
		class Controller {
			guarded() {}
		}
		GraphGuard(guard, {
			bindingId: "native.guard.in",
			payload: (host) => ({ allow: host.allow }),
			requestId: (host) => host.requestId,
		})(Controller.prototype, "guarded", { value: Controller.prototype.guarded });
		GraphGuardDecision(decision, { bindingId: "native.guard.out" })(
			Controller.prototype,
			"guarded",
			{
				value: Controller.prototype.guarded,
			},
		);
		const bridge = provideGraphGuard({
			host: () => ({ requestId: "req-allow", allow: true }),
			requestId: (host) => host.requestId,
		}).useValue as { canActivate(context: unknown): Promise<boolean>; onModuleDestroy(): void };
		const context = {
			getClass: () => Controller,
			getHandler: () => Controller.prototype.guarded,
			switchToHttp: () => ({ getRequest: () => ({}) }),
		};

		await expect(bridge.canActivate(context)).resolves.toBe(true);
		const denyBridge = provideGraphGuard({
			host: () => ({ requestId: "req-deny", allow: false }),
			requestId: (host) => host.requestId,
		}).useValue as typeof bridge;
		try {
			await denyBridge.canActivate(context);
			throw new Error("expected guard denial to throw");
		} catch (error) {
			expect(isGraphGuardDeniedException(error)).toBe(true);
			expect((error as { getStatus?: () => number }).getStatus?.()).toBe(409);
			expect((error as { getResponse?: () => unknown }).getResponse?.()).toEqual({
				accepted: false,
			});
			const headers: Record<string, string> = {};
			const statuses: number[] = [];
			const bodies: unknown[] = [];
			const guardHost = {
				switchToHttp: () => ({
					getResponse: () => ({
						setHeader(name: string, value: string) {
							headers[name] = value;
						},
						status(value: number) {
							statuses.push(value);
						},
						json(value: unknown) {
							bodies.push(value);
							return value;
						},
					}),
				}),
			} as Parameters<GraphGuardDeniedFilter["catch"]>[1];
			createGraphGuardDeniedFilter().catch(error, guardHost);
			expect(headers).toEqual({ "x-graphrefly-guard": "denied" });
			expect(statuses).toEqual([409]);
			expect(bodies).toEqual([{ accepted: false }]);
		}
		bridge.onModuleDestroy();
		denyBridge.onModuleDestroy();
	});

	it("native guard provider correlates each guard binding with its own request id", async () => {
		const g = graph();
		type GuardHost = {
			readonly leftRequestId: string;
			readonly rightRequestId: string;
		};
		const leftGuard = fromNestGuard<GuardHost, { readonly side: "left" }>(g, {
			bindingId: "node.native.guard.left.in",
		});
		const rightGuard = fromNestGuard<GuardHost, { readonly side: "right" }>(g, {
			bindingId: "node.native.guard.right.in",
		});
		const decision = g.node<NestReplyEnvelope<GraphGuardDecisionPayload>>(
			[leftGuard.node, rightGuard.node],
			(ctx) => {
				const envelopes = [depLatest(ctx, 0), depLatest(ctx, 1)] as Array<
					NestBoundaryEnvelope<{ readonly side: "left" | "right" }> | undefined
				>;
				const messages = envelopes
					.filter(
						(envelope): envelope is NestBoundaryEnvelope<{ readonly side: "left" | "right" }> =>
							envelope?.requestId !== undefined,
					)
					.map(
						(envelope) =>
							[
								"DATA",
								{
									requestId: envelope.requestId,
									bindingId: "native.guard.multi.out",
									version: 1,
									payload: { kind: "allow", metadata: { side: envelope.payload.side } },
								},
							] as const,
					);
				if (messages.length > 0) ctx.down(messages);
			},
		);
		class Controller {
			guarded() {}
		}
		GraphGuard(leftGuard, {
			bindingId: "native.guard.left.in",
			payload: () => ({ side: "left" }),
			requestId: (host) => host.leftRequestId,
		})(Controller.prototype, "guarded", { value: Controller.prototype.guarded });
		GraphGuard(rightGuard, {
			bindingId: "native.guard.right.in",
			payload: () => ({ side: "right" }),
			requestId: (host) => host.rightRequestId,
		})(Controller.prototype, "guarded", { value: Controller.prototype.guarded });
		GraphGuardDecision(decision, { bindingId: "native.guard.multi.out" })(
			Controller.prototype,
			"guarded",
			{ value: Controller.prototype.guarded },
		);
		const bridge = provideGraphGuard({
			host: () => ({ leftRequestId: "req-left", rightRequestId: "req-right" }),
			requestId: () => "provider-fallback",
		}).useValue as { canActivate(context: unknown): Promise<boolean>; onModuleDestroy(): void };
		const context = {
			getClass: () => Controller,
			getHandler: () => Controller.prototype.guarded,
			switchToHttp: () => ({ getRequest: () => ({}) }),
		};

		await expect(bridge.canActivate(context)).resolves.toBe(true);
		bridge.onModuleDestroy();
	});

	it("native guard denial lowers HttpDataIssue headers through the targeted filter", async () => {
		const g = graph();
		const guard = fromNestGuard<{ readonly requestId: string }, { readonly apiKey: string }>(g, {
			bindingId: "node.native.guard.issue.in",
		});
		const issue: HttpDataIssue = {
			kind: "issue",
			code: "orders.forbidden",
			message: "Orders require a valid key.",
			status: 451,
			body: { accepted: false, code: "orders.forbidden" },
			headers: { "x-graphrefly-issue": "orders.forbidden" },
		};
		const decision = g.node<NestReplyEnvelope<GraphGuardDecisionPayload>>([guard.node], (ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly apiKey: string }>;
			if (envelope.requestId === undefined) return;
			ctx.down([
				[
					"DATA",
					{
						requestId: envelope.requestId,
						bindingId: "native.guard.issue.out",
						version: 1,
						payload: { kind: "deny", issue },
					},
				],
			]);
		});
		class Controller {
			guarded() {}
		}
		GraphGuard(guard, {
			bindingId: "native.guard.issue.in",
			payload: () => ({ apiKey: "bad" }),
			requestId: (host) => host.requestId,
		})(Controller.prototype, "guarded", { value: Controller.prototype.guarded });
		GraphGuardDecision(decision, { bindingId: "native.guard.issue.out" })(
			Controller.prototype,
			"guarded",
			{ value: Controller.prototype.guarded },
		);
		const bridge = provideGraphGuard({
			host: () => ({ requestId: "req-issue" }),
			requestId: (host) => host.requestId,
		}).useValue as { canActivate(context: unknown): Promise<boolean>; onModuleDestroy(): void };
		const context = {
			getClass: () => Controller,
			getHandler: () => Controller.prototype.guarded,
			switchToHttp: () => ({ getRequest: () => ({}) }),
		};
		const statuses: number[] = [];
		const bodies: unknown[] = [];
		const headers: Record<string, string> = {};
		const host = {
			switchToHttp: () => ({
				getResponse: () => ({
					header(name: string, value: string) {
						headers[name] = value;
					},
					status(value: number) {
						statuses.push(value);
					},
					json(value: unknown) {
						bodies.push(value);
						return value;
					},
				}),
			}),
		} as Parameters<GraphGuardDeniedFilter["catch"]>[1];

		await expect(bridge.canActivate(context)).rejects.toBeInstanceOf(GraphGuardDeniedException);
		try {
			await bridge.canActivate(context);
			throw new Error("expected guard denial to throw");
		} catch (error) {
			createGraphGuardDeniedFilter().catch(error, host);
		}

		expect(statuses).toEqual([451]);
		expect(headers).toEqual({ "x-graphrefly-issue": "orders.forbidden" });
		expect(bodies).toEqual([{ accepted: false, code: "orders.forbidden" }]);
		bridge.onModuleDestroy();
	});

	it("native guard decision protocol ERROR uses binding-level protocol-error lowering", async () => {
		const g = graph();
		const guard = fromNestGuard<{ readonly requestId: string }, { readonly value: string }>(g, {
			bindingId: "node.native.guard.protocol.in",
		});
		const decision = g.node<NestReplyEnvelope<GraphGuardDecisionPayload>>([guard.node], (ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly value: string }>;
			if (envelope.requestId === undefined) return;
			ctx.down([["ERROR", new Error(`secret:${envelope.payload.value}`)]]);
		});
		class Controller {
			guarded() {}
		}
		GraphGuard(guard, {
			bindingId: "native.guard.protocol.in",
			payload: () => ({ value: "hidden" }),
			requestId: (host) => host.requestId,
		})(Controller.prototype, "guarded", { value: Controller.prototype.guarded });
		GraphGuardDecision(decision, {
			bindingId: "native.guard.protocol.out",
			protocolError: () => ({
				status: 599,
				body: { code: "guard.binding.protocol", message: "binding wins" },
			}),
		})(Controller.prototype, "guarded", { value: Controller.prototype.guarded });
		const bridge = provideGraphGuard({
			host: () => ({ requestId: "req-guard-protocol" }),
			protocolError: () => ({
				status: 598,
				body: { code: "guard.provider.protocol", message: "provider loses" },
			}),
			requestId: (host) => host.requestId,
		}).useValue as { canActivate(context: unknown): Promise<boolean>; onModuleDestroy(): void };
		const context = {
			getClass: () => Controller,
			getHandler: () => Controller.prototype.guarded,
			switchToHttp: () => ({ getRequest: () => ({}) }),
		};

		try {
			await bridge.canActivate(context);
			throw new Error("expected guard protocol error to throw");
		} catch (error) {
			expect(isGraphGuardDeniedException(error)).toBe(false);
			expect((error as { getStatus?: () => number }).getStatus?.()).toBe(599);
			expect((error as { getResponse?: () => unknown }).getResponse?.()).toEqual({
				code: "guard.binding.protocol",
				message: "binding wins",
			});
		}
		bridge.onModuleDestroy();
	});

	it("native exception filter handles GraphError with HTTP DATA lowering", async () => {
		const g = graph();
		const errorIn = fromNestError<
			{ readonly requestId: string; readonly exception: Error },
			{ message: string }
		>(g, { bindingId: "node.native.error.in" });
		const errorOut = g.node<NestReplyEnvelope<{ status: number; body: { message: string } }>>(
			[errorIn.node],
			(ctx) => {
				const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ message: string }>;
				if (envelope.requestId === undefined) return;
				ctx.down([
					[
						"DATA",
						{
							requestId: envelope.requestId,
							bindingId: "native.error.out",
							version: 1,
							payload: { status: 418, body: { message: envelope.payload.message } },
						},
					],
				]);
			},
		);
		class Controller {
			handled() {}
		}
		GraphError(errorIn, {
			bindingId: "native.error.in",
			payload: (host) => ({ message: host.exception.message }),
			requestId: (host) => host.requestId,
		})(Controller.prototype, "handled", { value: Controller.prototype.handled });
		GraphHttpReply(errorOut, { bindingId: "native.error.out" })(Controller.prototype, "handled", {
			value: Controller.prototype.handled,
		});
		const statuses: number[] = [];
		const bodies: unknown[] = [];
		const filter = provideGraphExceptionFilter({
			target: () => ({ target: Controller, methodKey: "handled" }),
			host: (_host, exception) => ({
				requestId: "req-error",
				exception: exception instanceof Error ? exception : new Error(String(exception)),
			}),
			requestId: (host) => host.requestId,
		}).useValue as {
			catch(exception: unknown, host: unknown): Promise<unknown>;
			onModuleDestroy(): void;
		};
		const host = {
			switchToHttp: () => ({
				getRequest: () => ({}),
				getResponse: () => ({
					status(value: number) {
						statuses.push(value);
					},
					json(value: unknown) {
						bodies.push(value);
						return value;
					},
				}),
			}),
		};

		await filter.catch(new Error("handled"), host);

		expect(statuses).toEqual([418]);
		expect(bodies).toEqual([{ message: "handled" }]);
		filter.onModuleDestroy();
	});

	it("native exception filter lowers reply protocol ERROR through the safe 500 fallback", () => {
		const g = graph();
		const errorIn = fromNestError<
			{ readonly requestId: string; readonly exception: Error },
			{ message: string }
		>(g, { bindingId: "node.native.error.protocol.in" });
		const errorOut = g.node<NestReplyEnvelope<unknown>>([errorIn.node], (ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ message: string }>;
			if (envelope.requestId === undefined) return;
			ctx.down([["ERROR", new Error(`secret:${envelope.payload.message}`)]]);
		});
		class Controller {
			handled() {}
		}
		GraphError(errorIn, {
			bindingId: "native.error.protocol.in",
			payload: (host) => ({ message: host.exception.message }),
			requestId: (host) => host.requestId,
		})(Controller.prototype, "handled", { value: Controller.prototype.handled });
		GraphHttpReply(errorOut, { bindingId: "native.error.protocol.out" })(
			Controller.prototype,
			"handled",
			{ value: Controller.prototype.handled },
		);
		const statuses: number[] = [];
		const bodies: unknown[] = [];
		const filter = createGraphExceptionFilter({
			target: () => ({ target: Controller, methodKey: "handled" }),
			host: (_host, exception) => ({
				requestId: "req-error-protocol",
				exception: exception instanceof Error ? exception : new Error(String(exception)),
			}),
			requestId: (host) => host.requestId,
		}) as { catch(exception: unknown, host: unknown): unknown; onModuleDestroy(): void };
		const host = {
			switchToHttp: () => ({
				getRequest: () => ({}),
				getResponse: () => ({
					status(value: number) {
						statuses.push(value);
					},
					json(value: unknown) {
						bodies.push(value);
						return value;
					},
				}),
			}),
		};

		filter.catch(new Error("handled"), host);

		expect(statuses).toEqual([500]);
		expect(bodies).toEqual([
			{ code: "graphrefly.protocol_error", message: "GraphReFly reply pipeline failed" },
		]);
		filter.onModuleDestroy();
	});

	it("native exception filter lowers directly when no handling filter has a request id", () => {
		const g = graph();
		const errorIn = fromNestError<{ readonly exception: Error }, { message: string }>(g, {
			bindingId: "node.native.error.no-request.in",
		});
		class Controller {
			handled() {}
		}
		GraphError(errorIn, {
			bindingId: "native.error.no-request.in",
			payload: (host) => ({ message: host.exception.message }),
		})(Controller.prototype, "handled", { value: Controller.prototype.handled });
		const statuses: number[] = [];
		const bodies: unknown[] = [];
		const filter = createGraphExceptionFilter({
			target: () => ({ target: Controller, methodKey: "handled" }),
			host: (_host, exception) => ({
				exception: exception instanceof Error ? exception : new Error(String(exception)),
			}),
		}) as { catch(exception: unknown, host: unknown): unknown; onModuleDestroy(): void };
		const host = {
			switchToHttp: () => ({
				getRequest: () => ({}),
				getResponse: () => ({
					status(value: number) {
						statuses.push(value);
					},
					json(value: unknown) {
						bodies.push(value);
						return value;
					},
				}),
			}),
		};

		filter.catch(new Error("handled"), host);

		expect(statuses).toEqual([500]);
		expect(bodies).toEqual([
			{ code: "graphrefly.protocol_error", message: "GraphReFly reply pipeline failed" },
		]);
		filter.onModuleDestroy();
	});

	it("native exception filter emits request-correlated observe filters before direct lowering", () => {
		const g = graph();
		const errorIn = fromNestError<
			{ readonly requestId: string; readonly exception: Error },
			{ readonly message: string }
		>(g, {
			bindingId: "node.native.error.observe.in",
		});
		const seen: string[] = [];
		errorIn.node.subscribe((msg) => {
			if (msg[0] === "DATA") seen.push(msg[1].bindingId);
		});
		class Controller {
			handled() {}
		}
		GraphFilter(errorIn, {
			bindingId: "native.error.observe.in",
			mode: "observe",
			payload: (host) => ({ message: host.exception.message }),
			requestId: (host) => host.requestId,
			order: 1,
		})(Controller.prototype, "handled", { value: Controller.prototype.handled });
		GraphError(errorIn, {
			bindingId: "native.error.handle.in",
			payload: (host) => ({ message: host.exception.message }),
			requestId: (host) => host.requestId,
			order: 2,
		})(Controller.prototype, "handled", { value: Controller.prototype.handled });
		const statuses: number[] = [];
		const filter = createGraphExceptionFilter({
			target: () => ({ target: Controller, methodKey: "handled" }),
			host: (_host, exception) => ({
				requestId: "err-observe",
				exception: exception instanceof Error ? exception : new Error(String(exception)),
			}),
		}) as { catch(exception: unknown, host: unknown): unknown; onModuleDestroy(): void };
		const host = {
			switchToHttp: () => ({
				getRequest: () => ({}),
				getResponse: () => ({
					status(value: number) {
						statuses.push(value);
					},
					json(value: unknown) {
						return value;
					},
				}),
			}),
		};

		filter.catch(new Error("handled"), host);

		expect(seen).toEqual(["native.error.observe.in", "native.error.handle.in"]);
		expect(statuses).toEqual([500]);
		filter.onModuleDestroy();
	});

	it("native websocket bridge correlates ack/reply by requestId and bindingId without handle DATA", async () => {
		const g = graph();
		const ingress = fromNestWs<
			{
				readonly requestId: string;
				readonly body: string;
				readonly socket: unknown;
				readonly ack: unknown;
			},
			{ readonly body: string }
		>(g, { bindingId: "node.ws.orders.in" });
		const ack = g.node<NestReplyEnvelope<{ readonly accepted: true }>>([], null, {
			name: "nestjs/ws/orders.ack",
		});
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null, {
			name: "nestjs/ws/orders.reply",
		});
		const seen: NestBoundaryEnvelope[] = [];
		ingress.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		class Gateway {
			handle() {}
		}
		GraphWs(ingress, {
			bindingId: "ws.orders.in",
			requestId: (host) => host.requestId,
			payload: (host) => ({ body: host.body }),
		})(Gateway.prototype, "handle", { value: Gateway.prototype.handle });
		GraphWsAck(ack, { bindingId: "ws.orders.ack" })(Gateway.prototype, "handle", {
			value: Gateway.prototype.handle,
		});
		GraphWsReply(reply, { bindingId: "ws.orders.reply" })(Gateway.prototype, "handle", {
			value: Gateway.prototype.handle,
		});
		const ackFn = vi.fn();
		const bridge = createGraphWsBridge({
			ack: (host) => host.ack as (payload: unknown) => void,
		});

		const result = bridge.handleMessage(Gateway, "handle", {
			requestId: "req-ws-1",
			body: "create",
			socket: { send: vi.fn() },
			ack: ackFn,
		});

		expect(seen).toEqual([
			{
				bindingId: "ws.orders.in",
				version: 1,
				requestId: "req-ws-1",
				payload: { body: "create" },
			},
		]);
		expect(JSON.stringify(seen[0])).not.toContain("socket");
		expect(JSON.stringify(seen[0])).not.toContain("ack");

		ack.down([
			[
				"DATA",
				{
					bindingId: "ws.orders.ack",
					version: 1,
					requestId: "req-ws-1",
					payload: { accepted: true },
				},
			],
		]);
		expect(ackFn).toHaveBeenCalledWith({ accepted: true }, expect.any(Object));
		reply.down([
			[
				"DATA",
				{
					bindingId: "ws.orders.reply",
					version: 1,
					requestId: "req-ws-1",
					payload: { ok: true },
				},
			],
		]);

		await expect(result).resolves.toEqual({ ok: true });
		expect(bridge.diagnostics()).toEqual([]);
		bridge.dispose();
	});

	it("native websocket bridge diagnoses wrong/stale/malformed/terminal egress and timeout cleanup", async () => {
		vi.useFakeTimers();
		try {
			const g = graph();
			const ingress = fromNestWs(g, {
				bindingId: "node.ws.strict.in",
				payload: (host: { readonly payload: unknown }) => host.payload,
			});
			const reply = g.node<NestReplyEnvelope<unknown>>([], null, {
				name: "nestjs/ws/strict.reply",
			});
			class Gateway {
				handle() {}
			}
			GraphWs(ingress, {
				bindingId: "ws.strict.in",
				requestId: (host: { readonly requestId: string }) => host.requestId,
				payload: (host: { readonly payload: unknown }) => host.payload,
			})(Gateway.prototype, "handle", { value: Gateway.prototype.handle });
			GraphWsReply(reply, { bindingId: "ws.strict.reply" })(Gateway.prototype, "handle", {
				value: Gateway.prototype.handle,
			});
			const bridge = createGraphWsBridge({ timeoutMs: 20 });
			const terminal = bridge.handleMessage(Gateway, "handle", {
				requestId: "req-ws-terminal",
				payload: { ok: true },
			});
			reply.down([
				[
					"DATA",
					{
						bindingId: "ws.other.reply",
						version: 1,
						requestId: "req-ws-terminal",
						payload: { wrong: true },
					},
				],
				[
					"DATA",
					{
						bindingId: "ws.strict.reply",
						version: 1,
						requestId: "req-stale",
						payload: { stale: true },
					},
				],
				[
					"DATA",
					{
						bindingId: "ws.strict.reply",
						version: 1,
						requestId: "req-ws-terminal",
						payload: { socket: () => undefined },
					},
				],
				["COMPLETE"],
			]);
			await expect(terminal).rejects.toThrow(/data-only/);
			expect(bridge.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual([
				"binding-mismatch",
				"stale-egress",
				"malformed-egress",
				"terminal-egress",
			]);
			bridge.dispose();

			const timeoutReply = g.node<NestReplyEnvelope<unknown>>([], null, {
				name: "nestjs/ws/timeout.reply",
			});
			class TimeoutGateway {
				handle() {}
			}
			GraphWs(ingress, {
				bindingId: "ws.strict.in",
				requestId: (host: { readonly requestId: string }) => host.requestId,
				payload: (host: { readonly payload: unknown }) => host.payload,
			})(TimeoutGateway.prototype, "handle", { value: TimeoutGateway.prototype.handle });
			GraphWsReply(timeoutReply, { bindingId: "ws.timeout.reply" })(
				TimeoutGateway.prototype,
				"handle",
				{ value: TimeoutGateway.prototype.handle },
			);
			const timeoutBridge = createGraphWsBridge({ timeoutMs: 20 });
			const timeout = timeoutBridge.handleMessage(TimeoutGateway, "handle", {
				requestId: "req-ws-timeout",
				payload: { ok: true },
			});
			vi.advanceTimersByTime(20);
			await expect(timeout).rejects.toThrow(/timed out/);
			expect(timeoutBridge.diagnostics().map((diagnostic) => diagnostic.kind)).toEqual(["timeout"]);
			timeoutBridge.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("native websocket bridge cleans earlier pending registrations when terminal setup settles", async () => {
		const g = graph();
		const ingress = fromNestWs(g, {
			bindingId: "node.ws.cleanup.in",
			payload: (host: { readonly payload: unknown }) => host.payload,
		});
		const ack = g.node<NestReplyEnvelope<unknown>>([], null, {
			name: "nestjs/ws/cleanup.ack",
		});
		const terminalReply = g.node<NestReplyEnvelope<unknown>>([], null, {
			name: "nestjs/ws/cleanup.terminal",
		});
		const seen: NestBoundaryEnvelope[] = [];
		ingress.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		class Gateway {
			handle() {}
		}
		GraphWs(ingress, {
			bindingId: "ws.cleanup.in",
			requestId: (host: { readonly requestId: string }) => host.requestId,
			payload: (host: { readonly payload: unknown }) => host.payload,
		})(Gateway.prototype, "handle", { value: Gateway.prototype.handle });
		GraphWsAck(ack, { bindingId: "ws.cleanup.ack" })(Gateway.prototype, "handle", {
			value: Gateway.prototype.handle,
		});
		GraphWsReply(terminalReply, { bindingId: "ws.cleanup.terminal" })(Gateway.prototype, "handle", {
			value: Gateway.prototype.handle,
		});
		const ackFn = vi.fn();
		const bridge = createGraphWsBridge({
			ack: (host: { readonly ack: (payload: unknown) => void }) => host.ack,
		});
		terminalReply.down([["COMPLETE"]]);

		await expect(
			bridge.handleMessage(Gateway, "handle", {
				requestId: "req-ws-cleanup",
				payload: { ok: true },
				ack: ackFn,
				socket: {},
			}),
		).rejects.toThrow();
		expect(seen.filter((entry) => entry.requestId === "req-ws-cleanup")).toEqual([]);

		ack.down([
			[
				"DATA",
				{
					bindingId: "ws.cleanup.ack",
					version: 1,
					requestId: "req-ws-cleanup",
					payload: { accepted: true },
				},
			],
		]);
		expect(ackFn).not.toHaveBeenCalled();
		expect(bridge.diagnostics().map((diagnostic) => diagnostic.kind)).toContain("stale-egress");
		bridge.dispose();
	});

	it("native websocket bridge rejects unsafe defaults and cleans up on disconnect/dispose", async () => {
		const g = graph();
		const rawIngress = fromNestWs(g, { bindingId: "node.ws.raw.in" });
		const safeIngress = fromNestWs(g, {
			bindingId: "node.ws.safe.in",
			payload: (host: { readonly payload: unknown }) => host.payload,
		});
		const reply = g.node<NestReplyEnvelope<{ readonly ok: true }>>([], null, {
			name: "nestjs/ws/lifecycle.reply",
		});
		const seen: NestBoundaryEnvelope[] = [];
		rawIngress.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		safeIngress.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		class RawGateway {
			handle() {}
		}
		class SafeGateway {
			handle() {}
		}
		GraphWs(rawIngress, {
			bindingId: "ws.raw.in",
			requestId: (host: { readonly requestId: string }) => host.requestId,
		})(RawGateway.prototype, "handle", { value: RawGateway.prototype.handle });
		GraphWs(safeIngress, {
			bindingId: "ws.safe.in",
			requestId: (host: { readonly requestId: string }) => host.requestId,
			payload: (host: { readonly payload: unknown }) => host.payload,
		})(SafeGateway.prototype, "handle", { value: SafeGateway.prototype.handle });
		GraphWsReply(reply, { bindingId: "ws.lifecycle.reply" })(SafeGateway.prototype, "handle", {
			value: SafeGateway.prototype.handle,
		});
		const bridge = createGraphWsBridge();
		expect(() =>
			bridge.handleMessage(RawGateway, "handle", {
				requestId: "req-ws-raw",
				socket: { id: "socket-1" },
			}),
		).toThrow(/payload selector/);
		expect(seen).toEqual([]);

		const socket = { id: "socket-2" };
		const pending = bridge.handleMessage(SafeGateway, "handle", {
			requestId: "req-ws-disconnect",
			payload: { ok: true },
			socket,
		});
		bridge.handleDisconnect(socket);
		await expect(pending).rejects.toThrow(/disconnected/);
		expect(bridge.diagnostics().map((diagnostic) => diagnostic.kind)).toContain("dispose-pending");

		bridge.dispose();
		expect(() =>
			bridge.handleMessage(SafeGateway, "handle", {
				requestId: "req-ws-after-dispose",
				payload: { ok: true },
				socket: {},
			}),
		).toThrow(/disposed/);
		expect(seen.filter((entry) => entry.requestId === "req-ws-after-dispose")).toEqual([]);
	});

	it("native message bridge correlates replies and dispose cleanup without message-context DATA", async () => {
		const g = graph();
		const ingress = fromNestMessage<
			{ readonly requestId: string; readonly message: string; readonly context: unknown },
			{ readonly message: string }
		>(g, { bindingId: "node.message.orders.in" });
		const reply = g.node<NestReplyEnvelope<{ readonly result: string }>>([], null, {
			name: "nestjs/message/orders.reply",
		});
		const seen: NestBoundaryEnvelope[] = [];
		ingress.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		class Controller {
			handle() {}
		}
		GraphMessage(ingress, {
			bindingId: "message.orders.in",
			requestId: (host) => host.requestId,
			payload: (host) => ({ message: host.message }),
		})(Controller.prototype, "handle", { value: Controller.prototype.handle });
		GraphMessageReply(reply, { bindingId: "message.orders.reply" })(
			Controller.prototype,
			"handle",
			{ value: Controller.prototype.handle },
		);
		const bridge = createGraphMessageBridge();
		const result = bridge.handleMessage(Controller, "handle", {
			requestId: "req-message-1",
			message: "reserve",
			context: { ack: vi.fn() },
		});

		expect(seen).toEqual([
			{
				bindingId: "message.orders.in",
				version: 1,
				requestId: "req-message-1",
				payload: { message: "reserve" },
			},
		]);
		expect(JSON.stringify(seen[0])).not.toContain("context");
		reply.down([
			[
				"DATA",
				{
					bindingId: "message.orders.reply",
					version: 1,
					requestId: "req-message-1",
					payload: { result: "ok" },
				},
			],
		]);
		await expect(result).resolves.toEqual({ result: "ok" });

		const pending = bridge.handleMessage(Controller, "handle", {
			requestId: "req-message-dispose",
			message: "reserve",
			context: {},
		});
		bridge.dispose();
		await expect(pending).rejects.toThrow(/disposed/);
		expect(bridge.diagnostics().map((diagnostic) => diagnostic.kind)).toContain("dispose-pending");
	});

	it("native message bridge rejects unsafe defaults and suppresses ingress after terminal reply setup", async () => {
		const g = graph();
		const rawIngress = fromNestMessage(g, { bindingId: "node.message.raw.in" });
		const safeIngress = fromNestMessage(g, {
			bindingId: "node.message.safe.in",
			payload: (host: { readonly payload: unknown }) => host.payload,
		});
		const terminalReply = g.node<NestReplyEnvelope<unknown>>([], null, {
			name: "nestjs/message/terminal.reply",
		});
		const seen: NestBoundaryEnvelope[] = [];
		rawIngress.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		safeIngress.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		class RawController {
			handle() {}
		}
		class SafeController {
			handle() {}
		}
		GraphMessage(rawIngress, {
			bindingId: "message.raw.in",
			requestId: (host: { readonly requestId: string }) => host.requestId,
		})(RawController.prototype, "handle", { value: RawController.prototype.handle });
		GraphMessage(safeIngress, {
			bindingId: "message.safe.in",
			requestId: (host: { readonly requestId: string }) => host.requestId,
			payload: (host: { readonly payload: unknown }) => host.payload,
		})(SafeController.prototype, "handle", { value: SafeController.prototype.handle });
		GraphMessageReply(terminalReply, { bindingId: "message.terminal.reply" })(
			SafeController.prototype,
			"handle",
			{ value: SafeController.prototype.handle },
		);
		const bridge = createGraphMessageBridge();
		expect(() =>
			bridge.handleMessage(RawController, "handle", {
				requestId: "req-message-raw",
				context: { pattern: "orders" },
			}),
		).toThrow(/payload selector/);
		expect(seen).toEqual([]);

		terminalReply.down([["COMPLETE"]]);
		await expect(
			bridge.handleMessage(SafeController, "handle", {
				requestId: "req-message-terminal",
				payload: { ok: true },
			}),
		).rejects.toThrow();
		expect(seen.filter((entry) => entry.requestId === "req-message-terminal")).toEqual([]);
		bridge.dispose();
		expect(() =>
			bridge.handleMessage(SafeController, "handle", {
				requestId: "req-message-after-dispose",
				payload: { ok: true },
			}),
		).toThrow(/disposed/);
	});

	it("native message bridge cleans earlier pending registrations when terminal setup settles", async () => {
		const g = graph();
		const ingress = fromNestMessage(g, {
			bindingId: "node.message.cleanup.in",
			payload: (host: { readonly payload: unknown }) => host.payload,
		});
		const firstReply = g.node<NestReplyEnvelope<unknown>>([], null, {
			name: "nestjs/message/cleanup.first",
		});
		const terminalReply = g.node<NestReplyEnvelope<unknown>>([], null, {
			name: "nestjs/message/cleanup.terminal",
		});
		const seen: NestBoundaryEnvelope[] = [];
		ingress.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		class Controller {
			handle() {}
		}
		GraphMessage(ingress, {
			bindingId: "message.cleanup.in",
			requestId: (host: { readonly requestId: string }) => host.requestId,
			payload: (host: { readonly payload: unknown }) => host.payload,
		})(Controller.prototype, "handle", { value: Controller.prototype.handle });
		GraphMessageReply(firstReply, { bindingId: "message.cleanup.first" })(
			Controller.prototype,
			"handle",
			{ value: Controller.prototype.handle },
		);
		GraphMessageReply(terminalReply, { bindingId: "message.cleanup.terminal" })(
			Controller.prototype,
			"handle",
			{ value: Controller.prototype.handle },
		);
		const bridge = createGraphMessageBridge();
		terminalReply.down([["COMPLETE"]]);

		await expect(
			bridge.handleMessage(Controller, "handle", {
				requestId: "req-message-cleanup",
				payload: { ok: true },
			}),
		).rejects.toThrow();
		expect(seen.filter((entry) => entry.requestId === "req-message-cleanup")).toEqual([]);

		firstReply.down([
			[
				"DATA",
				{
					bindingId: "message.cleanup.first",
					version: 1,
					requestId: "req-message-cleanup",
					payload: { ok: true },
				},
			],
		]);
		expect(bridge.diagnostics().map((diagnostic) => diagnostic.kind)).toContain("stale-egress");
		bridge.dispose();
	});

	it("native cron provider starts and stops timers while emitting GraphCron ingress", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-05T08:30:00.000Z"));
		const g = graph();
		const cron = fromNestCron<{ readonly timestamp_ns: string }, { tick: string }>(g, {
			bindingId: "node.native.cron.in",
		});
		const seen: unknown[] = [];
		cron.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		class Controller {
			tick() {}
		}
		GraphCron(cron, {
			bindingId: "native.cron.in",
			payload: (host) => ({ tick: host.timestamp_ns }),
		})(Controller.prototype, "tick", { value: Controller.prototype.tick });
		const scheduler = provideGraphCronScheduler({
			targets: [
				{
					target: Controller,
					methodKey: "tick",
					expr: "30 8 * * 1",
					tickMs: 1000,
					timezone: "UTC",
				},
			],
		}).useValue as { onModuleInit(): void; onModuleDestroy(): void };

		scheduler.onModuleInit();

		expect(seen).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(1);
		scheduler.onModuleDestroy();
		expect(vi.getTimerCount()).toBe(0);
		vi.useRealTimers();
	});

	it("native cron provider dedupes by current wall-clock minute without blocking later days", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-01-05T08:30:00.000Z"));
			const g = graph();
			const cron = fromNestCron<{ readonly timestamp_ms: number }, { readonly tick: number }>(g, {
				bindingId: "node.native.cron.daily.in",
			});
			const seen: unknown[] = [];
			cron.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
			class Controller {
				tick() {}
			}
			GraphCron(cron, {
				bindingId: "native.cron.daily.in",
				payload: (host) => ({ tick: host.timestamp_ms }),
			})(Controller.prototype, "tick", { value: Controller.prototype.tick });
			const scheduler = provideGraphCronScheduler({
				targets: [
					{
						target: Controller,
						methodKey: "tick",
						expr: "30 8 * * *",
						tickMs: 1000,
						timezone: "UTC",
					},
				],
			}).useValue as { onModuleInit(): void; onModuleDestroy(): void };

			scheduler.onModuleInit();
			vi.advanceTimersByTime(30_000);
			vi.setSystemTime(new Date("2026-01-06T08:30:00.000Z"));
			vi.advanceTimersByTime(1_000);
			scheduler.onModuleDestroy();

			expect(seen).toHaveLength(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("manual cron controller checks current time deterministically without catch-up DATA", () => {
		const g = graph();
		const cron = fromNestCron<{ readonly timestamp_ms: number }, { readonly tick: number }>(g, {
			bindingId: "node.native.cron.manual.in",
		});
		const seen: unknown[] = [];
		cron.node.subscribe((msg) => msg[0] === "DATA" && seen.push(msg[1]));
		class Controller {
			tick() {}
		}
		GraphCron(cron, {
			bindingId: "native.cron.manual.in",
			payload: (host) => ({ tick: host.timestamp_ms }),
		})(Controller.prototype, "tick", { value: Controller.prototype.tick });
		const controller = createGraphCronController({
			targets: [
				graphCronTarget(Controller, "tick", {
					expr: "30 8 * * 1",
					timezone: "UTC",
				}),
			],
		});

		controller.check(new Date("2026-01-05T08:29:00.000Z"));
		controller.check(new Date("2026-01-05T08:30:00.000Z"));
		controller.check(new Date("2026-01-05T08:30:59.000Z"));
		controller.check(new Date("2026-01-12T08:30:00.000Z"));

		expect(seen).toEqual([
			{
				bindingId: "native.cron.manual.in",
				version: 1,
				payload: { tick: Date.parse("2026-01-05T08:30:00.000Z") },
			},
			{
				bindingId: "native.cron.manual.in",
				version: 1,
				payload: { tick: Date.parse("2026-01-12T08:30:00.000Z") },
			},
		]);
		expect(() =>
			createGraphCronController({
				targets: [graphCronTarget(Controller, "tick", { expr: "0 30 8 * * 1" })],
			}),
		).toThrow(/expected 5 fields/);
	});

	it("native cron provider rolls back timers when module init fails partway", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-01-05T08:30:00.000Z"));
			class Controller {
				tick() {}
				bad() {}
			}
			const scheduler = provideGraphCronScheduler({
				targets: [
					{ target: Controller, methodKey: "tick", expr: "* * * * *", tickMs: 1000 },
					{ target: Controller, methodKey: "bad", expr: "* * * * *", tickMs: 0 },
				],
			}).useValue as { onModuleInit(): void; onModuleDestroy(): void };

			expect(() => scheduler.onModuleInit()).toThrow(/tickMs/);
			expect(vi.getTimerCount()).toBe(0);
			scheduler.onModuleDestroy();
		} finally {
			vi.useRealTimers();
		}
	});
});
