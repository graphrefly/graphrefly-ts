import { execFile as execFileCallback } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256 } from "./canonical.js";
import {
	admitD36D35Baseline,
	type D36LiveBundleV1,
	persistD36LiveBundle,
	persistD36PreexecutionFailure,
	runD36LiveMeasurement,
} from "./d36-retained-span-live.js";
import {
	acquireD36DispatchClaim,
	consumeD36DispatchClaim,
	D36_PRIVATE_ROOT,
	type D36ExecutionAuthorityV1,
	readD36CurrentKeyAdmission,
} from "./d36-retained-span-live-claim.js";
import {
	D36_BASELINE_COMMIT,
	D36_D35_ARTIFACT_DIGEST,
	D36_LIVE_APPROVAL_REVISION,
	D36_QUALIFICATION_GENERATION_REF,
} from "./d36-retained-span-live-coordinates.js";
import {
	D36_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD36Implementation,
} from "./d36-retained-span-live-implementation-manifest.js";
import {
	admitD36ZeroByok,
	composeD36Preclaim,
	type D36CredentialV1,
	readD36OfficialPricing,
} from "./d36-retained-span-live-preflight.js";
import { validateD36QualificationBundle } from "./d36-retained-span-live-qualification.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateEvidenceRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const credentialFile = join(privateEvidenceRoot, "openrouter.env");
const zeroByokFile = join(privateEvidenceRoot, "d36-fresh-zero-byok-browser-attestation.v1.json");
const d35ArtifactFile = join(
	privateEvidenceRoot,
	"current-graph-native-d35/current-graph-native-retained-span-real-provider-no-network-2026-08-20-d35-v1/artifacts/bundle.v1.json",
);
const qualificationFile = join(
	D36_PRIVATE_ROOT,
	D36_QUALIFICATION_GENERATION_REF,
	"artifacts/bundle.v1.json",
);

async function readPrivateFile(path: string, maximumBytes: number): Promise<Uint8Array> {
	if ((await realpath(path)) !== path)
		throw new TypeError("D36 private live file is not canonical");
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
		throw new TypeError("D36 private live file ownership is invalid");
	return new Uint8Array(await readFile(path));
}

async function assertImplementation(): Promise<string> {
	const measured = await measureD36Implementation(repositoryRoot);
	if (measured !== D36_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D36 live implementation manifest drifted");
	await execFile("/usr/bin/git", ["merge-base", "--is-ancestor", D36_BASELINE_COMMIT, "HEAD"], {
		cwd: repositoryRoot,
	});
	const { stdout } = await execFile(
		"/usr/bin/git",
		["status", "--porcelain=v1", "--untracked-files=no"],
		{ cwd: repositoryRoot, encoding: "utf8" },
	);
	if (stdout.length !== 0) throw new TypeError("D36 live tracked worktree is not clean");
	return measured;
}

function loadCredential(bytes: Uint8Array): D36CredentialV1 {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	let token: string | null = null;
	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const separator = line.indexOf("=");
		if (separator < 1) throw new TypeError("D36 credential file syntax is invalid");
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		)
			value = value.slice(1, -1);
		if (key !== "OPENROUTER_API_KEY" || token !== null)
			throw new TypeError("D36 credential file contains unexpected keys");
		token = value;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D36 credential is absent or outside its bound");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
}

const implementationManifestDigest = await assertImplementation();
const d35Bytes = await readPrivateFile(d35ArtifactFile, 8_388_608);
if (empiricalSha256(d35Bytes) !== D36_D35_ARTIFACT_DIGEST)
	throw new TypeError("D36 live D35 qualification artifact drifted");
const baseline = admitD36D35Baseline(d35Bytes);
const qualificationBytes = await readPrivateFile(qualificationFile, 16_777_216);
const qualification = validateD36QualificationBundle(strictJsonCodec.decode(qualificationBytes));
if (
	qualification.baselineBasis !== "consumed-d35-artifact" ||
	qualification.qualification.implementationManifestDigest !== implementationManifestDigest ||
	qualification.qualification.providerNetworkCalls !== 0 ||
	qualification.qualification.liveGateEvaluated !== false ||
	qualification.qualification.efficacyClaim !== "none"
)
	throw new TypeError("D36 live qualification projection drifted");
if (D36_LIVE_APPROVAL_REVISION === null) throw new TypeError("D36 live authority is unavailable");

const pricing = await readD36OfficialPricing({
	fetch: globalThis.fetch,
	nowMs: () => Date.now(),
	signal: AbortSignal.timeout(30_000),
});
const credential = loadCredential(await readPrivateFile(credentialFile, 8_192));
const nowMs = Date.now();
const zeroByok = admitD36ZeroByok({
	bytes: await readPrivateFile(zeroByokFile, 65_536),
	credential,
	nowMs,
});
const preclaim = composeD36Preclaim({
	pricingObservation: pricing,
	zeroByokObservation: zeroByok,
	credential,
	nowMs,
});
if ((await assertImplementation()) !== implementationManifestDigest)
	throw new TypeError("D36 live implementation drifted before claim");
const claim = await acquireD36DispatchClaim({
	preclaim,
	nowMs,
	implementationManifestDigest,
	qualificationArtifactDigest: empiricalSha256(qualificationBytes),
	qualificationDigest: qualification.qualification.qualificationDigest,
});

let executionAuthority: D36ExecutionAuthorityV1;
try {
	const currentKeyAdmission = await readD36CurrentKeyAdmission({
		claim,
		credential,
		fetch: globalThis.fetch,
		signal: AbortSignal.timeout(30_000),
	});
	executionAuthority = await consumeD36DispatchClaim({ claim, currentKeyAdmission });
} catch (error) {
	await persistD36PreexecutionFailure({
		privateRoot: await realpath(D36_PRIVATE_ROOT),
		claim,
		implementationManifestDigest,
		failurePhase: "current-key-admission",
	});
	throw error;
}

const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d36-live-"));
await chmod(materializationRoot, 0o700);
let bundle: D36LiveBundleV1;
try {
	bundle = await runD36LiveMeasurement({
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
	await persistD36PreexecutionFailure({
		privateRoot: await realpath(D36_PRIVATE_ROOT),
		claim,
		implementationManifestDigest,
		failurePhase: "execution-construction",
	});
	throw error;
}
await rm(materializationRoot, { recursive: true, force: true });
const persistence = await persistD36LiveBundle({
	privateRoot: await realpath(D36_PRIVATE_ROOT),
	bundle,
});
process.stdout.write(
	`${JSON.stringify({ decisionRef: bundle.decisionRef, disposition: bundle.disposition, bundleDigest: bundle.bundleDigest, graphEvidenceDigest: bundle.graphEvidence?.evidenceDigest ?? null, partialGraphDigest: bundle.partialGraphEvidence?.partialGraphDigest ?? null, gateDigest: bundle.gate.gateDigest, gatePassed: bundle.gate.passed, causalAttribution: bundle.causalAttribution, efficacyClaim: bundle.efficacyClaim, persistenceDigest: persistence.receiptDigest })}\n`,
);
