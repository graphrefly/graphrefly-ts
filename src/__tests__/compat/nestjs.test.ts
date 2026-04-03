import "reflect-metadata";
import { Injectable } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { firstValueFrom as rxFirstValueFrom, take, toArray } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CRON_HANDLERS,
	EVENT_HANDLERS,
	GRAPHREFLY_ROOT_GRAPH,
	GraphCron,
	GraphInterval,
	GraphReflyModule,
	getGraphToken,
	getNodeToken,
	INTERVAL_HANDLERS,
	OnGraphEvent,
} from "../../compat/nestjs/index.js";
import { COMPLETE, DATA, DIRTY, ERROR, type Messages, TEARDOWN } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { observeGraph$, observeNode$, toMessages$, toObservable } from "../../extra/observable.js";
import { Graph } from "../../graph/graph.js";

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

	it("toMessages$: emits raw message batches", async () => {
		const s = state<number>(0);
		// Batch splits DIRTY (immediate, tier 0) from DATA (deferred, tier 2).
		// So s.down([[DIRTY], [DATA, 1]]) produces two emissions: [[DIRTY]] then [[DATA, 1]].
		const msgs$ = toMessages$(s).pipe(take(2), toArray());
		const p = rxFirstValueFrom(msgs$);

		s.down([[DIRTY], [DATA, 1]]);

		const result = await p;
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual([[DIRTY]]);
		expect(result[1]).toEqual([[DATA, 1]]);
	});

	it("toMessages$: terminal batch emitted before Observable error", async () => {
		const s = state<number>(0);
		const batches: Messages[] = [];
		let caughtError: unknown;

		await new Promise<void>((resolve) => {
			toMessages$(s).subscribe({
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

	it("observeNode$: streams node values through graph.observe", async () => {
		const g = new Graph("test");
		const s = state<number>(10);
		g.add("counter", s);

		const values$ = observeNode$<number>(g, "counter").pipe(take(2), toArray());
		const p = rxFirstValueFrom(values$);

		s.down([[DATA, 20]]);
		s.down([[DATA, 30]]);

		const result = await p;
		expect(result).toEqual([20, 30]);
	});

	it("observeGraph$: streams all node events", async () => {
		const g = new Graph("test");
		const a = state<number>(1);
		const b = state<number>(2);
		g.add("a", a);
		g.add("b", b);

		const events$ = observeGraph$(g).pipe(take(2), toArray());
		const p = rxFirstValueFrom(events$);

		a.down([[DATA, 10]]);
		b.down([[DATA, 20]]);

		const result = await p;
		expect(result).toHaveLength(2);
		const paths = result.map((e) => e.path);
		expect(paths).toContain("a");
		expect(paths).toContain("b");
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
