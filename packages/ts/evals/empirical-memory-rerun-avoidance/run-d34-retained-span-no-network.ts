import { chmod, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	D34_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD34Implementation,
} from "./d34-retained-span-implementation-manifest.js";
import {
	admitD34D33Baseline,
	persistD34Qualification,
	runD34InjectedNoNetworkQualification,
	validateD34QualificationBundle,
} from "./d34-retained-span-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d34",
);
const d33ArtifactPath = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d33/current-graph-native-phase-specific-live-2026-08-20-d33-v1/artifacts/bundle.v1.json",
);

if (process.env.OPENROUTER_API_KEY !== undefined)
	throw new TypeError("D34 no-network runner refuses provider credentials");
if (resolve(process.cwd()) !== repositoryRoot)
	throw new TypeError("D34 no-network runner must execute from the repository root");

await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
if ((await measureD34Implementation(repositoryRoot)) !== D34_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D34 implementation manifest drifted");
const baseline = admitD34D33Baseline(new Uint8Array(await readFile(d33ArtifactPath)));
const constructedBundle = await runD34InjectedNoNetworkQualification({ baseline });
const bundle = validateD34QualificationBundle(constructedBundle);
const receipt = await persistD34Qualification({ privateRoot, bundle: constructedBundle });

process.stdout.write(
	`${JSON.stringify(
		{
			decisionRef: bundle.qualification.decisionRef,
			bundleDigest: bundle.bundleDigest,
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
			evidenceDigest: bundle.evidence.evidenceDigest,
			providerNetworkCalls: bundle.qualification.providerNetworkCalls,
			retainedSpanCount: bundle.qualification.retainedSpanCount,
			acceptedNewTextCount: bundle.qualification.acceptedNewTextCount,
			cardinalityCorrectionCount: bundle.qualification.cardinalityCorrectionCount,
			efficacyClaim: bundle.qualification.efficacyClaim,
			receipt,
		},
		null,
		2,
	)}\n`,
);
