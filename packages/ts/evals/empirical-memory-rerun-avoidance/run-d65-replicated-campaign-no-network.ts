import { resolve } from "node:path";
import {
	persistD65Qualification,
	runD65InjectedNoNetworkQualification,
} from "./d65-replicated-campaign-qualification.js";

const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d65-qualified",
);
const bundle = await runD65InjectedNoNetworkQualification();
const persistence = await persistD65Qualification({ privateRoot, bundle });
process.stdout.write(
	`${JSON.stringify({
		decisionRef: bundle.qualification.decisionRef,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		campaignEvidenceDigest: bundle.campaignEvidence.evidenceDigest,
		artifactDigest: persistence.artifactDigest,
		receiptDigest: persistence.receiptDigest,
		providerNetworkCalls: bundle.qualification.providerNetworkCalls,
		efficacyClaim: bundle.qualification.efficacyClaim,
	})}\n`,
);
