import { DATA, node } from "@graphrefly/pure-ts/core";
import { describe, expect, it } from "vitest";
import { distill } from "../../../base/composition/distill.js";
import { verifiable } from "../../../base/composition/verifiable.js";

function tick(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("extra composite verifiable (roadmap §3.2b)", () => {
	it("runs verification from explicit trigger", () => {
		const source = node([], { initial: 2 });
		const trigger = node([], { initial: 0 });
		const bundle = verifiable(source, (value) => ({ holds: value > 0, checked: value }), {
			trigger,
			autoVerify: false,
		});

		expect(bundle.verified.cache).toEqual({ holds: true, checked: 2 });
		trigger.down([[DATA, 1]]);
		expect(bundle.verified.cache).toEqual({ holds: true, checked: 2 });
	});

	it("cancels stale verification with switchMap", async () => {
		const source = node([], { initial: 1 });
		const trigger = node([], { initial: 0 });
		const bundle = verifiable(
			source,
			(value) =>
				new Promise<{ value: number }>((resolve) => {
					setTimeout(() => resolve({ value }), value === 1 ? 40 : 5);
				}),
			{ trigger },
		);

		trigger.down([[DATA, 1]]);
		source.down([[DATA, 2]]);
		trigger.down([[DATA, 2]]);

		await tick(15);
		expect(bundle.verified.cache).toEqual({ value: 2 });

		await tick(60);
		expect(bundle.verified.cache).toEqual({ value: 2 });
	});

	it("accepts falsy scalar trigger values", () => {
		const source = node([], { initial: 3 });
		const bundle = verifiable(source, (value) => value * 10, { trigger: 0 as const });
		expect(bundle.trigger).not.toBe(null);
		expect(bundle.verified.cache).toBe(30);
	});

	it("stamps sourceVersion meta when source node has V0", () => {
		const source = node([], { versioning: 0, initial: 2 });
		const trigger = node([], { initial: 0 });
		const bundle = verifiable(source, (value) => ({ checked: value }), {
			trigger,
			autoVerify: false,
		});
		trigger.down([[DATA, 1]]);
		const sv = (bundle.verified.meta as any).sourceVersion.cache as {
			id: string;
			version: number;
		};
		expect(sv.id).toBe(source.v!.id);
		expect(sv.version).toBe(source.v!.version);
	});

	// P11.5-D1 regression: explicit-trigger verifiable wires
	// `withLatestFrom(trigger, source)` with `partial: false`. A regression
	// that drops the withLatestFrom edge (e.g. back to a §28 closure-mirror)
	// would call `verifyFn(undefined as T)` on the first trigger when source
	// has not yet emitted DATA. This test pins that the gate holds until
	// both deps settle.
	it("trigger-before-source-DATA waits for source via withLatestFrom partial:false", () => {
		const source = node<number>([]); // no initial DATA
		const trigger = node<number>([]); // no initial DATA
		const calls: unknown[] = [];
		const bundle = verifiable(
			source,
			(value: number) => {
				calls.push(value);
				return value * 10;
			},
			{ trigger, autoVerify: false },
		);
		// Keepalive so verifyStream activates; verifying-side starts pending.
		const off = bundle.verified.subscribe(() => undefined);

		expect(calls).toEqual([]);
		expect(bundle.verified.cache).toBeNull();

		// Trigger alone — withLatestFrom must NOT release the fn yet.
		trigger.down([[DATA, 1]]);
		expect(calls).toEqual([]);
		expect(bundle.verified.cache).toBeNull();

		// Source emits — both deps have DATA, fn fires once.
		source.down([[DATA, 7]]);
		expect(calls).toEqual([7]);
		expect(bundle.verified.cache).toBe(70);

		// Subsequent trigger pairs with the new latest source value.
		source.down([[DATA, 9]]);
		trigger.down([[DATA, 2]]);
		expect(calls.at(-1)).toBe(9);
		expect(bundle.verified.cache).toBe(90);
		off();
	});
});

describe("extra composite distill (roadmap §3.2b)", () => {
	it("extracts memories and builds compact view", () => {
		const source = node([], { initial: "alpha" });
		const bundle = distill(
			source,
			(rawNode) =>
				node(
					[rawNode],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						const raw = data[0];
						actions.emit({
							upsert: [{ key: raw, value: { text: raw, points: raw.length } }],
						});
					},
					{ describeKind: "derived" },
				),
			{
				score: (mem) => mem.points,
				cost: () => 1,
				budget: 10,
			},
		);

		source.down([[DATA, "beta"]]);
		expect(bundle.store.get("beta")).toEqual({ text: "beta", points: 4 });
		expect(bundle.size.cache).toBeGreaterThan(0);
		expect(bundle.compact.cache.some((x) => x.key === "beta")).toBe(true);
	});

	it("reactively evicts via dynamicNode-tracked condition", () => {
		const source = node([], { initial: "x" });
		const evictToggle = node([], { initial: false });
		const bundle = distill(
			source,
			(rawNode) =>
				node(
					[rawNode],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						actions.emit({ upsert: [{ key: data[0], value: { text: data[0] } }] });
					},
					{ describeKind: "derived" },
				),
			{
				score: () => 1,
				cost: () => 1,
				budget: 10,
				evict: () => evictToggle,
			},
		);

		source.down([[DATA, "keep-me"]]);
		expect(bundle.store.has("keep-me")).toBe(true);
		evictToggle.down([[DATA, true]]);
		expect(bundle.store.has("keep-me")).toBe(false);
	});

	it("runs consolidation from trigger and keeps extraction atomic", () => {
		const source = node([], { initial: "seed" });
		const consolidateTrigger = node([], { initial: false });
		const bundle = distill(
			source,
			(rawNode) =>
				node(
					[rawNode],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						const raw = data[0];
						actions.emit({
							upsert: [{ key: raw, value: { text: raw, points: raw.length } }],
						});
					},
					{ describeKind: "derived" },
				),
			{
				score: (mem) => mem.points,
				cost: () => 1,
				budget: 10,
				consolidate: () => ({
					upsert: [{ key: "merged", value: { text: "merged", points: 99 } }],
					remove: ["seed"],
				}),
				consolidateTrigger,
			},
		);

		const sizes: number[] = [];
		const unsub = bundle.size.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) sizes.push(m[1] as number);
		});
		consolidateTrigger.down([[DATA, true]]);
		unsub();

		expect(bundle.store.has("seed")).toBe(false);
		expect(bundle.store.has("merged")).toBe(true);
		expect(sizes.every((size) => size >= 1)).toBe(true);
	});

	it("accepts falsy scalar context and consolidateTrigger", () => {
		const source = node([], { initial: "seed" });
		const bundle = distill(
			source,
			(rawNode) =>
				node(
					[rawNode],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						const raw = data[0];
						actions.emit({
							upsert: [{ key: raw, value: { text: raw, points: raw.length } }],
						});
					},
					{ describeKind: "derived" },
				),
			{
				score: (mem, context) => mem.points + (context as number),
				cost: () => 1,
				budget: 10,
				context: 0 as const,
				consolidateTrigger: 0 as const,
				consolidate: () => ({
					upsert: [{ key: "merged", value: { text: "merged", points: 99 } }],
					remove: ["seed"],
				}),
			},
		);
		expect(bundle.store.has("seed")).toBe(false);
		expect(bundle.store.has("merged")).toBe(true);
		expect(bundle.compact.cache.some((x) => x.key === "merged")).toBe(true);
	});

	it("throws for invalid evict return type", () => {
		const source = node([], { initial: "x" });
		const bundle = distill(
			source,
			(rawNode) =>
				node(
					[rawNode],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						actions.emit({ upsert: [{ key: data[0], value: { text: data[0] } }] });
					},
					{ describeKind: "derived" },
				),
			{
				score: () => 1,
				cost: () => 1,
				budget: 10,
				evict: () => "bad" as unknown as boolean,
			},
		);
		expect(() => source.down([[DATA, "y"]])).not.toThrow();
		expect(bundle.store.has("x")).toBe(true);
	});

	// P11.5-D1 regression: distill consolidate path wires
	// `withLatestFrom(consolidateTrigger, store.entries)`. A regression that
	// drops the withLatestFrom edge (e.g. closure-mirror) would either fire
	// consolidate on every store mutation (wrong primary) or never fire when
	// the trigger leads the store. This test pins both halves.
	it("consolidate fires on trigger only, not on store mutation alone", () => {
		const source = node([], { initial: "seed-1" });
		const trigger = node<number>([]);
		const consolidateCalls: number[] = [];
		let callId = 0;

		const bundle = distill(
			source,
			(rawNode) =>
				node(
					[rawNode],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						const raw = data[0] as string;
						actions.emit({ upsert: [{ key: raw, value: { text: raw, points: 1 } }] });
					},
					{ describeKind: "derived" },
				),
			{
				score: () => 1,
				cost: () => 1,
				budget: 10,
				consolidateTrigger: trigger,
				consolidate: (entries) => {
					consolidateCalls.push(callId++);
					return { upsert: [{ key: `consol-${entries.size}`, value: { text: "c", points: 0 } }] };
				},
			},
		);

		// Source emit alone must NOT fire consolidate (trigger is the primary).
		source.down([[DATA, "seed-2"]]);
		expect(bundle.store.has("seed-2")).toBe(true);
		expect(consolidateCalls).toEqual([]);

		// Trigger fires — withLatestFrom releases with store.entries snapshot.
		trigger.down([[DATA, 1]]);
		expect(consolidateCalls).toEqual([0]);

		// Subsequent store mutation alone — still no consolidate fire.
		source.down([[DATA, "seed-3"]]);
		expect(consolidateCalls).toEqual([0]);

		// Trigger fires again — fresh store snapshot.
		trigger.down([[DATA, 2]]);
		expect(consolidateCalls).toEqual([0, 1]);
	});

	it("throws when extraction omits upsert", () => {
		const source = node([], { initial: "seed" });
		const bundle = distill(
			source,
			(rawNode) =>
				node(
					[rawNode],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						const raw = data[0];
						actions.emit(
							raw === "seed"
								? { upsert: [{ key: raw, value: { text: raw } }] }
								: ({
										remove: ["seed"],
									} as unknown as {
										upsert: Array<{ key: string; value: { text: string } }>;
									}),
						);
					},
					{ describeKind: "derived" },
				),
			{
				score: () => 1,
				cost: () => 1,
				budget: 10,
			},
		);
		expect(() => source.down([[DATA, "run"]])).not.toThrow();
		expect(bundle.store.has("seed")).toBe(true);
	});
});
