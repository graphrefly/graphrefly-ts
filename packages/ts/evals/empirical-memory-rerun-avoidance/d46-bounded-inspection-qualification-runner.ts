import { resolve } from "node:path";
import {
	D46_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD46Implementation,
} from "./d46-bounded-inspection-implementation-manifest.js";
import {
	persistD46Qualification,
	runD46InjectedNoNetworkQualification,
	validateD46QualificationBundle,
} from "./d46-bounded-inspection-qualification.js";

const directory = process.argv[2];
if (directory === undefined) throw new TypeError("D46 qualification output directory is required");
const measured = await measureD46Implementation();
if (measured !== D46_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D46 qualification implementation manifest drifted");
const bundle = validateD46QualificationBundle(
	await runD46InjectedNoNetworkQualification({
		repositoryRoot: resolve(import.meta.dirname, "../../../.."),
	}),
);
const receipt = await persistD46Qualification({ directory: resolve(directory), bundle });
process.stdout.write(
	`${JSON.stringify({
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		evidenceDigest: bundle.evidence.evidenceDigest,
		implementationManifestDigest: measured,
		receipt,
	})}\n`,
);
