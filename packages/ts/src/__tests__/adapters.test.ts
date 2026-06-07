import { describe, expect, it, vi } from "vitest";
import {
	CRON_HANDLERS,
	EVENT_HANDLERS,
	externalStore,
	GRAPHREFLY_REQUEST_GRAPH,
	GRAPHREFLY_ROOT_GRAPH,
	GraphCron,
	GraphInterval,
	getGraphToken,
	getNodeToken,
	INTERVAL_HANDLERS,
	jotaiAtom,
	nanoAtom,
	nodeSnapshot,
	OnGraphEvent,
	readableStore,
	recordReadableStore,
	signalFromNode,
	subscribeNodeValues,
	writableStore,
	zustandStore,
} from "../adapters/index.js";
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
		expect(EVENT_HANDLERS.get(Service)).toEqual([
			{ nodeName: "orders::created", methodKey: "handle" },
		]);
		expect(CRON_HANDLERS.get(Service)).toEqual([{ expr: "* * * * *", methodKey: "tick" }]);
		expect(INTERVAL_HANDLERS.get(Service)).toEqual([{ ms: 1000, methodKey: "interval" }]);
	});
});
