import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
	D771_GENERATION_REF,
	persistD771QualificationBundle,
	runD771InjectedNoNetworkQualification,
	validateD771QualificationBundle,
} from "./d771-pre-live-qualification.js";

const root = join(
	process.cwd(),
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/.d771-pre-live-private",
);
try {
	await mkdir(root, { recursive: false, mode: 0o700 });
} catch (error) {
	const candidate = await lstat(root);
	if (
		!candidate.isDirectory() ||
		candidate.isSymbolicLink() ||
		(candidate.mode & 0o777) !== 0o700 ||
		(error as NodeJS.ErrnoException).code !== "EEXIST"
	)
		throw error;
}
const privateRoot = await realpath(root);
if (privateRoot !== root) throw new TypeError("D771 private root must not be a symlink");
const bundle = await runD771InjectedNoNetworkQualification();
validateD771QualificationBundle(bundle);
const persistence = await persistD771QualificationBundle({ privateRoot, bundle });
process.stdout.write(
	`${JSON.stringify({
		generationRef: D771_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		graphEvidenceDigest: bundle.graphEvidence.evidenceDigest,
		loweringGraphEvidenceDigest: bundle.loweringGraphEvidence.evidenceDigest,
		gateProjectionDigest: bundle.gate.projectionDigest,
		providerNetworkCalls: bundle.qualification.providerNetworkCalls,
		persistenceDigest: persistence.persistenceDigest,
	})}\n`,
);
