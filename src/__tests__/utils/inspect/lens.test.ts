import { DATA, describeNode, node } from "@graphrefly/pure-ts/core";
import type { LensFlowChange } from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph";
import { describe, expect, it } from "vitest";
import { type FlowEntry, graphLens, type HealthReport } from "../../../utils/inspect/lens.js";

function getLogCache(n: { cache: unknown }): readonly LensFlowChange[] {
	return (n.cache ?? []) as readonly LensFlowChange[];
}

function getHealthCache(node: { cache: unknown }): HealthReport {
	return node.cache as HealthReport;
}
function getFlowCache(node: { cache: unknown }): ReadonlyMap<string, FlowEntry> {
	return (node.cache ?? new Map<string, FlowEntry>()) as ReadonlyMap<string, FlowEntry>;
}

describe("graphLens — topology", () => {
	it("topology is a live describe of the target", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 0 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const lens = graphLens(g);
		try {
			lens.topology.subscribe(() => {});
			const desc = lens.topology.cache as { nodes: Record<string, unknown> };
			expect(Object.keys(desc.nodes).sort()).toEqual(["a", "b"]);
		} finally {
			lens.dispose();
		}
	});

	it("topology re-emits when a node is added to the target", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 0 }), { name: "a" });
		const lens = graphLens(g);

		try {
			const seen: number[] = [];
			lens.topology.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						const desc = m[1] as { nodes: Record<string, unknown> };
						seen.push(Object.keys(desc.nodes).length);
					}
				}
			});
			expect(seen.at(-1)).toBe(1);

			g.add(node([], { name: "b", initial: 1 }), { name: "b" });
			expect(seen.at(-1)).toBe(2);
		} finally {
			lens.dispose();
		}
	});

	it("topology covers transitively-mounted subgraphs", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 0 }), { name: "a" });
		const child = new Graph("child");
		child.add(node([], { name: "x", initial: 1 }), { name: "x" });
		g.mount("kids", child);

		const lens = graphLens(g);
		try {
			lens.topology.subscribe(() => {});
			const desc = lens.topology.cache as { nodes: Record<string, unknown> };
			expect(Object.keys(desc.nodes).sort()).toEqual(["a", "kids::x"]);
		} finally {
			lens.dispose();
		}
	});
});

describe("graphLens — health", () => {
	it("ok=true when no nodes are errored", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 0 }), { name: "a" });
		const lens = graphLens(g);
		try {
			lens.health.subscribe(() => {});
			expect(getHealthCache(lens.health).ok).toBe(true);
			expect(getHealthCache(lens.health).problems).toHaveLength(0);
		} finally {
			lens.dispose();
		}
	});

	it("flips to ok=false with a problem entry when a node errors", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 0 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				if ((data[0] as number) < 0) throw new Error("negative");
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const lens = graphLens(g);
		try {
			lens.health.subscribe(() => {});
			expect(getHealthCache(lens.health).ok).toBe(true);

			a.emit(-1); // triggers b's fn to throw → b errors
			const report = getHealthCache(lens.health);
			expect(report.ok).toBe(false);
			expect(report.problems).toHaveLength(1);
			expect(report.problems[0]?.path).toBe("b");
			expect(report.problems[0]?.status).toBe("errored");
		} finally {
			lens.dispose();
		}
	});

	it("sets upstreamCause when the error originates upstream", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 0 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				if ((data[0] as number) < 0) throw new Error("from b");
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived", name: "b" },
		);
		const c = node(
			[b],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "c" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(c, { name: "c" });

		const lens = graphLens(g);
		try {
			lens.health.subscribe(() => {});
			a.emit(-1);
			const report = getHealthCache(lens.health);
			expect(report.ok).toBe(false);
			const cProblem = report.problems.find((p) => p.path === "c");
			expect(cProblem?.upstreamCause).toBe("b");
		} finally {
			lens.dispose();
		}
	});
});

