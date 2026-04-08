import "reflect-metadata";
import { Injectable } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { firstValueFrom as rxFirstValueFrom, take, toArray } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ACTOR_KEY,
	COMMAND_HANDLERS,
	CommandHandler,
	CQRS_EVENT_HANDLERS,
	CRON_HANDLERS,
	EVENT_HANDLERS,
	EventHandler,
	fromHeader,
	fromJwtPayload,
	GRAPHREFLY_ROOT_GRAPH,
	GraphCron,
	GraphInterval,
	GraphReflyGuard,
	GraphReflyGuardImpl,
	GraphReflyModule,
	getActor,
	getGraphToken,
	getNodeToken,
	INTERVAL_HANDLERS,
	ObserveGateway,
	type ObserveWsMessage,
	OnGraphEvent,
	observeSSE,
	observeSubscription,
	QUERY_HANDLERS,
	QueryHandler,
	SAGA_HANDLERS,
	SagaHandler,
} from "../../compat/nestjs/index.js";
import { DEFAULT_ACTOR } from "../../core/actor.js";
import { GuardDenied, policy } from "../../core/guard.js";
import { COMPLETE, DATA, DIRTY, ERROR, type Messages, TEARDOWN } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { toObservable } from "../../extra/observable.js";
import { Graph } from "../../graph/graph.js";
import type { CommandActions, CqrsEvent, CqrsGraph } from "../../patterns/cqrs.js";

// ---------------------------------------------------------------------------
// RxJS bridge
// ---------------------------------------------------------------------------

describe("nestjs compat — RxJS bridge", () => {
	it("toObservable: emits DATA values", async () => {
		const s = state<number>(0);
		const values$ = toObservable(s).pipe(take(2), toArray());
		const p = rxFirstValueFrom(values$);

		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);

		const result = await p;
		expect(result).toEqual([1, 2]);
	});

	it("toObservable: errors on ERROR", async () => {
		const s = state<number>(0);

		const errorP = new Promise<unknown>((_, reject) => {
			toObservable(s).subscribe({ next: () => {}, error: reject });
		});

		s.down([[ERROR, new Error("boom")]]);

		await expect(errorP).rejects.toThrow("boom");
	});

	it("toObservable: completes on COMPLETE", async () => {
		const s = state<number>(0);
		const all = toObservable(s).pipe(toArray());
		const p = rxFirstValueFrom(all);

		// Emit a value then complete
		s.down([[DATA, 42]]);
		s.down([[COMPLETE]]);

		const result = await p;
		expect(result).toEqual([42]);
	});

	it("toObservable: skips protocol-internal signals (DIRTY, RESOLVED)", async () => {
		const { RESOLVED } = await import("../../core/messages.js");
		const s = state<number>(0);
		const values: number[] = [];
		const sub = toObservable(s).subscribe((v) => values.push(v));

		// DIRTY + RESOLVED should not produce a value emission
		s.down([[DIRTY], [RESOLVED]]);
		// Only DATA produces a value
		s.down([[DIRTY], [DATA, 5]]);

		expect(values).toEqual([5]);
		sub.unsubscribe();
	});

	it("toObservable({ raw: true }): emits raw message batches", async () => {
		const s = state<number>(0);
		// Batch splits DIRTY (immediate, tier 0) from DATA (deferred, tier 2).
		// So s.down([[DIRTY], [DATA, 1]]) produces two emissions: [[DIRTY]] then [[DATA, 1]].
		const msgs$ = toObservable(s, { raw: true }).pipe(take(2), toArray());
		const p = rxFirstValueFrom(msgs$);

		s.down([[DIRTY], [DATA, 1]]);

		const result = await p;
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual([[DIRTY]]);
		expect(result[1]).toEqual([[DATA, 1]]);
	});

	it("toObservable({ raw: true }): terminal batch emitted before Observable error", async () => {
		const s = state<number>(0);
		const batches: Messages[] = [];
		let caughtError: unknown;

		await new Promise<void>((resolve) => {
			toObservable(s, { raw: true }).subscribe({
				next: (msgs) => batches.push(msgs),
				error: (err) => {
					caughtError = err;
					resolve();
				},
			});
			s.down([[ERROR, new Error("fail")]]);
		});

		expect(batches.some((b) => b.some((m) => m[0] === ERROR))).toBe(true);
		expect(caughtError).toBeInstanceOf(Error);
	});

	it("toObservable: graph node values via graph.resolve", async () => {
		const g = new Graph("test");
		const s = state<number>(10);
		g.add("counter", s);

		const values$ = toObservable<number>(g.resolve("counter")).pipe(take(2), toArray());
		const p = rxFirstValueFrom(values$);

		s.down([[DATA, 20]]);
		s.down([[DATA, 30]]);

		const result = await p;
		expect(result).toEqual([20, 30]);
	});

	it("toObservable: unsubscribing the Observable unsubscribes the node", () => {
		const s = state<number>(0);
		const values: number[] = [];
		const sub = toObservable(s).subscribe((v) => values.push(v));

		s.down([[DATA, 1]]);
		sub.unsubscribe();
		s.down([[DATA, 2]]); // should not be received

		expect(values).toEqual([1]);
	});

	it("toObservable: works with derived nodes (reactive chain)", () => {
		const count = state(0);
		const doubled = derived([count], (c: number) => c * 2);

		const values: number[] = [];
		const sub = toObservable(doubled).subscribe((v) => values.push(v));

		count.down([[DATA, 3]]);
		count.down([[DATA, 5]]);

		expect(values).toEqual([0, 6, 10]);
		sub.unsubscribe();
	});
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

describe("nestjs compat — tokens", () => {
	it("getGraphToken returns stable symbols for same name", () => {
		expect(getGraphToken("foo")).toBe(getGraphToken("foo"));
		expect(getNodeToken("bar")).toBe(getNodeToken("bar"));
		expect(getGraphToken("foo")).not.toBe(getNodeToken("foo"));
	});
});

// ---------------------------------------------------------------------------
// Module — forRoot
// ---------------------------------------------------------------------------

describe("nestjs compat — GraphReflyModule.forRoot", () => {
	it("provides root graph singleton", async () => {
		const module: TestingModule = await Test.createTestingModule({
			imports: [GraphReflyModule.forRoot()],
		}).compile();

		const graph = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		expect(graph).toBeInstanceOf(Graph);
		expect(graph.name).toBe("root");

		await module.close();
	});

	it("accepts custom graph name", async () => {
		const module = await Test.createTestingModule({
			imports: [GraphReflyModule.forRoot({ name: "myapp" })],
		}).compile();

		const graph = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		expect(graph.name).toBe("myapp");

		await module.close();
	});

	it("runs build callback", async () => {
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot({
					build: (g) => {
						g.add("counter", state(42));
					},
				}),
			],
		}).compile();

		const graph = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		expect(graph.get("counter")).toBe(42);

		await module.close();
	});

	it("restores from snapshot after build", async () => {
		const seed = new Graph("root");
		seed.add("counter", state(0));
		const snapshot = seed.snapshot();
		snapshot.nodes.counter.value = 99;

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot({
					build: (g) => g.add("counter", state(0)),
					snapshot,
				}),
			],
		}).compile();

		const graph = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		expect(graph.get("counter")).toBe(99);

		await module.close();
	});

	it("exposes declared nodes as injectable providers", async () => {
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot({
					build: (g) => g.add("count", state(7)),
					nodes: ["count"],
				}),
			],
		}).compile();

		const countNode = module.get<Node<number>>(getNodeToken("count"));
		expect(countNode.get()).toBe(7);

		await module.close();
	});

	it("graph.destroy() called on module close (TEARDOWN propagation)", async () => {
		const teardownSpy = vi.fn();

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot({
					build: (g) => {
						const s = state(1);
						s.subscribe((msgs) => {
							for (const m of msgs) {
								if (m[0] === TEARDOWN) teardownSpy();
							}
						});
						g.add("s", s);
					},
				}),
			],
		}).compile();

		await module.init();
		await module.close();

		expect(teardownSpy).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Module — forFeature
