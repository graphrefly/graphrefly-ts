import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
	D759_GENERATION_REF,
	persistD759QualificationBundle,
	runD759InjectedNoNetworkQualification,
	validateD759QualificationBundle,
} from "./d759-hidden-verifier-correction-qualification.js";
import {
	D759_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD759Implementation,
} from "./d759-implementation-manifest.js";

const rootPath = join(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/.d759-pre-live",
);
await mkdir(rootPath, { recursive: true, mode: 0o700 });
await chmod(rootPath, 0o700);
const privateRoot = await realpath(rootPath);
const rootStat = await lstat(privateRoot);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
	throw new TypeError("D759 private qualification root is invalid");
if ((await measureD759Implementation()) !== D759_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D759 implementation manifest validation failed");
const bundle = await runD759InjectedNoNetworkQualification();
validateD759QualificationBundle(bundle);
if ((await measureD759Implementation()) !== D759_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D759 implementation changed during qualification");
const persistence = await persistD759QualificationBundle({ privateRoot, bundle });
process.stdout.write(
	`${JSON.stringify({
		status: "qualified",
		generationRef: D759_GENERATION_REF,
		implementationManifestDigest: D759_IMPLEMENTATION_MANIFEST_DIGEST,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		persistenceDigest: persistence.persistenceDigest,
		providerNetworkCalls: 0,
	})}\n`,
);
