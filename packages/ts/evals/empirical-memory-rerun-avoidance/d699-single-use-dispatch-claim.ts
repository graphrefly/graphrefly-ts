import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D696_PRIVATE_PERSISTENCE_ROOT } from "./d696-continuation-assisted-live.js";
import {
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D699_SINGLE_USE_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.private-solution-eval.d699-single-use-dispatch-claim.v1";
export const D699_SINGLE_USE_DISPATCH_CLAIM_REF =
	"d699-d696-accounting-fixed-replacement-2026-08-08-v1";
export const D699_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY = `.${D699_SINGLE_USE_DISPATCH_CLAIM_REF}`;
export const D699_LIVE_GENERATION_REF = "d696-continuation-assisted-live-2026-08-08-d699-v2";
const D699_CLAIM_FILE = "dispatch-claim.v1.json";

export interface D699SingleUseDispatchClaimV1 {
	readonly schemaVersion: typeof D699_SINGLE_USE_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D699_SINGLE_USE_DISPATCH_CLAIM_REF;
	readonly decisionRef: "decision.D699";
	readonly decisionRevision: "decision.D699.2026-08-08.v1";
	readonly generationRef: typeof D699_LIVE_GENERATION_REF;
	readonly disposition: "consumed-before-credential-or-network";
	readonly blockCount: 1;
	readonly maxSpendMicrousd: 6_000_000;
	readonly claimDigest: string;
}

export interface AcquiredD699SingleUseDispatchClaimV1 {
	readonly claimPath: string;
	readonly claimDigest: string;
}

function createD699SingleUseDispatchClaim(): D699SingleUseDispatchClaimV1 {
	const material = strictSnapshot({
		schemaVersion:
			D699_SINGLE_USE_DISPATCH_CLAIM_SCHEMA as typeof D699_SINGLE_USE_DISPATCH_CLAIM_SCHEMA,
		claimRef: D699_SINGLE_USE_DISPATCH_CLAIM_REF as typeof D699_SINGLE_USE_DISPATCH_CLAIM_REF,
		decisionRef: "decision.D699" as const,
		decisionRevision: "decision.D699.2026-08-08.v1" as const,
		generationRef: D699_LIVE_GENERATION_REF as typeof D699_LIVE_GENERATION_REF,
		disposition: "consumed-before-credential-or-network" as const,
		blockCount: 1 as const,
		maxSpendMicrousd: 6_000_000 as const,
	});
	return strictSnapshot({
		...material,
		claimDigest: empiricalStrictJsonDigest(material),
	});
}

export async function acquireD699SingleUseDispatchClaim(): Promise<AcquiredD699SingleUseDispatchClaimV1> {
	return acquireD699SingleUseDispatchClaimAtPrivateRoot(D696_PRIVATE_PERSISTENCE_ROOT);
}

export async function acquireD699SingleUseDispatchClaimAtPrivateRoot(
	privateRootInput: string,
): Promise<AcquiredD699SingleUseDispatchClaimV1> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D699_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	try {
		await mkdir(claimPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D699 paid dispatch is already claimed");
		}
		throw error;
	}

	// mkdir is the irreversible single-use boundary. Any later failure deliberately
	// leaves this exact directory in place so another process cannot spend again.
	try {
		const claimStatus = await lstat(claimPath);
		if (
			!claimStatus.isDirectory() ||
			claimStatus.isSymbolicLink() ||
			(claimStatus.mode & 0o777) !== 0o700
		) {
			throw new TypeError("D699 dispatch claim does not have exact 0700 ownership");
		}
		if ((await realpath(claimPath)) !== claimPath) {
			throw new TypeError("D699 dispatch claim escaped its operator-private path");
		}
		const claim = createD699SingleUseDispatchClaim();
		const claimBytes = strictJsonCodec.encode(claim);
		const claimFile = join(claimPath, D699_CLAIM_FILE);
		await writePrivateFile(claimFile, claimBytes);
		await syncDirectory(claimPath);
		await syncDirectory(privateRoot);
		const persistedBytes = new Uint8Array(await readFile(claimFile));
		if (!Buffer.from(persistedBytes).equals(claimBytes)) {
			throw new TypeError("D699 dispatch claim readback did not match canonical bytes");
		}
		return Object.freeze({ claimPath, claimDigest: claim.claimDigest });
	} catch (error) {
		throw new Error("D699 paid dispatch claim is consumed but not fully durable", { cause: error });
	}
}