// ---------------------------------------------------------------------------

describe("nestjs compat — GraphReflyModule.forFeature", () => {
	it("mounts feature subgraph into root", async () => {
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forFeature({
					name: "payments",
					build: (g) => g.add("amount", state(100)),
				}),
			],
		}).compile();

		const root = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		expect(root.get("payments::amount")).toBe(100);

		const feature = module.get<Graph>(getGraphToken("payments"));
		expect(feature).toBeInstanceOf(Graph);
		expect(feature.name).toBe("payments");

		await module.close();
	});

	it("feature teardown cascades from root on module close", async () => {
		const teardownSpy = vi.fn();

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forFeature({
					name: "temp",
					build: (g) => {
						const s = state(1);
						s.subscribe((msgs) => {
							for (const m of msgs) {
								if (m[0] === TEARDOWN) teardownSpy();
							}
						});
						g.add("x", s);
					},
				}),
			],
		}).compile();

		const root = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		await module.init();
		expect(root.get("temp::x")).toBe(1);

		await module.close();
		expect(teardownSpy).toHaveBeenCalled();
	});

	it("exposes feature-scoped nodes as injectable", async () => {
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forFeature({
					name: "orders",
					build: (g) => g.add("total", state(250)),
					nodes: ["total"],
				}),
			],
		}).compile();

		const totalNode = module.get<Node<number>>(getNodeToken("orders::total"));
		expect(totalNode.get()).toBe(250);

		await module.close();
	});

	it("multiple features coexist under root", async () => {
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forFeature({
					name: "auth",
					build: (g) => g.add("user", state("alice")),
				}),
				GraphReflyModule.forFeature({
					name: "billing",
					build: (g) => g.add("plan", state("pro")),
				}),
			],
		}).compile();

		const root = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		expect(root.get("auth::user")).toBe("alice");
		expect(root.get("billing::plan")).toBe("pro");

		await module.close();
	});
});

// ---------------------------------------------------------------------------
// Decorators — unit test (verify they produce correct decorator functions)
// ---------------------------------------------------------------------------

