import { chmod, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256 } from "./canonical.js";
import { validateD760LiveBundle } from "./d760-graph-native-live.js";
import {
	D761_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD761Implementation,
} from "./d761-implementation-manifest.js";
import {
	admitD761ConsumedD760Baseline,
	D761_D760_BUNDLE_ARTIFACT_SHA256,
	D761_GENERATION_REF,
	persistD761QualificationBundle,
	runD761InjectedNoNetworkQualification,
	validateD761QualificationBundle,
} from "./d761-public-semantic-validation-qualification.js";

const rootPath = join(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/.d761-pre-live",
);
const d760BundleBytes = new Uint8Array(
	await readFile(
		join(
			import.meta.dirname,
			"../.private/empirical-memory-rerun-avoidance/.d760-live-private/d760-graph-named-tool-live-2026-08-12-v1/artifacts/bundle.v1.json",
		),
	),
);
if (empiricalSha256(d760BundleBytes) !== D761_D760_BUNDLE_ARTIFACT_SHA256)
	throw new TypeError("D761 consumed D760 artifact bytes drifted");
validateD760LiveBundle(strictJsonCodec.decode(d760BundleBytes));
const baselineCapability = admitD761ConsumedD760Baseline(d760BundleBytes);
await mkdir(rootPath, { recursive: true, mode: 0o700 });
await chmod(rootPath, 0o700);
const privateRoot = await realpath(rootPath);
const rootStat = await lstat(privateRoot);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
	throw new TypeError("D761 private qualification root is invalid");
if ((await measureD761Implementation()) !== D761_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D761 implementation manifest validation failed");
const bundle = await runD761InjectedNoNetworkQualification(baselineCapability);
validateD761QualificationBundle(bundle);
if ((await measureD761Implementation()) !== D761_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D761 implementation changed during qualification");
const persistence = await persistD761QualificationBundle({ privateRoot, bundle });
process.stdout.write(
	`${JSON.stringify({
		status: "qualified",
		generationRef: D761_GENERATION_REF,
		implementationManifestDigest: D761_IMPLEMENTATION_MANIFEST_DIGEST,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		persistenceDigest: persistence.persistenceDigest,
		providerNetworkCalls: 0,
	})}\n`,
);
