import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCpu } from "./analyze-spending-preset-cold.mjs";

const node = (id, name, children = []) => ({
	id,
	callFrame: { functionName: name, lineNumber: id, url: "fixture" },
	children,
});
test("the same allocation helper is construction only when graphArm is an ancestor", () => {
	const profile = {
		nodes: [
			node(1, "root", [2, 5, 7]),
			node(2, "graphArm", [3]),
			node(3, "node", [4]),
			node(4, "allocate"),
			node(5, "cleanup", [6]),
			node(6, "allocate"),
			node(7, "(garbage collector)"),
		],
		samples: [4, 4, 6, 7],
	};
	const r = analyzeCpu(profile);
	assert.equal(r.constructionSamples, 2);
	assert.equal(r.otherSamples, 2);
	assert.equal(r.own[0].frame, "allocate@5");
	assert.ok(!r.inclusive.some((x) => x.frame === "cleanup"));
});
test("unknown sample frame and cyclic parent graphs fail closed", () => {
	assert.throws(() => analyzeCpu({ nodes: [node(1, "graphArm")], samples: [2] }), /missing frame/);
	assert.throws(
		() => analyzeCpu({ nodes: [node(1, "graphArm", [2]), node(2, "helper", [1])], samples: [1] }),
		/cyclic/,
	);
});