describe("nestjs compat — decorators", () => {
	it("InjectGraph() produces a decorator function", async () => {
		const { InjectGraph } = await import("../../compat/nestjs/decorators.js");
		expect(typeof InjectGraph()).toBe("function");
	});

	it("InjectGraph(name) produces a decorator function", async () => {
		const { InjectGraph } = await import("../../compat/nestjs/decorators.js");
		expect(typeof InjectGraph("payments")).toBe("function");
	});

	it("InjectNode(path) produces a decorator function", async () => {
		const { InjectNode } = await import("../../compat/nestjs/decorators.js");
		expect(typeof InjectNode("payment::validate")).toBe("function");
	});

	it("InjectGraph('request') produces a decorator function", async () => {
		const { InjectGraph } = await import("../../compat/nestjs/decorators.js");
		expect(typeof InjectGraph("request")).toBe("function");
	});

	it("OnGraphEvent() produces a decorator function", () => {
		expect(typeof OnGraphEvent("orders::placed")).toBe("function");
	});

	it("GraphInterval() produces a decorator function", () => {
		expect(typeof GraphInterval(1000)).toBe("function");
	});

	it("GraphCron() produces a decorator function", () => {
		expect(typeof GraphCron("0 9 * * 1")).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// EventEmitter replacement — @OnGraphEvent
// ---------------------------------------------------------------------------

describe("nestjs compat — @OnGraphEvent", () => {
	beforeEach(() => {
		EVENT_HANDLERS.clear();
		INTERVAL_HANDLERS.clear();
		CRON_HANDLERS.clear();
	});

	it("method called on DATA emission from named node", async () => {
		const received: number[] = [];

		@Injectable()
		class OrderHandler {
			@OnGraphEvent("counter")
			onData(value: number) {
				received.push(value);
			}
		}

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot({
					build: (g) => g.add("counter", state(0)),
				}),
			],
			providers: [OrderHandler],
		}).compile();

		await module.init();

		const graph = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		graph.set("counter", 42);
		graph.set("counter", 99);

		expect(received).toEqual([42, 99]);

		await module.close();
	});

	it("method not called for DIRTY-only messages (DATA-only filtering)", async () => {
		const received: unknown[] = [];

		@Injectable()
		class Listener {
			@OnGraphEvent("s")
			onData(value: unknown) {
				received.push(value);
			}
		}

		const s = state<number>(0);
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot({
					build: (g) => g.add("s", s),
				}),
			],
			providers: [Listener],
		}).compile();

		await module.init();

		// Send DIRTY without DATA — should not trigger the handler
		s.down([[DIRTY]]);
		expect(received).toEqual([]);

		// DATA should trigger
		s.down([[DATA, 10]]);
		expect(received).toEqual([10]);

		await module.close();
	});

	it("subscription disposed on module destroy", async () => {
		const received: number[] = [];

		@Injectable()
		class Listener {
			@OnGraphEvent("s")
			onData(value: number) {
				received.push(value);
			}
		}

		const s = state<number>(0);
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot({
					build: (g) => g.add("s", s),
				}),
			],
			providers: [Listener],
		}).compile();

		await module.init();
		s.down([[DATA, 1]]);
		expect(received).toEqual([1]);

		await module.close();

		// After destroy, handler should not be called
		s.down([[DATA, 2]]);
		expect(received).toEqual([1]);
	});

	it("works with feature-scoped nodes via qualified path", async () => {
		const received: string[] = [];

		@Injectable()
		class PaymentHandler {
			@OnGraphEvent("payments::status")
			onStatus(value: string) {
				received.push(value);
			}
		}

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forFeature({
					name: "payments",
					build: (g) => g.add("status", state("pending")),
				}),
			],
			providers: [PaymentHandler],
		}).compile();

		await module.init();

		const root = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		root.set("payments::status", "completed");

		expect(received).toEqual(["completed"]);

		await module.close();
	});

	it("multiple @OnGraphEvent decorators on same class", async () => {
		const aValues: number[] = [];
		const bValues: number[] = [];

		@Injectable()
		class MultiHandler {
			@OnGraphEvent("a")
			onA(v: number) {
				aValues.push(v);
			}

			@OnGraphEvent("b")
			onB(v: number) {
				bValues.push(v);
			}
		}

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot({
					build: (g) => {
						g.add("a", state(0));
						g.add("b", state(0));
					},
				}),
			],
			providers: [MultiHandler],
		}).compile();

		await module.init();

		const graph = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		graph.set("a", 1);
		graph.set("b", 2);

		expect(aValues).toEqual([1]);
		expect(bValues).toEqual([2]);

		await module.close();
	});
});

// ---------------------------------------------------------------------------
// Schedule replacement — @GraphInterval
// ---------------------------------------------------------------------------