describe("graphLens — flow", () => {
	it("counts DATA emissions per qualified path", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 0 });
		g.add(a, { name: "a" });

		const lens = graphLens(g);
		try {
			lens.flow.subscribe(() => {});
			a.emit(1);
			a.emit(2);
			a.emit(3);

			const map = getFlowCache(lens.flow);
			const entry = map.get("a");
			// Initial subscription state push counts as a data event too — assert
			// the counter is monotonic and ≥ 3.
			expect(entry?.count).toBeGreaterThanOrEqual(3);
			expect(entry?.lastUpdate_ns).not.toBeNull();
		} finally {
			lens.dispose();
		}
	});

	it("uses qualified path keys for transitively-mounted nodes", () => {
		const g = new Graph("g");
		const child = new Graph("child");
		g.mount("kids", child);
		child.add(node([], { name: "x", initial: 0 }), { name: "x" });

		const lens = graphLens(g);
		try {
			lens.flow.subscribe(() => {});
			child.set("x", 1);
			const map = getFlowCache(lens.flow);
			expect(map.has("kids::x")).toBe(true);
			expect(map.has("x")).toBe(false);
		} finally {
			lens.dispose();
		}
	});

	it("reconciles entries when a node is removed from the target", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 0 }), { name: "a" });
		g.add(node([], { name: "b", initial: 0 }), { name: "b" });

		const lens = graphLens(g);
		try {
			lens.flow.subscribe(() => {});
			g.set("a", 1);
			g.set("b", 1);
			expect(getFlowCache(lens.flow).has("b")).toBe(true);

			g.remove("b");
			expect(getFlowCache(lens.flow).has("b")).toBe(false);
		} finally {
			lens.dispose();
		}
	});

	it("emits a fresh map snapshot on each settle (no in-place mutation)", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 0 });
		g.add(a, { name: "a" });

		const lens = graphLens(g);
		try {
			const snapshots: ReadonlyMap<string, FlowEntry>[] = [];
			lens.flow.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) snapshots.push(m[1] as ReadonlyMap<string, FlowEntry>);
				}
			});
			a.emit(1);
			a.emit(2);

			// Each emission should produce a distinct map reference.
			expect(snapshots.length).toBeGreaterThan(1);
			const distinct = new Set(snapshots).size;
			expect(distinct).toBe(snapshots.length);
		} finally {
			lens.dispose();
		}
	});
});

