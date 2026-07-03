import { describe, expect, it } from "vitest";
import { canonicalTupleKey, compoundTupleKey, parseCanonicalTupleKey } from "../identity.js";

describe("canonical tuple identity", () => {
	it("does not collide when coordinates contain old delimiter characters", () => {
		expect(canonicalTupleKey(["a:b", "c"])).not.toBe(canonicalTupleKey(["a", "b:c"]));
		expect(canonicalTupleKey(["a\0b", "c"])).not.toBe(canonicalTupleKey(["a", "b\0c"]));
	});

	it("round-trips string coordinates and rejects malformed tuples", () => {
		const key = canonicalTupleKey(["policy", "proposal"]);
		expect(key).toBe('["policy","proposal"]');
		expect(compoundTupleKey("admission", ["policy", "proposal"])).toBe(
			'admission:["policy","proposal"]',
		);
		expect(parseCanonicalTupleKey(key)).toEqual(["policy", "proposal"]);
		expect(parseCanonicalTupleKey("policy:proposal")).toBeUndefined();
		expect(parseCanonicalTupleKey('["ok",1]')).toBeUndefined();
		expect(parseCanonicalTupleKey('{"not":"a tuple"}')).toBeUndefined();
	});
});
