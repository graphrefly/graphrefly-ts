import { execFile as execFileCallback } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256 } from "./canonical.js";
import {
	admitD38D37Baseline,
	type D38LiveBundleV1,
	persistD38LiveBundle,
	persistD38PreexecutionFailure,
	runD38LiveMeasurement,
} from "./d38-premature-final-live.js";
import {
	acquireD38DispatchClaim,
	consumeD38DispatchClaim,
	D38_PRIVATE_ROOT,
	type D38ExecutionAuthorityV1,
	issueD38CurrentKeyFailureAuthority,
	issueD38ExecutionBoundaryFailureAuthority,
	issueD38PostCurrentKeyFailureAuthority,
	readD38CurrentKeyAdmission,
} from "./d38-premature-final-live-claim.js";
import {
	D38_BASELINE_COMMIT,
	D38_D37_ARTIFACT_DIGEST,
	D38_LIVE_APPROVAL_REVISION,
	D38_QUALIFICATION_GENERATION_REF,
} from "./d38-premature-final-live-coordinates.js";
import {
	D38_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD38Implementation,
} from "./d38-premature-final-live-implementation-manifest.js";
import {
	admitD38ZeroByok,
	composeD38Preclaim,
	type D38CredentialV1,
	readD38OfficialPricing,
} from "./d38-premature-final-live-preflight.js";
import { validateD38QualificationBundle } from "./d38-premature-final-live-qualification.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateEvidenceRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const credentialFile = join(privateEvidenceRoot, "openrouter.env");
const zeroByokFile = join(privateEvidenceRoot, "d38-fresh-zero-byok-browser-attestation.v1.json");
const d37ArtifactFile = join(
	privateEvidenceRoot,
	"current-graph-native-d37/current-graph-native-premature-final-no-network-2026-08-20-d37-v7/artifacts/bundle.v1.json",
);
const qualificationFile = join(
	D38_PRIVATE_ROOT,
	D38_QUALIFICATION_GENERATION_REF,
	"artifacts/bundle.v1.json",
);

async function readPrivateFile(path: string, maximumBytes: number): Promise<Uint8Array> {
	if ((await realpath(path)) !== path)
		throw new TypeError("D38 private live file is not canonical");
	const metadata = await lstat(path);
	if (
		!metadata.isFile() ||
		metadata.isSymbolicLink() ||
		(metadata.mode & 0o777) !== 0o600 ||
		metadata.nlink !== 1 ||
		metadata.size < 1 ||
		metadata.size > maximumBytes ||
		(process.getuid !== undefined && metadata.uid !== process.getuid())
	)
		throw new TypeError("D38 private live file ownership is invalid");
	return new Uint8Array(await readFile(path));
}

async function assertImplementation(): Promise<string> {
	const measured = await measureD38Implementation(repositoryRoot);
	if (measured !== D38_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D38 live implementation manifest drifted");
	await execFile("/usr/bin/git", ["merge-base", "--is-ancestor", D38_BASELINE_COMMIT, "HEAD"], {
		cwd: repositoryRoot,
	});
	const { stdout } = await execFile(
		"/usr/bin/git",
		["status", "--porcelain=v1", "--untracked-files=no"],
		{ cwd: repositoryRoot, encoding: "utf8" },
	);
	if (stdout.length !== 0) throw new TypeError("D38 live tracked worktree is not clean");
	return measured;
}

function loadCredential(bytes: Uint8Array): D38CredentialV1 {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	let token: string | null = null;
	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const separator = line.indexOf("=");
		if (separator < 1) throw new TypeError("D38 credential file syntax is invalid");
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		)
			value = value.slice(1, -1);
		if (key !== "OPENROUTER_API_KEY" || token !== null)
			throw new TypeError("D38 credential file contains unexpected keys");
		token = value;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D38 credential is absent or outside its bound");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
}

const implementationManifestDigest = await assertImplementation();
const d37Bytes = await readPrivateFile(d37ArtifactFile, 8_388_608);
if (empiricalSha256(d37Bytes) !== D38_D37_ARTIFACT_DIGEST)
	throw new TypeError("D38 live D37 qualification artifact drifted");
