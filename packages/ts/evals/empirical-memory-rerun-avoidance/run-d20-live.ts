import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256 } from "./canonical.js";
import {
	admitD20D19Baseline,
	type D20LiveBundleV1,
	persistD20LiveBundle,
	persistD20PreexecutionFailure,
	runD20LiveMeasurement,
} from "./d20-current-live.js";
import {
	acquireD20DispatchClaim,
	consumeD20DispatchClaim,
	D20_PRIVATE_ROOT,
	type D20ExecutionAuthorityV1,
	readD20CurrentKeyAdmission,
} from "./d20-current-live-claim.js";
import { D20_BASELINE_COMMIT } from "./d20-current-live-coordinates.js";
import {
	D20_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD20Implementation,
} from "./d20-current-live-implementation-manifest.js";
import {
	admitD20ZeroByok,
	composeD20Preclaim,
	type D20CredentialV1,
	readD20OfficialPricing,
} from "./d20-current-live-preflight.js";
import { validateD20QualificationBundle } from "./d20-current-live-qualification.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateEvidenceRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const credentialFile = join(privateEvidenceRoot, "openrouter.env");
const zeroByokFile = join(privateEvidenceRoot, "d20-fresh-zero-byok-browser-attestation.v1.json");
const d19ArtifactFile = join(
	privateEvidenceRoot,
	"current-graph-native-d19/current-graph-native-real-provider-no-network-2026-08-16-d19-v3/artifacts/bundle.v1.json",
);
const d20QualificationFile = join(
	D20_PRIVATE_ROOT,
	"current-graph-native-efficacy-live-no-network-2026-08-16-d20-v1/artifacts/bundle.v1.json",
);

async function assertImplementation(): Promise<string> {
	const measured = await measureD20Implementation(repositoryRoot);
	if (measured !== D20_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D20 live implementation manifest drifted");
	await execFile("/usr/bin/git", ["merge-base", "--is-ancestor", D20_BASELINE_COMMIT, "HEAD"], {
		cwd: repositoryRoot,
	});
	const { stdout } = await execFile(
		"/usr/bin/git",
		["status", "--porcelain=v1", "--untracked-files=no"],
		{ cwd: repositoryRoot, encoding: "utf8" },
	);
	if (stdout.length !== 0) throw new TypeError("D20 live tracked worktree is not clean");
	return measured;
}

function loadCredential(bytes: Uint8Array): D20CredentialV1 {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	let token: string | null = null;
	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const separator = line.indexOf("=");
		if (separator < 1) throw new TypeError("D20 credential file syntax is invalid");
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		)
			value = value.slice(1, -1);
		if (key !== "OPENROUTER_API_KEY" || token !== null)
			throw new TypeError("D20 credential file contains unexpected keys");
		token = value;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D20 credential is absent or outside its bound");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
}

const implementationManifestDigest = await assertImplementation();
const d19Bytes = new Uint8Array(await readFile(d19ArtifactFile));
const baseline = admitD20D19Baseline(d19Bytes);
const qualificationBytes = new Uint8Array(await readFile(d20QualificationFile));
const qualification = validateD20QualificationBundle(strictJsonCodec.decode(qualificationBytes));
if (
	qualification.baselineBasis !== "exact-private-artifact" ||
	qualification.implementationManifestDigest !== implementationManifestDigest ||
	qualification.qualification.externalNetworkCalls !== 0 ||
	qualification.qualification.liveGateEvaluated !== false ||
	qualification.qualification.efficacyClaim !== "none"
)
	throw new TypeError("D20 live qualification projection drifted");

const pricingSignal = AbortSignal.timeout(30_000);
const pricing = await readD20OfficialPricing({
	fetch: globalThis.fetch,
	nowMs: () => Date.now(),
	signal: pricingSignal,
});
const credential = loadCredential(new Uint8Array(await readFile(credentialFile)));
const zeroByokBytes = new Uint8Array(await readFile(zeroByokFile));
const nowMs = Date.now();
const zeroByok = admitD20ZeroByok({ bytes: zeroByokBytes, credential, nowMs });
const preclaim = composeD20Preclaim({
	pricingObservation: pricing,
	zeroByokObservation: zeroByok,
	credential,
	nowMs,
});
const claim = await acquireD20DispatchClaim({
	preclaim,
	nowMs,
	implementationManifestDigest,
	qualificationArtifactDigest: empiricalSha256(qualificationBytes),
	qualificationDigest: qualification.qualification.qualificationDigest,
});

let executionAuthority: D20ExecutionAuthorityV1;
try {
	const currentKeyAdmission = await readD20CurrentKeyAdmission({
		claim,
		credential,
		fetch: globalThis.fetch,
		signal: AbortSignal.timeout(30_000),
	});
	executionAuthority = await consumeD20DispatchClaim({ claim, currentKeyAdmission });
} catch (error) {
	await persistD20PreexecutionFailure({
		privateRoot: await realpath(D20_PRIVATE_ROOT),
		claim,
		implementationManifestDigest,
		failurePhase: "current-key-admission",
	});
	throw error;
}

const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d20-live-"));
await chmod(materializationRoot, 0o700);
let bundle: D20LiveBundleV1;
try {
	bundle = await runD20LiveMeasurement({
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
	await persistD20PreexecutionFailure({
		privateRoot: await realpath(D20_PRIVATE_ROOT),
		claim,
		implementationManifestDigest,
		failurePhase: "execution-construction",
	});
	throw error;
}
await rm(materializationRoot, { recursive: true, force: true }).catch(() => undefined);
const persistence = await persistD20LiveBundle({
	privateRoot: await realpath(D20_PRIVATE_ROOT),
	bundle,
});
process.stdout.write(
	`${JSON.stringify({
		decisionRef: bundle.decisionRef,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		graphEvidenceDigest: bundle.graphEvidence?.evidenceDigest ?? null,
		partialGraphDigest: bundle.partialGraphEvidence?.partialGraphDigest ?? null,
		gateDigest: bundle.gate.gateDigest,
		gatePassed: bundle.gate.passed,
		causalAttribution: bundle.causalAttribution,
		efficacyClaim: bundle.efficacyClaim,
		persistenceDigest: persistence.persistenceDigest,
	})}\n`,
);
