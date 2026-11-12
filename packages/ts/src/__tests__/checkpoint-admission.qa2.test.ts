import { describe, expect, it, vi } from "vitest";
import { type GraphCheckpoint, type GraphCheckpointNode, graph, restoreGraph } from "../index.js";

const remove = (object: object, key: string) => {
	delete (object as Record<string, unknown>)[key];
};
function capture() {
	const g = graph();
	const source = g.state({ n: 1 }, { name: "source" });
	g.node([], () => {}, { name: "first", recipe: { ref: "r" } });
	const node = g.node([source], (ctx) => ctx.emit(ctx.deps[0].value), {
		name: "n",
		quiet: true,
		complete: "manual",
		error: "manual",
		invalidate: "manual",
		recipe: { ref: "r", config: { n: 1 } },
	});
	const stop = g.retain(node);
	const cp = g.checkpoint();
	stop();
	return cp;
}
const savedNode = (cp: GraphCheckpoint) => cp.nodes.find((n) => n.id === "n")!;
const defects: [string, (node: GraphCheckpointNode) => void][] = [
	...["factory", "deps", "values", "terminal", "policies", "lifetime"].map(
		(key): [string, (node: GraphCheckpointNode) => void] => [
			`missing ${key}`,
			(node) => remove(node, key),
		],
	),
	...["quiet", "complete", "error", "invalidate"].map(
		(key): [string, (node: GraphCheckpointNode) => void] => [
			`missing policy ${key}`,
			(node) => remove(node.policies!, key),
		],
	),
	[
		"bad quiet",
		(n) => {
			n.policies!.quiet = "true" as never;
		},
	],
	[
		"bad complete",
		(n) => {
			n.policies!.complete = "later" as never;
		},
	],
	[
		"bad error",
		(n) => {
			n.policies!.error = false as never;
		},
	],
	[
		"bad invalidate",
		(n) => {
			n.policies!.invalidate = null as never;
		},
	],
	[
		"bad kind",
		(n) => {
			n.kind = "other" as never;
		},
	],
	[
		"bad terminal tag",
		(n) => {
			n.terminal = { kind: "DATA" } as never;
		},
	],
	[
		"missing ERROR argument",
		(n) => {
			n.terminal = { kind: "ERROR" } as never;
		},
	],
	[
		"extra COMPLETE argument",
		(n) => {
			n.terminal = { kind: "COMPLETE", error: 3 } as never;
		},
	],
	[
		"false lifetime",
		(n) => {
			n.lifetime = false as never;
		},
	],
	["missing received", (n) => remove(n.lifetime!, "received")],
	["missing received values", (n) => remove(n.lifetime!.received[0], "values")],
	["missing received terminal", (n) => remove(n.lifetime!.received[0], "terminal")],
	[
		"extra received terminal argument",
		(n) => {
			n.lifetime!.received[0].terminal = { kind: "none", error: 3 } as never;
		},
	],
	[
		"bad received length",
		(n) => {
			n.lifetime!.received = [];
		},
	],
	[
		"bad lifetime dependency",
		(n) => {
			n.lifetime!.deps = [4] as never;
		},
	],
	[
		"missing dependency",
		(n) => {
			n.deps = ["absent"];
		},
	],
	[
		"dependency cycle",
		(n) => {
			n.deps = ["n"];
		},
	],
];

