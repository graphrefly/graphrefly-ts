import { chmod, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
	D43_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD43Implementation,
} from "./d43-graph-harness-implementation-manifest.js";
import {
	persistD43Qualification,
	runD43InjectedNoNetworkQualification,
} from "./d43-graph-harness-qualification.js";

if (process.env.OPENROUTER_API_KEY !== undefined)
	throw new TypeError("D43 no-network runner refuses provider credentials");

if ((await measureD43Implementation()) !== D43_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D43 implementation drifted before qualification");

const privateRoot = join(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d43",
);
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const canonicalPrivateRoot = await realpath(privateRoot);
const bundle = await runD43InjectedNoNetworkQualification();
if ((await measureD43Implementation()) !== D43_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D43 implementation drifted during qualification");
const persistence = await persistD43Qualification({
	privateRoot: canonicalPrivateRoot,
	bundle,
});

process.stdout.write(
	`${JSON.stringify({
		decisionRef: bundle.qualification.decisionRef,
		generationRef: persistence.generationRef,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		implementationManifestDigest: D43_IMPLEMENTATION_MANIFEST_DIGEST,
		policyDigest: bundle.qualification.policyDigest,
		planDigest: bundle.qualification.planDigest,
		mainFrozenGateWouldPass: bundle.qualification.mainFrozenGateWouldPass,
		allKnownFailureOutcomesObserved: bundle.qualification.allKnownFailureOutcomesObserved,
		providerNetworkCalls: bundle.qualification.providerNetworkCalls,
		credentialReads: bundle.qualification.credentialReads,
		efficacyClaim: bundle.qualification.efficacyClaim,
		persistenceDigest: persistence.receiptDigest,
	})}\n`,
);
