import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createD709UntypedHttp429Forensic,
	createD709UntypedHttp429ForensicScorecard,
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

describe.skipIf(!hasExactD708)("D709 exact D708 untyped-429 forensic", () => {
	it("derives only the frozen pre-treatment facts without an efficacy claim", () => {
		const source = sourceArtifacts();
		const validated = validateD709D708ArtifactBytes(source);
		const forensic = createD709UntypedHttp429Forensic(source);
		const scorecard = createD709UntypedHttp429ForensicScorecard(forensic, source);
		expect(validated.observation.observationDigest).toBe(
			forensic.sourceArtifacts.observationDigest,
		);
		expect(forensic).toMatchObject({
			terminalClassification: "untyped-http-429-before-treatment",
			firstTurnReadFileActions: 4,
			ordinaryContinuationRequestOrdinal: 2,
			d671RetryAdmission: false,
			d695ContinuationExposure: false,
			d702MutationFirstExposure: false,
			warmArmsAttempted: 0,
			warmArmsUnattempted: 5,
			costBasis: "conservative-reservation",
			confirmedProviderBilling: false,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(scorecard).toMatchObject({
			evaluablePairs: 0,
			treatmentExposures: 0,
			retryAdmissions: 0,
			status: "complete-pre-treatment-untyped-429-forensic",
		});
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
		).rejects.toThrow(/already exists/);
		expect(
			readdirSync(D709_PRIVATE_PERSISTENCE_ROOT).filter((entry) =>
				entry.startsWith(".d709-staging-"),
			),
		).toEqual(before);
	});

	it("replays the exact canonical private generation without provider work", () => {
		const finalPath = join(D709_PRIVATE_PERSISTENCE_ROOT, D709_PRIVATE_GENERATION_REF);
		if (!existsSync(finalPath)) return;
		expect(
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
		).toMatchObject({
			forensicDigest: expect.stringMatching(/^sha256:/),
			scorecardDigest: expect.stringMatching(/^sha256:/),
			generationDigest: expect.stringMatching(/^sha256:/),
		});
	});
});