describe("QA2 complete checkpoint admission before factory effects", () => {
	it.each(defects)("rejects %s in a real capture before any factory callback", (_label, damage) => {
		const cp = capture();
		damage(savedNode(cp));
		const validateConfig = vi.fn((value) => value),
			build = vi.fn(() => ({ fn: () => {} }));
		expect(() =>
			restoreGraph(cp, { registry: { r: { ref: "r", validateConfig, build } } }),
		).toThrow(/not restorable: n:/);
		expect(validateConfig).not.toHaveBeenCalled();
		expect(build).not.toHaveBeenCalled();
	});
	it("rejects duplicate ids and invalid mounted input before root factory callbacks", () => {
		for (const variant of ["duplicate", "mounted"] as const) {
			const cp = capture();
			if (variant === "duplicate") cp.nodes.push(structuredClone(cp.nodes[0]));
			else {
				const child = capture();
				remove(savedNode(child).policies!, "quiet");
				cp.mounts = [{ at: "child", checkpoint: child }];
			}
			const validateConfig = vi.fn((value) => value),
				build = vi.fn(() => ({ fn: () => {} }));
			expect(() =>
				restoreGraph(cp, { registry: { r: { ref: "r", validateConfig, build } } }),
			).toThrow();
			expect(validateConfig).not.toHaveBeenCalled();
			expect(build).not.toHaveBeenCalled();
		}
	});
	it("accepts explicit cold null while preserving every captured policy", () => {
		const cp = capture();
		const restored = restoreGraph(cp, {
			registry: { r: { ref: "r", build: () => ({ fn: () => {} }) } },
		});
		expect(restored.checkpoint().nodes.find((n) => n.id === "first")!.lifetime).toBeNull();
		expect(savedNode(restored.checkpoint()).policies).toEqual(savedNode(cp).policies);
	});
});

describe("QA2 restored JSON ownership", () => {
	it("detaches retained values and recipe config for every restore", () => {
		const cp = capture();
		const configs: { n: number }[] = [];
		const registry = {
			r: {
				ref: "r",
				build: (config: unknown) => {
					if (config !== undefined) configs.push(config as { n: number });
					return { fn: () => {} };
				},
			},
		};
		const a = restoreGraph(cp, { registry }),
			b = restoreGraph(cp, { registry });
		(a.find("source")!.cache as { n: number }).n = 9;
		(a.find("n")!.cache as { n: number }).n = 8;
		configs[0].n = 7;
		expect(b.find("source")!.cache).toEqual({ n: 1 });
		expect(b.find("n")!.cache).toEqual({ n: 1 });
		expect(cp.nodes.find((n) => n.id === "source")!.values).toEqual([{ n: 1 }]);
		expect(savedNode(cp).values).toEqual([{ n: 1 }]);
		expect(savedNode(cp).recipe!.config).toEqual({ n: 1 });
		expect(configs[1]).toEqual({ n: 1 });
	});
	it("detaches received records before the restored first-activation comparison", () => {
		const cp = capture();
		const fn = vi.fn();
		const registry = { r: { ref: "r", build: () => ({ fn }) } };
		const a = restoreGraph(cp, { registry }),
			b = restoreGraph(cp, { registry });
		(savedNode(cp).lifetime!.received[0].values[0] as { n: number }).n = 9;
		const sa = a.retain("n"),
			sb = b.retain("n");
		expect(fn).not.toHaveBeenCalled();
		expect(a.find("n")!.cache).toEqual({ n: 1 });
		expect(b.find("n")!.cache).toEqual({ n: 1 });
		sa();
		sb();
	});
	it("detaches ERROR payloads from the input and other restored graphs", () => {
		const g = graph();
		const source = g.state(1, { name: "source" });
		source.error({ code: 1 });
		const cp = g.checkpoint();
		const a = restoreGraph(cp, { registry: {} }),
			b = restoreGraph(cp, { registry: {} });
		const sa = a.find("source")!.subscribe((messages) => {
			for (const m of messages) if (m[0] === "ERROR") (m[1] as { code: number }).code = 9;
		});
		const errors: unknown[] = [];
		const sb = b.find("source")!.subscribe((messages) => {
			for (const m of messages) if (m[0] === "ERROR") errors.push(m[1]);
		});
		expect(errors).toEqual([{ code: 1 }]);
		expect(cp.nodes[0].terminal).toEqual({ kind: "ERROR", error: { code: 1 } });
		sa();
		sb();
	});
});