describe("nestjs compat — @GraphInterval", () => {
	beforeEach(() => {
		EVENT_HANDLERS.clear();
		INTERVAL_HANDLERS.clear();
		CRON_HANDLERS.clear();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates timer node in graph, calls method on tick", async () => {
		vi.useFakeTimers();
		const calls: number[] = [];

		@Injectable()
		class TickService {
			@GraphInterval(100)
			onTick(count: number) {
				calls.push(count);
			}
		}

		const module = await Test.createTestingModule({
			imports: [GraphReflyModule.forRoot()],
			providers: [TickService],
		}).compile();

		await module.init();

		// Timer node should be visible in the graph
		const graph = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		const desc = graph.describe();
		const scheduleKeys = Object.keys(desc.nodes).filter((k) => k.startsWith("__schedule__."));
		expect(scheduleKeys.length).toBeGreaterThanOrEqual(1);
		expect(scheduleKeys[0]).toMatch(/TickService\.onTick\.\d+/);

		// Advance time to trigger ticks
		vi.advanceTimersByTime(100);
		expect(calls.length).toBeGreaterThanOrEqual(1);

		vi.advanceTimersByTime(100);
		expect(calls.length).toBeGreaterThanOrEqual(2);

		await module.close();
	});

	it("timer disposed on module destroy", async () => {
		vi.useFakeTimers();
		const calls: number[] = [];

		@Injectable()
		class TimerService {
			@GraphInterval(50)
			tick(count: number) {
				calls.push(count);
			}
		}

		const module = await Test.createTestingModule({
			imports: [GraphReflyModule.forRoot()],
			providers: [TimerService],
		}).compile();

		await module.init();
		vi.advanceTimersByTime(50);
		const countBefore = calls.length;
		expect(countBefore).toBeGreaterThanOrEqual(1);

		await module.close();

		// After destroy, no more ticks
		vi.advanceTimersByTime(200);
		expect(calls.length).toBe(countBefore);
	});

	it("schedule nodes removed from graph on module destroy", async () => {
		vi.useFakeTimers();

		@Injectable()
		class Svc {
			@GraphInterval(100)
			work() {}
		}

		const module = await Test.createTestingModule({
			imports: [GraphReflyModule.forRoot()],
			providers: [Svc],
		}).compile();

		await module.init();

		const graph = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		const before = Object.keys(graph.describe().nodes).filter((k) => k.startsWith("__schedule__."));
		expect(before.length).toBe(1);

		await module.close();

		const after = Object.keys(graph.describe().nodes).filter((k) => k.startsWith("__schedule__."));
		expect(after.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Schedule replacement — @GraphCron (decorator metadata only)
// ---------------------------------------------------------------------------

describe("nestjs compat — @GraphCron", () => {
	beforeEach(() => {
		EVENT_HANDLERS.clear();
		INTERVAL_HANDLERS.clear();
		CRON_HANDLERS.clear();
	});

	it("stores cron metadata in global registry after instantiation", () => {
		@Injectable()
		class CronService {
			@GraphCron("0 3 * * *")
			nightly() {}
		}

		// TC39 decorators: addInitializer runs on instance creation
		new CronService();

		const metas = CRON_HANDLERS.get(CronService);
		expect(metas).toHaveLength(1);
		expect(metas![0]).toMatchObject({
			expr: "0 3 * * *",
			methodKey: "nightly",
		});
	});

	it("cron node added to graph and visible in describe()", async () => {
		vi.useFakeTimers();

		@Injectable()
		class ReportService {
			@GraphCron("* * * * *")
			everyMinute() {}
		}

		const module = await Test.createTestingModule({
			imports: [GraphReflyModule.forRoot()],
			providers: [ReportService],
		}).compile();

		await module.init();

		const graph = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		const desc = graph.describe();
		const cronKeys = Object.keys(desc.nodes).filter((k) =>
			k.match(/ReportService\.everyMinute\.\d+/),
		);
		expect(cronKeys.length).toBe(1);

		await module.close();
		vi.useRealTimers();
	});
});

// ---------------------------------------------------------------------------
// Actor bridge (Phase 5.1)
// ---------------------------------------------------------------------------

describe("nestjs compat — actor bridge", () => {
	function fakeExecutionContext(req: Record<string, unknown>) {
		return {
			switchToHttp: () => ({
				getRequest: () => req,
				getResponse: () => ({}),
			}),
			switchToWs: () => ({ getClient: () => ({}), getData: () => ({}) }),
			switchToRpc: () => ({ getContext: () => ({}), getData: () => ({}) }),
			getClass: () => Object,
			getHandler: () => () => {},
			getArgs: () => [req],
			getArgByIndex: (i: number) => [req][i],
			getType: () => "http" as const,
		} as any;
	}

	it("fromJwtPayload: extracts actor from req.user", () => {
		const extractor = fromJwtPayload();
		const actor = extractor(fakeExecutionContext({ user: { type: "human", id: "u1" } }));
		expect(actor).toEqual({ type: "human", id: "u1" });
	});

	it("fromJwtPayload: returns undefined when no user", () => {
		const extractor = fromJwtPayload();
		expect(extractor(fakeExecutionContext({}))).toBeUndefined();
	});

	it("fromJwtPayload: custom mapping", () => {
		const extractor = fromJwtPayload((payload: any) => ({
			type: payload.role === "admin" ? "human" : "llm",
			id: payload.sub,
		}));
		const actor = extractor(fakeExecutionContext({ user: { role: "admin", sub: "u42" } }));
		expect(actor).toEqual({ type: "human", id: "u42" });
	});

	it("fromHeader: extracts actor from JSON header", () => {
		const extractor = fromHeader("x-actor");
		const actor = extractor(
			fakeExecutionContext({
				headers: { "x-actor": JSON.stringify({ type: "llm", id: "agent-1" }) },
			}),
		);
		expect(actor).toEqual({ type: "llm", id: "agent-1" });
	});

	it("fromHeader: returns undefined for missing header", () => {
		const extractor = fromHeader();
		expect(extractor(fakeExecutionContext({ headers: {} }))).toBeUndefined();
	});

	it("fromHeader: returns undefined for invalid JSON", () => {
		const extractor = fromHeader();
		const result = extractor(
			fakeExecutionContext({ headers: { "x-graphrefly-actor": "not json" } }),
		);
		expect(result).toBeUndefined();
	});

	it("GraphReflyGuard: attaches actor to request", () => {
		const guard = GraphReflyGuard(fromJwtPayload());
		const req: Record<string, unknown> = { user: { type: "human", id: "u1" } };
		const ctx = fakeExecutionContext(req);

		const result = guard.canActivate(ctx);
		expect(result).toBe(true);
		expect(req[ACTOR_KEY]).toMatchObject({ type: "human", id: "u1" });
	});

	it("GraphReflyGuard: defaults to DEFAULT_ACTOR when extractor returns undefined", () => {
		const guard = GraphReflyGuard(fromJwtPayload());
		const req: Record<string, unknown> = {};
		guard.canActivate(fakeExecutionContext(req));
		expect(req[ACTOR_KEY]).toEqual(DEFAULT_ACTOR);
	});

	it("GraphReflyGuard: default factory uses fromJwtPayload", () => {
		const guard = GraphReflyGuard();
		const req: Record<string, unknown> = { user: { type: "wallet", id: "0xabc" } };
		guard.canActivate(fakeExecutionContext(req));
		expect(req[ACTOR_KEY]).toMatchObject({ type: "wallet", id: "0xabc" });
	});

	it("getActor: reads actor from request", () => {
		const req = { [ACTOR_KEY]: { type: "human", id: "u1" } };
		const actor = getActor(req);
		expect(actor).toEqual({ type: "human", id: "u1" });
	});

	it("getActor: returns DEFAULT_ACTOR when not attached", () => {
		expect(getActor({})).toEqual(DEFAULT_ACTOR);
		expect(getActor(undefined)).toEqual(DEFAULT_ACTOR);
	});

	it("GraphReflyGuardImpl is a CanActivate", () => {
		const impl = new GraphReflyGuardImpl(() => ({ type: "system", id: "test" }));
		expect(typeof impl.canActivate).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// Gateway helpers (Phase 5.1)
// ---------------------------------------------------------------------------

describe("nestjs compat — observeSSE", () => {
	it("streams DATA values as SSE frames", async () => {
		const s = state<number>(0);
		const g = new Graph("sse-test");
		g.add("counter", s);

		const stream = observeSSE(g, "counter");
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		s.down([[DATA, 42]]);
		s.down([[DATA, 99]]);
		s.down([[COMPLETE]]);

		const chunks: string[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(decoder.decode(value));
		}

		const text = chunks.join("");
		expect(text).toContain("event: data\ndata: 42\n\n");
		expect(text).toContain("event: data\ndata: 99\n\n");
		expect(text).toContain("event: complete\n\n");
		g.destroy();
	});

	it("closes on ERROR", async () => {
		const s = state<number>(0);
		const g = new Graph("sse-err");
		g.add("n", s);

		const stream = observeSSE(g, "n");
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		s.down([[ERROR, new Error("boom")]]);

		const chunks: string[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(decoder.decode(value));
		}

		expect(chunks.join("")).toContain("event: error\ndata: boom\n\n");
		g.destroy();
	});

	it("respects actor guard on observe", () => {
		const s = state(0, {
			guard: policy((allow) => {
				allow("observe", { where: (a) => a.type === "human" });
			}),
		});
		const g = new Graph("sse-guard");
		g.add("guarded", s);

		// LLM actor should be denied
		expect(() => observeSSE(g, "guarded", { actor: { type: "llm", id: "a1" } })).toThrow(
			GuardDenied,
		);

		// Human actor should work
		const stream = observeSSE(g, "guarded", { actor: { type: "human", id: "u1" } });
		expect(stream).toBeInstanceOf(ReadableStream);
		stream.cancel();
		g.destroy();
	});

	it("supports keepAlive", async () => {
		vi.useFakeTimers();
		const s = state<number>(0);
		const g = new Graph("sse-ka");
		g.add("n", s);

		const ac = new AbortController();
		const stream = observeSSE(g, "n", { keepAliveMs: 100, signal: ac.signal });
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		vi.advanceTimersByTime(150);
		ac.abort();

		const chunks: string[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(decoder.decode(value));
		}

		expect(chunks.join("")).toContain(": keepalive");
		g.destroy();
		vi.useRealTimers();
	});
});

describe("nestjs compat — observeSubscription", () => {
	it("yields DATA values as async iterator", async () => {
		const s = state<string>("");
		const g = new Graph("sub-test");
		g.add("msg", s);

		const iter = observeSubscription<string>(g, "msg");

		s.down([[DATA, "hello"]]);
		s.down([[DATA, "world"]]);
		s.down([[COMPLETE]]);

		const results: string[] = [];
		for await (const value of iter) {
			results.push(value);
		}

		expect(results).toEqual(["hello", "world"]);
		g.destroy();
	});

	it("rejects on ERROR", async () => {
		const s = state<number>(0);
		const g = new Graph("sub-err");
		g.add("n", s);

		const iter = observeSubscription<number>(g, "n");
		s.down([[ERROR, new Error("fail")]]);

		await expect(iter.next()).rejects.toThrow("fail");
		g.destroy();
	});

	it("supports filter option", async () => {
		const s = state<number>(0);
		const g = new Graph("sub-filter");
		g.add("n", s);

		const iter = observeSubscription<number>(g, "n", {
			filter: (v) => v > 5,
		});

		s.down([[DATA, 1]]);
		s.down([[DATA, 10]]);
		s.down([[COMPLETE]]);

		const result = await iter.next();
		expect(result).toEqual({ done: false, value: 10 });

		const end = await iter.next();
		expect(end.done).toBe(true);
		g.destroy();
	});

	it("return() disposes the subscription", async () => {
		const s = state<number>(0);
		const g = new Graph("sub-return");
		g.add("n", s);

		const iter = observeSubscription<number>(g, "n");
		s.down([[DATA, 1]]);

		await iter.next();
		const ret = await iter.return!();
		expect(ret.done).toBe(true);

		// Further next() after return should be done
		const after = await iter.next();
		expect(after.done).toBe(true);
		g.destroy();
	});

	it("respects actor guard", () => {
		const s = state(0, {
			guard: policy((_allow) => {
				// no observe allowed
			}),
		});
		const g = new Graph("sub-guard");
		g.add("n", s);

		expect(() => observeSubscription(g, "n", { actor: { type: "human", id: "u1" } })).toThrow(
			GuardDenied,
		);
		g.destroy();
	});
});

describe("nestjs compat — ObserveGateway", () => {
	function makeMockClient(): { send: ReturnType<typeof vi.fn>; id: string } {
		return { send: vi.fn(), id: Math.random().toString(36) };
	}

	it("subscribe and receive DATA", () => {
		const s = state<number>(0);
		const g = new Graph("gw-test");
		g.add("counter", s);

		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		gw.handleMessage(client, { type: "subscribe", path: "counter" }, (msg) => sent.push(msg));

		expect(sent).toContainEqual({ type: "subscribed", path: "counter" });
		expect(gw.subscriptionCount(client)).toBe(1);

		s.down([[DATA, 42]]);

		gw.handleMessage(client, { type: "subscribe", path: "counter" }, (msg) => sent.push(msg));
		// Already subscribed — no duplicate

		gw.handleDisconnect(client);
		expect(gw.subscriptionCount(client)).toBe(0);
		g.destroy();
	});

	it("unsubscribe removes subscription", () => {
		const s = state<number>(0);
		const g = new Graph("gw-unsub");
		g.add("n", s);

		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		const send = (msg: ObserveWsMessage) => sent.push(msg);
		gw.handleMessage(client, { type: "subscribe", path: "n" }, send);
		expect(gw.subscriptionCount(client)).toBe(1);

		gw.handleMessage(client, { type: "unsubscribe", path: "n" }, send);
		expect(sent).toContainEqual({ type: "unsubscribed", path: "n" });
		expect(gw.subscriptionCount(client)).toBe(0);

		g.destroy();
	});

	it("forwards DATA to client via default send", () => {
		const s = state<number>(0);
		const g = new Graph("gw-send");
		g.add("n", s);

		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		// Use default send (client.send)
		gw.handleMessage(client, JSON.stringify({ type: "subscribe", path: "n" }));

		s.down([[DATA, 7]]);

		expect(client.send).toHaveBeenCalled();
		const lastCall = client.send.mock.calls.find((c: string[]) => c[0].includes('"data"'));
		expect(lastCall).toBeDefined();
		const msg = JSON.parse(lastCall![0]);
		expect(msg).toMatchObject({ type: "data", path: "n", value: 7 });

		gw.destroy();
		g.destroy();
	});

	it("handles invalid command gracefully", () => {
		const g = new Graph("gw-invalid");
		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		gw.handleMessage(client, "not json {{{", (msg) => sent.push(msg));
		expect(sent).toContainEqual({ type: "err", message: "invalid command" });

		gw.destroy();
		g.destroy();
	});

	it("handles unknown command type", () => {
		const g = new Graph("gw-unknown");
		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		gw.handleMessage(client, { type: "ping" } as any, (msg) => sent.push(msg));
		expect(sent[0]).toMatchObject({ type: "err" });

		gw.destroy();
		g.destroy();
	});

	it("respects actor guard via extractActor", () => {
		const s = state(0, {
			guard: policy((allow) => {
				allow("observe", { where: (a) => a.type === "human" });
			}),
		});
		const g = new Graph("gw-guard");
		g.add("guarded", s);

		const gw = new ObserveGateway(g, {
			extractActor: (client: any) => client.actor,
		});

		// LLM client — guard should deny
		const llmClient = { ...makeMockClient(), actor: { type: "llm", id: "a1" } };
		gw.handleConnection(llmClient);
		const sent: ObserveWsMessage[] = [];
		gw.handleMessage(llmClient, { type: "subscribe", path: "guarded" }, (msg) => sent.push(msg));
		expect(sent.some((m) => m.type === "err")).toBe(true);
		expect(gw.subscriptionCount(llmClient)).toBe(0);

		// Human client — should succeed
		const humanClient = { ...makeMockClient(), actor: { type: "human", id: "u1" } };
		gw.handleConnection(humanClient);
		const hSent: ObserveWsMessage[] = [];
		gw.handleMessage(humanClient, { type: "subscribe", path: "guarded" }, (msg) => hSent.push(msg));
		expect(hSent).toContainEqual({ type: "subscribed", path: "guarded" });
		expect(gw.subscriptionCount(humanClient)).toBe(1);

		gw.destroy();
		g.destroy();
	});

	it("disconnect disposes all client subscriptions", () => {
		const g = new Graph("gw-disc");
		g.add("a", state(1));
		g.add("b", state(2));

		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		const noop = () => {};
		gw.handleMessage(client, { type: "subscribe", path: "a" }, noop);
		gw.handleMessage(client, { type: "subscribe", path: "b" }, noop);
		expect(gw.subscriptionCount(client)).toBe(2);

		gw.handleDisconnect(client);
		expect(gw.subscriptionCount(client)).toBe(0);

		g.destroy();
	});

	it("forwards ERROR and COMPLETE to client", () => {
		const s = state<number>(0);
		const g = new Graph("gw-term");
		g.add("n", s);

		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		gw.handleMessage(client, { type: "subscribe", path: "n" }, (msg) => sent.push(msg));

		s.down([[ERROR, new Error("oops")]]);

		expect(sent).toContainEqual(expect.objectContaining({ type: "error", path: "n" }));

		gw.destroy();
		g.destroy();
	});

	it("COMPLETE auto-cleans subscription — allows resubscribe", () => {
		const s = state<number>(0);
		const g = new Graph("gw-resub");
		g.add("n", s);

		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		const send = (msg: ObserveWsMessage) => sent.push(msg);
		gw.handleMessage(client, { type: "subscribe", path: "n" }, send);
		expect(gw.subscriptionCount(client)).toBe(1);

		s.down([[COMPLETE]]);
		expect(sent).toContainEqual({ type: "complete", path: "n" });
		// Subscription should be auto-cleaned
		expect(gw.subscriptionCount(client)).toBe(0);

		gw.destroy();
		g.destroy();
	});

	it("TEARDOWN closes WS subscription", () => {
		const s = state<number>(0);
		const g = new Graph("gw-td");
		g.add("n", s);

		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		gw.handleMessage(client, { type: "subscribe", path: "n" }, (msg) => sent.push(msg));
		expect(gw.subscriptionCount(client)).toBe(1);

		s.down([[TEARDOWN]]);
		expect(sent).toContainEqual({ type: "complete", path: "n" });
		expect(gw.subscriptionCount(client)).toBe(0);

		gw.destroy();
		g.destroy();
	});
});

describe("nestjs compat — TEARDOWN handling", () => {
	it("observeSSE closes on TEARDOWN", async () => {
		const s = state<number>(0);
		const g = new Graph("sse-td");
		g.add("n", s);

		const stream = observeSSE(g, "n");
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		s.down([[DATA, 1]]);
		s.down([[TEARDOWN]]);

		const chunks: string[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(decoder.decode(value));
		}

		expect(chunks.join("")).toContain("event: data\ndata: 1\n\n");
		g.destroy();
	});

	it("observeSubscription completes on TEARDOWN", async () => {
		const s = state<string>("");
		const g = new Graph("sub-td");
		g.add("n", s);

		const iter = observeSubscription<string>(g, "n");

		s.down([[DATA, "val"]]);
		s.down([[TEARDOWN]]);

		const results: string[] = [];
		for await (const v of iter) {
			results.push(v);
		}

		expect(results).toEqual(["val"]);
		g.destroy();
	});

	it("observeSubscription disposes subscription on COMPLETE", async () => {
		const s = state<number>(0);
		const g = new Graph("sub-dispose");
		g.add("n", s);

		const iter = observeSubscription<number>(g, "n");
		s.down([[DATA, 1]]);
		s.down([[COMPLETE]]);

		const r1 = await iter.next();
		expect(r1).toEqual({ done: false, value: 1 });

		const r2 = await iter.next();
		expect(r2.done).toBe(true);

		// Further calls should also be done (subscription disposed)
		const r3 = await iter.next();
		expect(r3.done).toBe(true);
		g.destroy();
	});
});

// ---------------------------------------------------------------------------
// CQRS replacement — forCqrs
// ---------------------------------------------------------------------------

describe("nestjs compat — GraphReflyModule.forCqrs", () => {
	beforeEach(() => {
		EVENT_HANDLERS.clear();
		INTERVAL_HANDLERS.clear();
		CRON_HANDLERS.clear();
		COMMAND_HANDLERS.clear();
		CQRS_EVENT_HANDLERS.clear();
		QUERY_HANDLERS.clear();
		SAGA_HANDLERS.clear();
	});

	it("creates CqrsGraph and mounts into root", async () => {
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "orders",
					build: (g) => {
						g.event("orderPlaced");
						g.command("placeOrder", (_payload, { emit }) => {
							emit("orderPlaced", { id: "1" });
						});
					},
				}),
			],
		}).compile();

		const root = module.get<Graph>(GRAPHREFLY_ROOT_GRAPH);
		const cqrsGraph = module.get<CqrsGraph>(getGraphToken("orders"));
		expect(cqrsGraph).toBeDefined();
		expect(cqrsGraph.name).toBe("orders");

		// Mounted into root — visible via qualified path
		const desc = root.describe();
		expect(desc.subgraphs).toContain("orders");

		cqrsGraph.dispatch("placeOrder", { id: "1" });
		await module.close();
	});

	it("build callback registers commands, events, projections", async () => {
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "shop",
					build: (g) => {
						g.event("itemAdded");
						g.command("addItem", (payload, { emit }) => {
							emit("itemAdded", payload);
						});
						g.projection("itemCount", ["itemAdded"], (_s, events) => events.length, 0);
					},
				}),
			],
		}).compile();

		const cqrsGraph = module.get<CqrsGraph>(getGraphToken("shop"));
		cqrsGraph.dispatch("addItem", { name: "widget" });
		cqrsGraph.dispatch("addItem", { name: "gadget" });

		expect(cqrsGraph.get("itemCount")).toBe(2);
		await module.close();
	});

	it("exposes node paths as injectable providers", async () => {
		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "inv",
					build: (g) => {
						g.event("added");
						g.projection("total", ["added"], (_s, evts) => evts.length, 0);
					},
					nodes: ["total"],
				}),
			],
		}).compile();

		const totalNode = module.get<Node<number>>(getNodeToken("inv::total"));
		expect(totalNode.get()).toBe(0);

		await module.close();
	});

	it("teardown cascades from root on module close", async () => {
		const teardownSpy = vi.fn();

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "temp",
					build: (g) => {
						const evNode = g.event("ev");
						evNode.subscribe((msgs) => {
							for (const m of msgs) {
								if (m[0] === TEARDOWN) teardownSpy();
							}
						});
					},
				}),
			],
		}).compile();

		await module.init();
		await module.close();
		expect(teardownSpy).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// CQRS replacement — @CommandHandler decorator
