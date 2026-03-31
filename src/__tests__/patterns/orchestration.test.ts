import { describe, expect, it } from "vitest";
import { DATA } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";
import { approval, branch, gate, pipeline, task } from "../../patterns/orchestration.js";

describe("patterns.orchestration", () => {
	it("pipeline creates a Graph container", () => {
		const g = pipeline("wf");
		expect(g).toBeInstanceOf(Graph);
		expect(g.name).toBe("wf");
	});

	it("task registers a computed step and wires dependency edges", () => {
		const g = pipeline("wf");
		const input = state(1);
		g.add("input", input);
		const doubled = task<number>(g, "double", ([v]) => ((v as number) * 2) as number, {
			deps: ["input"],
		});
		doubled.subscribe(() => undefined);
		g.set("input", 3);
		expect(g.get("double")).toBe(6);
		expect(g.edges()).toContainEqual(["input", "double"]);
	});

	it("task with Node deps still records explicit graph edges", () => {
		const g = pipeline("wf");
		const input = state(2);
		g.add("input", input);
		task<number>(g, "doubleByRef", ([v]) => ((v as number) * 2) as number, {
			deps: [input],
		});
		expect(g.edges()).toContainEqual(["input", "doubleByRef"]);
	});

	it("branch emits tagged branch results", () => {
		const g = pipeline("wf");
		const input = state(1);
		g.add("input", input);
		const out = branch<number>(g, "route", "input", (v) => v >= 2);
		const seen: Array<"then" | "else"> = [];
		out.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) {
					const payload = msg[1] as { branch: "then" | "else" };
					seen.push(payload.branch);
				}
			}
		});
		g.set("input", 2);
		expect(seen).toContain("else");
		expect(seen).toContain("then");
	});

	it("task and branch describe as derived with canonical orchestration metadata", () => {
		const g = pipeline("wf");
		const input = state(1);
		g.add("input", input);
		task<number>(g, "t", ([v]) => v as number, { deps: ["input"] });
		branch<number>(g, "b", "input", (v) => v > 0);
		const desc = g.describe();
		const tKey = Object.keys(desc.nodes).find((k) => k === "t" || k.endsWith("::t"));
		const bKey = Object.keys(desc.nodes).find((k) => k === "b" || k.endsWith("::b"));
		expect(tKey).toBeDefined();
		expect(bKey).toBeDefined();
		const tNode = desc.nodes[tKey as string];
		const bNode = desc.nodes[bKey as string];
		expect(tNode?.type).toBe("derived");
		expect(bNode?.type).toBe("derived");
		expect(tNode?.meta?.orchestration_type).toBe("task");
		expect(bNode?.meta?.orchestration_type).toBe("branch");
	});

	it("gate and approval hold value when control is false", () => {
		const g = pipeline("wf");
		const input = state(1);
		const open = state(true);
		const approved = state(true);
		g.add("input", input);
		g.add("open", open);
		g.add("approved", approved);
		const gated = gate<number>(g, "gated", "input", "open");
		const reviewed = approval<number>(g, "reviewed", gated, "approved");
		gated.subscribe(() => undefined);
		reviewed.subscribe(() => undefined);

		g.set("input", 2);
		expect(g.get("reviewed")).toBe(2);
		g.set("open", false);
		g.set("input", 3);
		expect(g.get("reviewed")).toBe(2);
		g.set("open", true);
		g.set("approved", false);
		g.set("input", 4);
		expect(g.get("reviewed")).toBe(3);
	});
});
