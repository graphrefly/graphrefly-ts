import { describe, expect, it } from "vitest";
import { core, extra, graph, version } from "../index.js";

describe("graphrefly", () => {
	it("exports version", () => {
		expect(version).toBe("0.0.0");
	});

	it("exports layer namespaces", () => {
		expect(typeof core).toBe("object");
		expect(typeof graph).toBe("object");
		expect(typeof extra).toBe("object");
	});
});
