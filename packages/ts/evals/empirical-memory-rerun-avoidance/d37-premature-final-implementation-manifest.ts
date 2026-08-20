import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D37_IMPLEMENTATION_FILES = Object.freeze({
	graphAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d5-graph-native-eval-authority.ts",
	providerAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.ts",
	providerRejection:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d9-current-provider-rejection-authority.ts",
	phaseAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-admission.ts",
	retainedAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-mutation-authority.ts",
	retainedWire: "packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-chat-wire.ts",
	realProviderComposition:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d35-retained-span-real-provider-composition.ts",
	liveCoordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.ts",
	openRouterAdapter:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.ts",
	taskExposure:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d21-current-efficacy-recovery-authority.ts",
	d36BaselineCoordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d36-retained-span-live-coordinates.ts",
	d36BaselineValidator:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d36-retained-span-live.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d37-premature-final-qualification.ts",
	runner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d37-premature-final-no-network.ts",
	privatePersistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
	canonical: "packages/ts/evals/empirical-memory-rerun-avoidance/canonical.ts",
	strictJsonCodec: "packages/ts/src/json/codec.ts",
} as const);

export const D37_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	graphAuthority: "sha256:8df6a06042657d5cadb5666a5b9cd96b9e69812a46dd42e820cb8383ea090bfb",
	providerAuthority: "sha256:c61d1546053ab58dced37c5ab48b55149cb062c3935cfbd754a47da992d2da2c",
	providerRejection: "sha256:8a103954abbdca96600935a77e710f8a40b628025c282a431a9de1a9dab1cbc8",
	phaseAuthority: "sha256:daa386952ebee402fc618e1add189385b3a85de81f4fd9183dca5b12e0c86cba",
	retainedAuthority: "sha256:fbefb5fc1298e4e919d91c102116e25653ee39d76a5245053abdf5650a9fb87c",
	retainedWire: "sha256:55894461e6c77260f8767a6bb5540042131ac859d2a4b437ab5e6d9acc97ac3d",
	realProviderComposition:
		"sha256:b163b4eb3964c67c7d8e543ba4c86af6d23ad6fab6a55605d99edd38d9b06a7f",
	liveCoordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	openRouterAdapter: "sha256:ad7a8740eec6ad2c3eea1d61574342c70d9c34e64314e01eae7cdd01e650f0b2",
	taskExposure: "sha256:60c3462b86c592365166b5919e25d75fbf4659352710c4aea12e2f03d6db4542",
	d36BaselineCoordinates: "sha256:832267bfa10f9a1b57ea0acfc47a7e3044309200e23dd7b5eb07930631802933",
	d36BaselineValidator: "sha256:a0008cff1c250073af86ae92decb17354ab27031cdbe30a680443b50fceda3fc",
	qualification: "sha256:82be3894db0f80003cde9ddb5196123e606fb69143715b0d9d00cc34930d0023",
	runner: "sha256:81573ce95efd4145de43ca0e94e88cc4044f5776d78214b76a45e584a3154c8b",
	privatePersistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	strictJsonCodec: "sha256:7fadd889fa5ca55b83a812e67462a48873c50e67d4b9451e7f361e1af8a44ffa",
} as const);

export const D37_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d37.premature-final-implementation-manifest.v6",
	d36FailureBaselineArtifactDigest:
		"sha256:746a95fa384d7b3efa4178666a4e74fef862b3b07cbdb423b40223916c3806c4",
	sources: D37_IMPLEMENTATION_SOURCE_DIGESTS,
});
export const D37_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D37_IMPLEMENTATION_MANIFEST,
);

export async function measureD37Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = await realpath(resolve(repositoryRootValue));
	const measured: Record<string, string> = {};
	for (const [name, path] of Object.entries(D37_IMPLEMENTATION_FILES))
		measured[name] = empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path))));
	for (const [name, expected] of Object.entries(D37_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[name] !== expected)
			throw new TypeError(`D37 implementation source drifted: ${name}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({
			revision: D37_IMPLEMENTATION_MANIFEST.revision,
			d36FailureBaselineArtifactDigest:
				D37_IMPLEMENTATION_MANIFEST.d36FailureBaselineArtifactDigest,
			sources: measured,
		}),
	);
}
