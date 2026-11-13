import { describe, expect, it } from "vitest";
import * as topology from "../graph/topology.js";
import { graph, map, restoreGraph } from "../index.js";

const refusal = "name must not contain '::'";

describe("R-naming@1 local name admission (D809)", () => {
	it("rejects mounted-address syntax before registering nodes or groups", () => {
		const g = graph();
		let runs = 0;
		for (const name of ["a::b", "::a", "a::", "a/b::c", "#a::b", "~a::b"]) {
			for (const create of [
				() => g.state(0, { name }),
				() =>
					g.node(
						[],
						() => {
							runs++;
						},
						{ name },
					),
				() =>
					g.derived(
						[],
						() => {
							runs++;
							return 1;
						},
						{ name },
					),
				() =>
					g.initNode(
						map((x: number) => x),
						[],
						{ name },
					),
				() => topology.group(g, { name }),
			])
				expect(create).toThrow(new Error(refusal));
		}
		expect(g.describe()).toEqual([]);
		expect(runs).toBe(0);
		for (const name of [":a", "a:", ":"]) {
			expect(() => g.state(1, { name })).toThrow(new Error("name must not start or end with ':'"));
			expect(() => topology.group(g, { name })).toThrow(
				new Error("name must not start or end with ':'"),
			);
		}
		const value = g.state(1, { name: "user-label.with/slash" });
		expect(g.find("user-label.with/slash")).toBe(value);
	});

	it("rejects a mount segment atomically and preserves nested mount lookup", () => {
		const root = graph(),
			child = graph(),
			leaf = graph();
		const value = leaf.state(1, { name: "module/value" });
		expect(() => topology.mount(root, child, "bad::path")).toThrow(new Error(refusal));
		for (const at of [":a", "a:", ":"])
			expect(() => topology.mount(root, child, at)).toThrow(
				new Error("name must not start or end with ':'"),
			);
		expect(root.checkpoint().mounts).toBeUndefined();
		topology.mount(child, leaf, "leaf");
		topology.mount(root, child, "ch:ild");
		expect(root.find("ch:ild::leaf::module/value")).toBe(value);
	});

	it("refuses every invalid local checkpoint name before recipe callbacks", () => {
		const g = graph();
		g.node([], () => {}, { name: "first", recipe: { ref: "first" } });
		g.state(1, { name: "later" });
		const child = graph();
		child.state(2, { name: "childValue" });
		topology.mount(g, child, "child");
		const checkpoint = g.checkpoint();
		let validations = 0,
			builds = 0;
		const registry = {
			first: {
				ref: "first",
				validateConfig: () => {
					validations++;
				},
				build: () => {
					builds++;
					return { fn: () => {} };
				},
			},
		};
		const checkRefusal = (invalid: typeof checkpoint, error: string) => {
			let thrown: unknown;
			try {
				restoreGraph(invalid, { registry });
			} catch (cause) {
				thrown = cause;
			}
			expect({ validations, builds }).toEqual({ validations: 0, builds: 0 });
			expect(thrown).toEqual(new Error(error));
		};
		for (const bad of ["bad::name", ":bad", "bad:", ":", "#bad::name"]) {
			const error = bad.includes("::") ? refusal : "name must not start or end with ':'";
			for (const field of ["id", "name"] as const) {
				const invalid = structuredClone(checkpoint);
				invalid.nodes.find((node) => node.id === "later")![field] = bad;
				checkRefusal(invalid, error);
			}
			const invalid = structuredClone(checkpoint);
			invalid.mounts![0]!.checkpoint.mounts = [{ at: bad, checkpoint: child.checkpoint() }];
			checkRefusal(invalid, error);
			expect({ validations, builds }).toEqual({ validations: 0, builds: 0 });
		}
		expect(restoreGraph(checkpoint, { registry }).find("first")).toBeDefined();
		expect({ validations, builds }).toEqual({ validations: 1, builds: 1 });
	});
});
