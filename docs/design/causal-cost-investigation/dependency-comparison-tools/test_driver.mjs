import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coordinates } from "./driver.mjs";

const original = readFileSync(
	new URL("../../../../scripts/causal-release-comparison-driver.mjs", import.meta.url),
	"utf8",
);
const current = readFileSync(new URL("./driver.mjs", import.meta.url), "utf8");
assert.equal(
	current.split("export function coordinates")[0],
	original.split("export function coordinates")[0],
);
const oldChild = readFileSync(
	new URL("../../../../scripts/causal-release-comparison-child.mjs", import.meta.url),
	"utf8",
);
assert.equal(
	readFileSync(new URL("./child.mjs", import.meta.url), "utf8"),
	oldChild.replace("./causal-release-comparison-driver.mjs", "./driver.mjs"),
);
for (const variant of ["U", "V"]) {
	const actual = coordinates(variant),
		expected = [];
	for (let position = 0; position < 2; position++)
		for (let index = 0; index < 70; index++)
			expected.push({
				block: 0,
				position,
				slot: (position + (variant === "V" ? 1 : 0)) % 2,
				index,
				phase: index < 20 ? "warmup" : "measured",
			});
	assert.deepEqual(actual, expected);
}
assert.throws(() => coordinates("bad"));
console.log(
	JSON.stringify({
		passed: true,
		unchangedSampleAndChildBodies: true,
		newCoordinates: 280,
		realConsumerExecutions: 0,
	}),
);