// ---------------------------------------------------------------------------

describe("nestjs compat — @CommandHandler", () => {
	beforeEach(() => {
		EVENT_HANDLERS.clear();
		INTERVAL_HANDLERS.clear();
		CRON_HANDLERS.clear();
		COMMAND_HANDLERS.clear();
		CQRS_EVENT_HANDLERS.clear();
		QUERY_HANDLERS.clear();
		SAGA_HANDLERS.clear();
	});

	it("registers method as command handler, invoked via dispatch", async () => {
		const payloads: unknown[] = [];

		@Injectable()
		class OrderService {
			@CommandHandler("orders", "placeOrder")
			handlePlace(payload: { id: string }, { emit }: CommandActions) {
				payloads.push(payload);
				emit("orderPlaced", payload);
			}
		}

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "orders",
					build: (g) => {
						g.event("orderPlaced");
					},
				}),
			],
			providers: [OrderService],
		}).compile();

		await module.init();

		const cqrsGraph = module.get<CqrsGraph>(getGraphToken("orders"));
		cqrsGraph.dispatch("placeOrder", { id: "o1" });

		expect(payloads).toEqual([{ id: "o1" }]);
		await module.close();
	});

	it("multiple commands on same class", async () => {
		const placed: unknown[] = [];
		const cancelled: unknown[] = [];

		@Injectable()
		class OrderService {
			@CommandHandler("orders", "place")
			handlePlace(p: unknown) {
				placed.push(p);
			}

			@CommandHandler("orders", "cancel")
			handleCancel(p: unknown) {
				cancelled.push(p);
			}
		}

		const module = await Test.createTestingModule({
			imports: [GraphReflyModule.forRoot(), GraphReflyModule.forCqrs({ name: "orders" })],
			providers: [OrderService],
		}).compile();

		await module.init();

		const g = module.get<CqrsGraph>(getGraphToken("orders"));
		g.dispatch("place", { id: "1" });
		g.dispatch("cancel", { id: "2" });

		expect(placed).toEqual([{ id: "1" }]);
		expect(cancelled).toEqual([{ id: "2" }]);

		await module.close();
	});
});

