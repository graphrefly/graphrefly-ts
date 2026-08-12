import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
	D757_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD757Implementation,
} from "./d757-implementation-manifest.js";
import {
	D757_GENERATION_REF,
	persistD757NamedToolPreLiveBundle,
	runD757InjectedNoNetworkQualification,
	validateD757NamedToolPreLiveBundle,
} from "./d757-named-tool-pre-live.js";

const privateRoot = join(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/.d757-pre-live",
);
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const rootStat = await lstat(privateRoot);
if (
	!rootStat.isDirectory() ||
	rootStat.isSymbolicLink() ||
	(rootStat.mode & 0o777) !== 0o700 ||
	(await realpath(privateRoot)) !== privateRoot
)
	throw new TypeError("D757 private qualification root is invalid");
if ((await measureD757Implementation()) !== D757_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D757 implementation manifest validation failed");
const bundle = await runD757InjectedNoNetworkQualification();
validateD757NamedToolPreLiveBundle(bundle);
const persistence = await persistD757NamedToolPreLiveBundle({ privateRoot, bundle });
process.stdout.write(
	`${JSON.stringify({
		status: "qualified",
		generationRef: D757_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		persistenceDigest: persistence.persistenceDigest,
		providerNetworkCalls: 0,
	})}\n`,
);
