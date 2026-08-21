import { resolve } from "node:path";
import {
	D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD44D45LiveImplementation,
} from "./d44-d45-live-implementation-manifest.js";
import {
	persistD44D45Qualification,
	runD44D45InjectedNoNetworkQualification,
	validateD44D45QualificationBundle,
} from "./d44-d45-live-qualification.js";

const directory = process.argv[2];
if (directory === undefined) throw new TypeError("D44 qualification output directory is required");
const measured = await measureD44D45LiveImplementation();
if (measured !== D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D44 qualification implementation manifest drifted");
const bundle = validateD44D45QualificationBundle(await runD44D45InjectedNoNetworkQualification());
const receipt = await persistD44D45Qualification({ directory: resolve(directory), bundle });
process.stdout.write(
	`${JSON.stringify({
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		evidenceDigest: bundle.evidence.evidenceDigest,
		implementationManifestDigest: measured,
		receipt,
	})}\n`,
);