// ---------------------------------------------------------------------------
// CQRS replacement — @EventHandler decorator
// ---------------------------------------------------------------------------

describe("nestjs compat — @EventHandler", () => {
	beforeEach(() => {
		EVENT_HANDLERS.clear();
		INTERVAL_HANDLERS.clear();
		CRON_HANDLERS.clear();
		COMMAND_HANDLERS.clear();
		CQRS_EVENT_HANDLERS.clear();
		QUERY_HANDLERS.clear();
		SAGA_HANDLERS.clear();
	});

	it("delivers new CqrsEvent envelopes to decorated method", async () => {
		const received: CqrsEvent[] = [];

		@Injectable()
		class NotifyService {
			@EventHandler("orders", "orderPlaced")
			onPlaced(event: CqrsEvent) {
				received.push(event);
			}
		}

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "orders",
					build: (g) => {
						g.event("orderPlaced");
						g.command("place", (_p, { emit }) => {
							emit("orderPlaced", { id: _p.id });
						});
					},
				}),
			],
			providers: [NotifyService],
		}).compile();

		await module.init();

		const g = module.get<CqrsGraph>(getGraphToken("orders"));
		g.dispatch("place", { id: "o1" });
		g.dispatch("place", { id: "o2" });

		expect(received).toHaveLength(2);
		expect(received[0].type).toBe("orderPlaced");
		expect(received[0].payload).toEqual({ id: "o1" });
		expect(received[1].payload).toEqual({ id: "o2" });

		await module.close();
	});

	it("only delivers new events, not historical", async () => {
		const received: CqrsEvent[] = [];

		@Injectable()
		class Listener {
			@EventHandler("shop", "itemAdded")
			onItem(event: CqrsEvent) {
				received.push(event);
			}
		}

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "shop",
					build: (g) => {
						g.event("itemAdded");
						g.command("add", (_p, { emit }) => emit("itemAdded", _p));
					},
				}),
			],
			providers: [Listener],
		}).compile();

		// Dispatch before init — events land in the log but handler isn't wired yet
		const g = module.get<CqrsGraph>(getGraphToken("shop"));
		g.dispatch("add", { name: "pre-init" });

		await module.init();

		// After init, new events should arrive
		g.dispatch("add", { name: "post-init" });

		// Only post-init event delivered
		expect(received).toHaveLength(1);
		expect(received[0].payload).toEqual({ name: "post-init" });

		await module.close();
	});
});

