import { describe, expect, it } from "vitest";
import { core, describeNode, extra, graph, version } from "../index.js";

describe("graphrefly", () => {
	it("exports version", () => {
		expect(version).toBe("0.0.0");
	});

	it("exports layer namespaces", () => {
		expect(typeof core).toBe("object");
		expect(typeof graph).toBe("object");
		expect(typeof extra).toBe("object");
		expect(typeof graph.Graph).toBe("function");
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
});
