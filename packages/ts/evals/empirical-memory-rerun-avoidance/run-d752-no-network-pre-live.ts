import { constants } from "node:fs";
import { chmod, mkdir, open, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	persistD752PrivateGeneration,
	runD752InjectedNoNetworkQualification,
} from "./d752-provider-transport-diagnostic-integration.js";

const here = dirname(fileURLToPath(import.meta.url));
const privateRoot = join(here, "../.private/empirical-memory-rerun-avoidance/.d752-private");
const d751Artifact = join(
	here,
	"../.private/empirical-memory-rerun-avoidance/.d751-private/d751-sanitized-transport-diagnostic-pre-live-2026-08-12-v5/artifacts/qualification.v1.json",
);
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const handle = await open(d751Artifact, constants.O_RDONLY | constants.O_NOFOLLOW);
let d751QualificationBytes: Uint8Array;
try {
	const status = await handle.stat();
	if (
		!status.isFile() ||
		status.nlink !== 1 ||
		(status.mode & 0o777) !== 0o600 ||
		status.size > 16 * 1_048_576
	)
		throw new TypeError("D752 D751 qualification artifact identity is invalid");
	d751QualificationBytes = new Uint8Array(await handle.readFile());
} finally {
	await handle.close();
}
const bundle = await runD752InjectedNoNetworkQualification({ d751QualificationBytes });
const receipt = await persistD752PrivateGeneration({
	privateRoot: await realpath(privateRoot),
	bundle,
});
process.stdout.write(
	`${JSON.stringify({
		status: "qualified",
		qualificationDigest: receipt.qualificationDigest,
		generationDigest: receipt.generationDigest,
		bundleDigest: receipt.bundleDigest,
	})}\n`,
);
