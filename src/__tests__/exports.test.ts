import { describe, expect, it } from "vitest";
import {
	core,
	DEFAULT_ACTOR,
	describeNode,
	extra,
	GuardDenied,
	graph,
	map,
	policy,
	version,
} from "../index.js";

describe("graphrefly", () => {
	it("exports version", () => {
		expect(version).toBe("0.0.0");
	});

	it("exports layer namespaces", () => {
		expect(typeof core).toBe("object");
		expect(typeof graph).toBe("object");
		expect(typeof extra).toBe("object");
		expect(typeof graph.Graph).toBe("function");
		expect(typeof map).toBe("function");
	});

	it("exports core sugar helpers", () => {
		expect(typeof core.state).toBe("function");
		expect(typeof core.producer).toBe("function");
		expect(typeof core.derived).toBe("function");
		expect(typeof core.effect).toBe("function");
		expect(typeof core.pipe).toBe("function");
	});

	it("exports describeNode for Graph.describe parity", () => {
		expect(typeof describeNode).toBe("function");
		expect(typeof core.describeNode).toBe("function");
	});

	it("exports actor and guard primitives", () => {
		expect(DEFAULT_ACTOR.type).toBe("system");
		expect(typeof policy).toBe("function");
		expect(GuardDenied.name).toBe("GuardDenied");
		const err = new GuardDenied({
			actor: DEFAULT_ACTOR,
			action: "write",
			nodeName: "n::x",
		});
		expect(err.node).toBe("n::x");
		expect(err.nodeName).toBe("n::x");
	});
});