// ---------------------------------------------------------------------------
// CQRS replacement — @QueryHandler decorator
// ---------------------------------------------------------------------------

describe("nestjs compat — @QueryHandler", () => {
	beforeEach(() => {
		EVENT_HANDLERS.clear();
		INTERVAL_HANDLERS.clear();
		CRON_HANDLERS.clear();
		COMMAND_HANDLERS.clear();
		CQRS_EVENT_HANDLERS.clear();
		QUERY_HANDLERS.clear();
		SAGA_HANDLERS.clear();
	});

	it("pushes projection value changes to decorated method", async () => {
		const values: number[] = [];

		@Injectable()
		class DashboardService {
			@QueryHandler("shop", "itemCount")
			onCountChanged(count: number) {
				values.push(count);
			}
		}

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "shop",
					build: (g) => {
						g.event("itemAdded");
						g.command("add", (_p, { emit }) => emit("itemAdded", _p));
						g.projection("itemCount", ["itemAdded"], (_s, evts) => evts.length, 0);
					},
				}),
			],
			providers: [DashboardService],
		}).compile();

		await module.init();

		const g = module.get<CqrsGraph>(getGraphToken("shop"));
		g.dispatch("add", { name: "a" });
		g.dispatch("add", { name: "b" });

		expect(values).toEqual([1, 2]);

		await module.close();
	});
});