describe("graphLens — flowMutations (delta companion)", () => {
	it("is absent by default (zero overhead, off)", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 0 }), { name: "a" });
		const lens = graphLens(g);
		try {
			expect(lens.flowMutations).toBeUndefined();
			// `flow` still works with the companion disabled.
			lens.flow.subscribe(() => {});
			g.set("a", 1);
			expect(getFlowCache(lens.flow).get("a")?.count).toBeGreaterThanOrEqual(1);
		} finally {
			lens.dispose();
		}
	});

	it("appends a typed tick LensFlowChange per per-path DATA emission", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 0 });
		g.add(a, { name: "a" });

		const lens = graphLens(g, { mutations: true });
		try {
			expect(lens.flowMutations).toBeDefined();
			lens.flow.subscribe(() => {});
			lens.flowMutations!.entries.subscribe(() => {});
			a.emit(1);
			a.emit(2);

			const log = getLogCache(lens.flowMutations!.entries);
			const ticks = log.filter((c) => c.change.kind === "tick");
			expect(ticks.length).toBeGreaterThanOrEqual(2);
			for (const rec of ticks) {
				expect(rec.structure).toBe("lensFlow");
				expect(rec.lifecycle).toBe("data");
				expect(typeof rec.t_ns).toBe("number");
				if (rec.change.kind === "tick") expect(rec.change.path).toBe("a");
			}
			// `version` is strictly monotonic across the companion.
			const versions = log.map((c) => c.version as number);
			for (let i = 1; i < versions.length; i++) {
				expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
			}
			// tick `count` mirrors the snapshot counter for the same path.
			const lastTick = [...ticks].reverse().find((c) => c.change.kind === "tick");
			if (lastTick?.change.kind === "tick") {
				expect(lastTick.change.count).toBe(getFlowCache(lens.flow).get("a")?.count);
			}
		} finally {
			lens.dispose();
		}
	});

	it("appends an evict LensFlowChange when a tracked path drops from topology", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 0 }), { name: "a" });
		g.add(node([], { name: "b", initial: 0 }), { name: "b" });

		const lens = graphLens(g, { mutations: true });
		try {
			lens.flow.subscribe(() => {});
			lens.flowMutations!.entries.subscribe(() => {});
			g.set("a", 1);
			g.set("b", 1);
			expect(getFlowCache(lens.flow).has("b")).toBe(true);

			g.remove("b");
			expect(getFlowCache(lens.flow).has("b")).toBe(false);

			const evicts = getLogCache(lens.flowMutations!.entries).filter(
				(c) => c.change.kind === "evict",
			);
			expect(evicts.some((c) => c.change.kind === "evict" && c.change.path === "b")).toBe(true);
		} finally {
			lens.dispose();
		}
	});

	it("honors a bounded maxSize on the companion log", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 0 });
		g.add(a, { name: "a" });

		const lens = graphLens(g, { mutations: { maxSize: 2 } });
		try {
			lens.flow.subscribe(() => {});
			lens.flowMutations!.entries.subscribe(() => {});
			for (let i = 1; i <= 6; i++) a.emit(i);
			expect(getLogCache(lens.flowMutations!.entries).length).toBeLessThanOrEqual(2);
		} finally {
			lens.dispose();
		}
	});

	it("captures the initial tick even when the lens is built over already-cached state (QA-P1)", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 0 });
		g.add(a, { name: "a" });
		// Drive emissions BEFORE the lens exists so describe/observe have
		// cached changesets — pre-fix `keepalive(flow)` ran before the
		// drain was wired, so this activation's deltas were collapsed into
		// the drain's first flush. Post-fix the drain is subscribed first.
		a.emit(1);
		a.emit(2);

		const lens = graphLens(g, { mutations: true });
		try {
			lens.flow.subscribe(() => {});
			lens.flowMutations!.entries.subscribe(() => {});
			a.emit(3);

			const ticks = getLogCache(lens.flowMutations!.entries).filter(
				(c) => c.change.kind === "tick",
			);
			// At least the post-construction tick is present and its count
			// mirrors the live snapshot counter (no collapse/loss).
			expect(ticks.length).toBeGreaterThanOrEqual(1);
			const last = [...ticks].reverse().find((c) => c.change.kind === "tick");
			if (last?.change.kind === "tick") {
				expect(last.change.count).toBe(getFlowCache(lens.flow).get("a")?.count);
			}
		} finally {
			lens.dispose();
		}
	});

	it("stops appending + is idempotent after dispose() even with flow kept warm (QA-P2/P3)", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 0 });
		g.add(a, { name: "a" });

		const lens = graphLens(g, { mutations: true });
		// External subscriber keeps `flow` warm past dispose().
		const stop = lens.flow.subscribe(() => {});
		lens.flowMutations!.entries.subscribe(() => {});
		a.emit(1);
		a.emit(2);
		const beforeDispose = getLogCache(lens.flowMutations!.entries).length;
		expect(beforeDispose).toBeGreaterThan(0);

		lens.dispose();
		// Idempotent — second dispose must not throw.
		expect(() => lens.dispose()).not.toThrow();

		// `flow` is still warm (stop not called) — drive more activity.
		a.emit(3);
		a.emit(4);
		// QA-P3: buffer push is gated on !disposed → no new records.
		expect(getLogCache(lens.flowMutations!.entries).length).toBe(beforeDispose);

		stop();
	});
});

describe("graphLens — domain meta tagging", () => {
	it("tags the health and flow deriveds with lens_type metadata", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 0 }), { name: "a" });
		const lens = graphLens(g);
		try {
			const healthMeta = describeNode(lens.health).meta;
			expect(healthMeta?.lens).toBe(true);
			expect(healthMeta?.lens_type).toBe("health");
			const flowMeta = describeNode(lens.flow).meta;
			expect(flowMeta?.lens).toBe(true);
			expect(flowMeta?.lens_type).toBe("flow");
		} finally {
			lens.dispose();
		}
	});
});

describe("graphLens — lifecycle", () => {
	it("dispose tears down the topology subscription cleanly", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 0 }), { name: "a" });
		const lens = graphLens(g);
		lens.topology.subscribe(() => {});
		lens.health.subscribe(() => {});
		lens.flow.subscribe(() => {});
		// Just call dispose — if a handler leaked it would throw or corrupt later asserts.
		lens.dispose();
		// Idempotent — second dispose is a no-op.
		expect(() => lens.dispose()).not.toThrow();
		// Mutate after dispose; lens should not react (no assertion beyond "no crash").
		g.add(node([], { initial: 1 }), { name: "b" });
		g.set("a", 99);
	});
});
