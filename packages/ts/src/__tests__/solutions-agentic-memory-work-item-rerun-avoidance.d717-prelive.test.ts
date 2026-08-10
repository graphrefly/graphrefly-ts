import { describe, expect, it } from "vitest";
import { D714_D713_SOURCE_OBSERVATION_DIGEST } from "../../evals/empirical-memory-rerun-avoidance/d714-d715-graph-native-qualification.js";
import {
	createD717HistoricalBaselineReceipt,
	createD717InjectedHistoricalBaselineReceipt,
	D717_CLAIM_BOUNDARY,
	D717_OBSERVATION_SCHEMA,
	D717_SCORECARD_SCHEMA,
} from "../../evals/empirical-memory-rerun-avoidance/d717-graph-native-prelive.js";

describe("D717 Graph-native pre-live evidence boundary", () => {
	it("keeps injected fixture evidence distinct from exact historical artifact bytes", () => {
		const receipt = createD717InjectedHistoricalBaselineReceipt({
			sourceObservationDigest: D714_D713_SOURCE_OBSERVATION_DIGEST,
		});
		expect(receipt.evidenceClass).toBe("injected-source-digest-fixture");
		expect(D717_OBSERVATION_SCHEMA).toContain("d717.graph-native-live-provider-prelive");
		expect(D717_SCORECARD_SCHEMA).toContain("d717.graph-native-live-provider-prelive");
		expect(D717_CLAIM_BOUNDARY).toContain("injected-no-network");
	});

	it("rejects accessor or tampered historical artifact input before reading bytes", () => {
		let getterHits = 0;
		const accessorInput = {} as {
			observationBytes: Uint8Array;
			scorecardBytes: Uint8Array;
			generationBytes: Uint8Array;
		};
		for (const key of ["observationBytes", "scorecardBytes", "generationBytes"] as const) {
			Object.defineProperty(accessorInput, key, {
				enumerable: true,
				get() {
					getterHits += 1;
					return new Uint8Array([1]);
				},
			});
		}
		expect(() => createD717HistoricalBaselineReceipt(accessorInput)).toThrow(
			/own enumerable data property/,
		);
		expect(getterHits).toBe(0);
		expect(() =>
			createD717HistoricalBaselineReceipt({
				observationBytes: new Uint8Array([1]),
				scorecardBytes: new Uint8Array([2]),
				generationBytes: new Uint8Array([3]),
			}),
		).toThrow("exact D713 historical artifact bytes drifted");
	});
});
