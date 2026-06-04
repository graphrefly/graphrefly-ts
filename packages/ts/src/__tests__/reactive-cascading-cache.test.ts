import { describe, expect, it } from "vitest";
import { graph, memoryKv, reactiveCascadingCache } from "../index.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function dataOf<T>(node: { subscribe: (sink: (msg: unknown[]) => void) => () => void }): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}

describe("reactiveCascadingCache (D104/D105/D107)", () => {
	it("exposes request, event, status, and value nodes in describe", async () => {
		const g = graph();
		const request = g.node<string>([], null, { name: "request" });
		const hot = memoryKv<number>();
		const cold = memoryKv<number>();
		await cold.set("user:1", 7);

		const cache = reactiveCascadingCache({
			graph: g,
			request,
			tiers: [hot, cold],
			tierNames: ["hot", "cold"],
			name: "cache",
		});

		dataOf(cache.status);
		dataOf(cache.value);
		request.down([["DATA", "user:1"]]);
		await flush();

		const snap = g.describe();
		expect(snap.nodes.map((n) => n.id).sort()).toEqual([
			"cache.events",
			"cache.status",
			"cache.value",
			"request",
		]);
		expect(snap.edges).toEqual(
			expect.arrayContaining([
				{ from: "request", to: "cache.events" },
				{ from: "cache.events", to: "cache.status" },
				{ from: "cache.events", to: "cache.value" },
			]),
		);
	});

	it("looks through tiers without storage promotion by default", async () => {
		const g = graph();
		const request = g.node<string>([], null, { name: "request" });
		const hot = memoryKv<number>();
		const cold = memoryKv<number>();
		await cold.set("k", 42);
		const cache = reactiveCascadingCache({
			graph: g,
			request,
			tiers: [hot, cold],
			tierNames: ["hot", "cold"],
			name: "cache",
		});
		const statuses = dataOf(cache.status);
		const values = dataOf(cache.value);
		const events = dataOf(cache.events);

		request.down([["DATA", "k"]]);
		await flush();

		expect(values).toEqual([42]);
		expect(cache.value.cache).toBe(42);
		expect(await hot.get("k")).toBeUndefined();
		expect(statuses.at(-1)).toEqual({
			kind: "hit",
			key: "k",
			requestSeq: 1,
			tier: { index: 1, name: "cold" },
		});
		expect(events.map((event) => event.kind)).toEqual(["request", "lookup", "lookup", "fill"]);
	});

	it("promotes hits only when storage promotion is explicitly enabled", async () => {
		const g = graph();
		const request = g.node<string>([], null);
		const hot = memoryKv<number>();
		const cold = memoryKv<number>();
		await cold.set("k", 42);
		const cache = reactiveCascadingCache({
			graph: g,
			request,
			tiers: [hot, cold],
			tierNames: ["hot", "cold"],
			promoteTo: [0],
			name: "cache",
		});
		dataOf(cache.status);
		dataOf(cache.value);
		const events = dataOf(cache.events);

		request.down([["DATA", "k"]]);
		await flush();

		expect(cache.value.cache).toBe(42);
		expect(await hot.get("k")).toBe(42);
		expect(events.map((event) => event.kind)).toEqual([
			"request",
			"lookup",
			"lookup",
			"promotion",
			"fill",
		]);
	});

	it("uses loader fills after tier misses", async () => {
		const g = graph();
		const request = g.node<string>([], null);
		const hot = memoryKv<number>();
		const cache = reactiveCascadingCache({
			graph: g,
			request,
			tiers: [hot],
			load: (key) => (key === "remote" ? 9 : undefined),
			name: "cache",
		});
		const statuses = dataOf(cache.status);
		const values = dataOf(cache.value);
		const events = dataOf(cache.events);

		request.down([["DATA", "remote"]]);
		await flush();

		expect(values).toEqual([9]);
		expect(await hot.get("remote")).toBeUndefined();
		expect(statuses.at(-1)).toEqual({
			kind: "hit",
			key: "remote",
			requestSeq: 1,
			tier: { index: -1, name: "load" },
		});
		expect(events.at(-1)).toMatchObject({ kind: "fill", status: "hit", requestSeq: 1 });
	});

	it("prevents an older async fill from overwriting a newer request", async () => {
		const g = graph();
		const request = g.node<string>([], null);
		const hot = memoryKv<number>();
		const resolvers = new Map<string, (value: number | undefined) => void>();
		const cache = reactiveCascadingCache({
			graph: g,
			request,
			tiers: [hot],
			load: (key) =>
				new Promise<number | undefined>((resolve) => {
					resolvers.set(key, resolve);
				}),
			name: "cache",
		});
		dataOf(cache.status);
		const values = dataOf(cache.value);
		const events = dataOf(cache.events);

		request.down([["DATA", "slow"]]);
		request.down([["DATA", "fast"]]);
		await flush();
		resolvers.get("fast")?.(2);
		await flush();
		expect(cache.value.cache).toBe(2);

		resolvers.get("slow")?.(1);
		await flush();
		expect(values).toEqual([2]);
		expect(cache.value.cache).toBe(2);
		expect(await hot.get("fast")).toBeUndefined();
		expect(await hot.get("slow")).toBeUndefined();
		expect(
			events.filter((event) => event.kind === "fill").map((event) => event.requestSeq),
		).toEqual([2, 1]);
	});

	it("invalidates visible value and blocks older fills until the invalidation lookup resolves", async () => {
		const g = graph();
		const request = g.node<string>([], null);
		const invalidate = g.node<string>([], null);
		const resolvers: Array<(value: number | undefined) => void> = [];
		const cache = reactiveCascadingCache({
			graph: g,
			request,
			invalidate,
			tiers: [],
			load: () =>
				new Promise<number | undefined>((resolve) => {
					resolvers.push(resolve);
				}),
			name: "cache",
		});
		const statuses = dataOf(cache.status);
		const values = dataOf(cache.value);
		dataOf(cache.events);

		request.down([["DATA", "k"]]);
		await flush();
		resolvers[0]?.(9);
		await flush();
		expect(cache.value.cache).toBe(9);

		request.down([["DATA", "k"]]);
		invalidate.down([["DATA", "k"]]);
		await flush();
		await flush();
		expect(cache.value.cache).toBeUndefined();

		resolvers[1]?.(10);
		await flush();
		expect(cache.value.cache).toBeUndefined();

		resolvers[2]?.(11);
		await flush();
		expect(values).toEqual([9, 11]);
		expect(cache.value.cache).toBe(11);
		expect(statuses.at(-1)).toEqual({
			kind: "hit",
			key: "k",
			requestSeq: 3,
			tier: { index: -1, name: "load" },
		});
	});

	it("applies declared policy changes to the next lookup", async () => {
		const g = graph();
		const request = g.node<string>([], null);
		const policy = g.node<{ promoteTo?: readonly number[] | false }>([], null);
		const hot = memoryKv<number>();
		const cold = memoryKv<number>();
		await cold.set("k", 3);
		const cache = reactiveCascadingCache({
			graph: g,
			request,
			policy,
			tiers: [hot, cold],
			promoteTo: false,
			name: "cache",
		});
		dataOf(cache.status);
		dataOf(cache.value);

		request.down([["DATA", "k"]]);
		await flush();
		expect(await hot.get("k")).toBeUndefined();

		policy.down([["DATA", { promoteTo: [0] }]]);
		await flush();
		expect(await hot.get("k")).toBe(3);
	});

	it("drops in-flight fills after the cache bundle deactivates", async () => {
		const g = graph();
		const request = g.node<string>([], null);
		let resolveLoad: ((value: number | undefined) => void) | undefined;
		const cache = reactiveCascadingCache({
			graph: g,
			request,
			tiers: [],
			load: () =>
				new Promise<number | undefined>((resolve) => {
					resolveLoad = resolve;
				}),
			name: "cache",
		});
		const values: number[] = [];
		const unsubscribe = cache.value.subscribe((msg) => {
			if (msg[0] === "DATA") values.push(msg[1] as number);
		});

		request.down([["DATA", "k"]]);
		await flush();
		unsubscribe();
		resolveLoad?.(99);
		await flush();

		expect(values).toEqual([]);
		expect(cache.value.cache).toBeUndefined();
	});
});

it("exports reactiveCascadingCache from the graph subpath barrel", async () => {
	const graphLayer = await import("../graph/index.js");
	expect(typeof graphLayer.reactiveCascadingCache).toBe("function");
});