const baseline = admitD38D37Baseline(d37Bytes);
const qualificationBytes = await readPrivateFile(qualificationFile, 16_777_216);
const qualification = validateD38QualificationBundle(strictJsonCodec.decode(qualificationBytes));
if (
	qualification.baselineBasis !== "consumed-d37-artifact" ||
	qualification.qualification.implementationManifestDigest !== implementationManifestDigest ||
	qualification.qualification.providerNetworkCalls !== 0 ||
	qualification.qualification.liveGateEvaluated !== false ||
	qualification.qualification.efficacyClaim !== "none"
)
	throw new TypeError("D38 live qualification projection drifted");
if (D38_LIVE_APPROVAL_REVISION === null) throw new TypeError("D38 live authority is unavailable");

const pricing = await readD38OfficialPricing({
	fetch: globalThis.fetch,
	nowMs: () => Date.now(),
	signal: AbortSignal.timeout(30_000),
});
const credential = loadCredential(await readPrivateFile(credentialFile, 8_192));
const nowMs = Date.now();
const zeroByok = admitD38ZeroByok({
	bytes: await readPrivateFile(zeroByokFile, 65_536),
	credential,
	nowMs,
});
const preclaim = composeD38Preclaim({
	pricingObservation: pricing,
	zeroByokObservation: zeroByok,
	credential,
	nowMs,
});
if ((await assertImplementation()) !== implementationManifestDigest)
	throw new TypeError("D38 live implementation drifted before claim");
const claim = await acquireD38DispatchClaim({
	preclaim,
	nowMs,
	implementationManifestDigest,
	qualificationArtifactDigest: empiricalSha256(qualificationBytes),
	qualificationDigest: qualification.qualification.qualificationDigest,
});

let executionAuthority: D38ExecutionAuthorityV1;
try {
	const currentKeyAdmission = await readD38CurrentKeyAdmission({
		claim,
		credential,
		fetch: globalThis.fetch,
		signal: AbortSignal.timeout(30_000),
	});
	executionAuthority = await consumeD38DispatchClaim({ claim, currentKeyAdmission });
} catch (error) {
	const failureAuthority = await issueD38CurrentKeyFailureAuthority(claim);
	await persistD38PreexecutionFailure({
		privateRoot: await realpath(D38_PRIVATE_ROOT),
		failureAuthority,
		implementationManifestDigest,
	});
	throw error;
}

try {
	if ((await assertImplementation()) !== implementationManifestDigest)
		throw new TypeError("D38 live implementation drifted after current-key admission");
} catch (error) {
	const failureAuthority = await issueD38PostCurrentKeyFailureAuthority(executionAuthority);
	await persistD38PreexecutionFailure({
		privateRoot: await realpath(D38_PRIVATE_ROOT),
		failureAuthority,
		implementationManifestDigest,
	});
	throw error;
}

const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d38-live-"));
await chmod(materializationRoot, 0o700);
let bundle: D38LiveBundleV1;
try {
	bundle = await runD38LiveMeasurement({
		executionAuthority,
		baseline,
		credential,
		repositoryRoot,
		materializationRoot,
		implementationManifestDigest,
		now: () => performance.now(),
		sleep: (milliseconds) =>
			new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
	});
} catch (error) {
	await rm(materializationRoot, { recursive: true, force: true }).catch(() => undefined);
	const failureAuthority = await issueD38ExecutionBoundaryFailureAuthority(executionAuthority);
	await persistD38PreexecutionFailure({
		privateRoot: await realpath(D38_PRIVATE_ROOT),
		failureAuthority,
		implementationManifestDigest,
	});
	throw error;
}
const persistence = await persistD38LiveBundle({
	privateRoot: await realpath(D38_PRIVATE_ROOT),
	bundle,
});
const outerCleanupDisposition = await rm(materializationRoot, {
	recursive: true,
	force: true,
}).then(
	() => "completed" as const,
	() => "failed-after-canonical-persistence" as const,
);
process.stdout.write(
	`${JSON.stringify({ decisionRef: bundle.decisionRef, disposition: bundle.disposition, bundleDigest: bundle.bundleDigest, graphEvidenceDigest: bundle.graphEvidence?.evidenceDigest ?? null, partialGraphDigest: bundle.partialGraphEvidence?.partialGraphDigest ?? null, gateDigest: bundle.gate.gateDigest, gatePassed: bundle.gate.passed, causalAttribution: bundle.causalAttribution, efficacyClaim: bundle.efficacyClaim, persistenceDigest: persistence.receiptDigest, outerCleanupDisposition })}\n`,
);
