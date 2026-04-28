import { describe, expect, it } from "vitest";
import { DATA } from "../../core/messages.js";
import { derived, state } from "../../core/sugar.js";
import { distill, verifiable } from "../../extra/composite.js";

function tick(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("extra composite verifiable (roadmap §3.2b)", () => {
	it("runs verification from explicit trigger", () => {
		const source = state(2);
		const trigger = state(0);
		const bundle = verifiable(source, (value) => ({ holds: value > 0, checked: value }), {
			trigger,
			autoVerify: false,
		});

		expect(bundle.verified.cache).toEqual({ holds: true, checked: 2 });
		trigger.down([[DATA, 1]]);
		expect(bundle.verified.cache).toEqual({ holds: true, checked: 2 });
	});

	it("cancels stale verification with switchMap", async () => {
		const source = state(1);
		const trigger = state(0);
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
		const source = state(3);
		const bundle = verifiable(source, (value) => value * 10, { trigger: 0 as const });
		expect(bundle.trigger).not.toBe(null);
		expect(bundle.verified.cache).toBe(30);
	});

	it("stamps sourceVersion meta when source node has V0", () => {
		const source = state(2, { versioning: 0 });
		const trigger = state(0);
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
});

describe("extra composite distill (roadmap §3.2b)", () => {
	it("extracts memories and builds compact view", () => {
		const source = state("alpha");
		const bundle = distill(
			source,
			(rawNode) =>
				derived([rawNode], ([raw]) => ({
					upsert: [{ key: raw, value: { text: raw, points: raw.length } }],
				})),
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
		const source = state("x");
		const evictToggle = state(false);
		const bundle = distill(
			source,
			(rawNode) =>
				derived([rawNode], ([raw]) => ({ upsert: [{ key: raw, value: { text: raw } }] })),
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
		const source = state("seed");
		const consolidateTrigger = state(false);
		const bundle = distill(
			source,
			(rawNode) =>
				derived([rawNode], ([raw]) => ({
					upsert: [{ key: raw, value: { text: raw, points: raw.length } }],
				})),
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
		const source = state("seed");
		const bundle = distill(
			source,
			(rawNode) =>
				derived([rawNode], ([raw]) => ({
					upsert: [{ key: raw, value: { text: raw, points: raw.length } }],
				})),
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
		const source = state("x");
		const bundle = distill(
			source,
			(rawNode) =>
				derived([rawNode], ([raw]) => ({ upsert: [{ key: raw, value: { text: raw } }] })),
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

	it("throws when extraction omits upsert", () => {
		const source = state("seed");
		const bundle = distill(
			source,
			(rawNode) =>
				derived([rawNode], ([raw]) =>
					raw === "seed"
						? { upsert: [{ key: raw, value: { text: raw } }] }
						: ({
								remove: ["seed"],
							} as unknown as {
								upsert: Array<{ key: string; value: { text: string } }>;
							}),
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
