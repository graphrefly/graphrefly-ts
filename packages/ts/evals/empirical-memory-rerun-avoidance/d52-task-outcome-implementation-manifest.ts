import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D52_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:6a3448d208e2df31d05b78d92c26336f59d6414254e233e65be8c58a454ea513",
	toolAuthority: "sha256:21d3c01e0fe14617e331666ba7a24a874764497cb772a8cdbd2f60ad592adc09",
	providerAdapter: "sha256:7ac371036c82cba6a7f74867f4e02936b3223dbc53102e83871b003e3c909f41",
	taskQualification: "sha256:0e3eecf86eaac42f52fe31efe4ca08bff37e94a027f47c7067b1219391b7af64",
	localExecutor: "sha256:46b61099293f9b1f3c0aca4fd8a2f963a0a57a4a863885b43ba07103c2192cb8",
	semanticScenarios: "sha256:c105af727adba7dd53ca5c33f9ddc640a17beda58342f314d5a05f817d8f92b1",
	semanticBundleEntry: "sha256:5fec8f81a967301f18e6be18ebc0dedef29ef12cf5eaa29eeae9b0a49a258d19",
	boundedAuthority: "sha256:f60ee377465afa3824d4f4d93e20c687d3e25851ad15a76c3b28262bb641d2c3",
	composition: "sha256:5086a21ec598a74a0803ad600a32fd6b74697e7f968f425e1cfa8abc3cea4893",
	fullSixArmQualification:
		"sha256:373b90d54f4d5af0caf4e5325bdec06e298b772e477eaa87fb1d226ae91f49b2",
	taskOutcomeQualification:
		"sha256:e89d8fe3146e1ff7eac7a5ed3d3e40962e93949d3195644755a63d3d2bcf7a2c",
	qualificationRunner: "sha256:4f281eb3bfa272b777761d19b46a1ad754899eb39dcf2467132609c6b1a017cf",
	test: "sha256:9b08812385691fab78708f2cb9d05f68a08093b39919e6d75cab105d450fa709",
});

export const D52_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d61.task-outcome-implementation-manifest.v1",
	sources: D52_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD52Implementation(): Promise<string> {
	const measured = Object.freeze({
		policy: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-model-harness-policy.ts")),
		),
		lifecycleAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-graph-harness-authority.ts")),
		),
		toolAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-authority.ts")),
		),
		providerAdapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-mechanical-chat-adapter.ts")),
		),
		taskQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
		localExecutor: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-composition.ts")),
		),
		semanticScenarios: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-public-semantic-scenarios.ts")),
		),
		semanticBundleEntry: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-public-semantic-bundle-entry.ts")),
		),
		boundedAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-authority.ts")),
		),
		composition: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-composition.ts")),
		),
		fullSixArmQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-qualification.ts")),
		),
		taskOutcomeQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d52-task-outcome-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d52-task-outcome-qualification.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d52-task-outcome.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D52_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D52 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d61.task-outcome-implementation-manifest.v1",
		sources: measured,
	});
}