// ---------------------------------------------------------------------------
// CQRS replacement — @SagaHandler decorator
// ---------------------------------------------------------------------------

describe("nestjs compat — @SagaHandler", () => {
	beforeEach(() => {
		EVENT_HANDLERS.clear();
		INTERVAL_HANDLERS.clear();
		CRON_HANDLERS.clear();
		COMMAND_HANDLERS.clear();
		CQRS_EVENT_HANDLERS.clear();
		QUERY_HANDLERS.clear();
		SAGA_HANDLERS.clear();
	});

	it("registers saga subgraph, delivers new events", async () => {
		const processed: CqrsEvent[] = [];

		@Injectable()
		class FulfillmentService {
			@SagaHandler("orders", "fulfillment", ["orderPlaced"])
			onOrder(event: CqrsEvent) {
				processed.push(event);
			}
		}

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "orders",
					build: (g) => {
						g.event("orderPlaced");
						g.command("place", (_p, { emit }) => emit("orderPlaced", _p));
					},
				}),
			],
			providers: [FulfillmentService],
		}).compile();

		await module.init();

		const g = module.get<CqrsGraph>(getGraphToken("orders"));
		g.dispatch("place", { id: "o1" });
		g.dispatch("place", { id: "o2" });

		expect(processed).toHaveLength(2);
		expect(processed[0].type).toBe("orderPlaced");
		expect(processed[0].payload).toEqual({ id: "o1" });
		expect(processed[1].payload).toEqual({ id: "o2" });

		await module.close();
	});

	it("saga listens to multiple event streams", async () => {
		const processed: CqrsEvent[] = [];

		@Injectable()
		class MultiSaga {
			@SagaHandler("shop", "monitor", ["orderPlaced", "orderCancelled"])
			onAny(event: CqrsEvent) {
				processed.push(event);
			}
		}

		const module = await Test.createTestingModule({
			imports: [
				GraphReflyModule.forRoot(),
				GraphReflyModule.forCqrs({
					name: "shop",
					build: (g) => {
						g.event("orderPlaced");
						g.event("orderCancelled");
						g.command("place", (_p, { emit }) => emit("orderPlaced", _p));
						g.command("cancel", (_p, { emit }) => emit("orderCancelled", _p));
					},
				}),
			],
			providers: [MultiSaga],
		}).compile();

		await module.init();

		const g = module.get<CqrsGraph>(getGraphToken("shop"));
		g.dispatch("place", { id: "1" });
		g.dispatch("cancel", { id: "2" });

		expect(processed).toHaveLength(2);
		expect(processed.map((e) => e.type)).toEqual(["orderPlaced", "orderCancelled"]);

		await module.close();
	});
});

// ---------------------------------------------------------------------------
// CQRS decorator metadata — unit tests
// ---------------------------------------------------------------------------

describe("nestjs compat — CQRS decorators (metadata)", () => {
	beforeEach(() => {
		COMMAND_HANDLERS.clear();
		CQRS_EVENT_HANDLERS.clear();
		QUERY_HANDLERS.clear();
		SAGA_HANDLERS.clear();
	});

	it("@CommandHandler stores metadata after instantiation", () => {
		@Injectable()
		class Svc {
			@CommandHandler("orders", "place")
			handle() {}
		}

		new Svc();
		const metas = COMMAND_HANDLERS.get(Svc);
		expect(metas).toHaveLength(1);
		expect(metas![0]).toMatchObject({
			cqrsName: "orders",
			commandName: "place",
			methodKey: "handle",
		});
	});

	it("@EventHandler stores metadata after instantiation", () => {
		@Injectable()
		class Svc {
			@EventHandler("orders", "placed")
			on() {}
		}

		new Svc();
		const metas = CQRS_EVENT_HANDLERS.get(Svc);
		expect(metas).toHaveLength(1);
		expect(metas![0]).toMatchObject({ cqrsName: "orders", eventName: "placed", methodKey: "on" });
	});

	it("@QueryHandler stores metadata after instantiation", () => {
		@Injectable()
		class Svc {
			@QueryHandler("orders", "count")
			on() {}
		}

		new Svc();
		const metas = QUERY_HANDLERS.get(Svc);
		expect(metas).toHaveLength(1);
		expect(metas![0]).toMatchObject({
			cqrsName: "orders",
			projectionName: "count",
			methodKey: "on",
		});
	});

	it("@SagaHandler stores metadata after instantiation", () => {
		@Injectable()
		class Svc {
			@SagaHandler("orders", "mySaga", ["placed", "shipped"])
			handle() {}
		}

		new Svc();
		const metas = SAGA_HANDLERS.get(Svc);
		expect(metas).toHaveLength(1);
		expect(metas![0]).toMatchObject({
			cqrsName: "orders",
			sagaName: "mySaga",
			eventNames: ["placed", "shipped"],
			methodKey: "handle",
		});
	});
});
