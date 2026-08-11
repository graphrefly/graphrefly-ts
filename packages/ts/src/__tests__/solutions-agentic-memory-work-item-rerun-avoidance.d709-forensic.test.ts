import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	D709_PRIVATE_GENERATION_REF,
	D709_PRIVATE_PERSISTENCE_ROOT,
	type D709D708ArtifactBytesV1,
	persistD709PrivateGeneration,
	validateD709D708ArtifactBytes,
	validateD709QualifiedArtifactBytes,
} from "../../evals/empirical-memory-rerun-avoidance/d709-untyped-http-429-forensic.js";

const d708Root = join(
	D709_PRIVATE_PERSISTENCE_ROOT,
	"d708-d707-fresh-pricing-separated-replacement-2026-08-09-v1",
);
const d708ClaimRoot = join(
	D709_PRIVATE_PERSISTENCE_ROOT,
	".d708-d707-fresh-pricing-separated-replacement-2026-08-09-v1",
);
const hasExactD708 = existsSync(join(d708Root, "fresh-pricing-live-observation.v1.json"));

function sourceArtifacts(): D709D708ArtifactBytesV1 {
	return {
		observationBytes: new Uint8Array(
			readFileSync(join(d708Root, "fresh-pricing-live-observation.v1.json")),
		),
		scorecardBytes: new Uint8Array(
			readFileSync(join(d708Root, "fresh-pricing-live-scorecard.v1.json")),
		),
		generationBytes: new Uint8Array(readFileSync(join(d708Root, "generation.v1.json"))),
		terminalReceiptBytes: new Uint8Array(
			readFileSync(join(d708ClaimRoot, "terminal-attempt.v1.json")),
		),
	};
}

describe.skipIf(!hasExactD708)("retired D709 exact-D708 forensic artifacts", () => {
	it("rejects the retired route under the current single active route", () => {
		expect(() => validateD709D708ArtifactBytes(sourceArtifacts())).toThrow();
	});

	it("rejects tamper and accessors before deriving forensic claims", () => {
		const tampered = sourceArtifacts();
		tampered.observationBytes = tampered.observationBytes.slice();
		tampered.observationBytes[0] ^= 1;
		expect(() => validateD709D708ArtifactBytes(tampered)).toThrow();
		let getterHits = 0;
		const accessor = Object.defineProperty({}, "observationBytes", {
			enumerable: true,
			get() {
				getterHits += 1;
				return sourceArtifacts().observationBytes;
			},
		});
		expect(() => validateD709D708ArtifactBytes(accessor)).toThrow();
		expect(getterHits).toBe(0);
	});

	it("keeps duplicate persistence fail-closed without staging residue", async () => {
		const finalPath = join(D709_PRIVATE_PERSISTENCE_ROOT, D709_PRIVATE_GENERATION_REF);
		if (!existsSync(finalPath)) return;
		const before = readdirSync(D709_PRIVATE_PERSISTENCE_ROOT).filter((entry) =>
			entry.startsWith(".d709-staging-"),
		);
		await expect(
			persistD709PrivateGeneration({
				privateRoot: D709_PRIVATE_PERSISTENCE_ROOT,
				generationRef: D709_PRIVATE_GENERATION_REF,
				sourceArtifacts: sourceArtifacts(),
			}),
		).rejects.toThrow();
		expect(
			readdirSync(D709_PRIVATE_PERSISTENCE_ROOT).filter((entry) =>
				entry.startsWith(".d709-staging-"),
			),
		).toEqual(before);
	});

	it("replays the exact canonical private generation without provider work", () => {
		const finalPath = join(D709_PRIVATE_PERSISTENCE_ROOT, D709_PRIVATE_GENERATION_REF);
		if (!existsSync(finalPath)) return;
		expect(() =>
			validateD709QualifiedArtifactBytes({
				sourceArtifacts: sourceArtifacts(),
				qualifiedArtifacts: {
					forensicBytes: new Uint8Array(
						readFileSync(join(finalPath, "untyped-http-429-before-treatment-forensic.v1.json")),
					),
					scorecardBytes: new Uint8Array(
						readFileSync(
							join(finalPath, "untyped-http-429-before-treatment-forensic-scorecard.v1.json"),
						),
					),
					generationBytes: new Uint8Array(readFileSync(join(finalPath, "generation.v1.json"))),
				},
			}),
		).toThrow();
	});
});
