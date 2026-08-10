import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const D708_QUALIFIED_IMPLEMENTATION_ANCESTOR =
	"73f58f68ae6297a362f0f1a8ba59f13f78ba2824" as const;
export const D708_QUALIFIED_NODE_VERSION = "v24.18.0" as const;

const PRIVATE_SOURCE_DIGESTS = Object.freeze({
	"run-d708-live.ts": "a6ff6289f9b6864cab98736192a9eeed3f0f43062788b5c89adb966c274347a5",
	"d691-operator-input.ts": "914cf7bf6f3d98e110832d7a6547c0d3c7fe5c68c8a4d44492366c033bf6750e",
	"d691-private-host.ts": "1357c93ad443ec771b4989390709d0b720b680ae8be97b09feb0c53f7d25145f",
	"openrouter-operator-credential-env.ts":
		"9d036dcc4f536056254d5a40293c1f15c32a282725f27860bcef6b4dd8aecf29",
	"write-d708-zero-byok-attestation.mjs":
		"bcf5b44cec7963ebf992ee4f6cf73e82a57182525d430b1e8cf5b46d97ce0191",
});

const execFileAsync = promisify(execFile);

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export async function assertD708QualifiedLiveImplementation(input: {
	readonly repositoryRoot: string;
	readonly privateOperatorRoot: string;
	readonly nodeVersion: string;
}): Promise<string> {
	if (input.nodeVersion !== D708_QUALIFIED_NODE_VERSION) {
		throw new TypeError("D708 live operator requires the exact qualified Node toolchain");
	}
	await execFileAsync(
		"git",
		["merge-base", "--is-ancestor", D708_QUALIFIED_IMPLEMENTATION_ANCESTOR, "HEAD"],
		{ cwd: input.repositoryRoot },
	);
	await execFileAsync("git", ["diff-index", "--quiet", "HEAD", "--"], {
		cwd: input.repositoryRoot,
	});
	for (const [file, expectedDigest] of Object.entries(PRIVATE_SOURCE_DIGESTS)) {
		const actualDigest = sha256(
			new Uint8Array(await readFile(join(input.privateOperatorRoot, file))),
		);
		if (actualDigest !== expectedDigest) {
			throw new TypeError(`D708 private live implementation drifted: ${file}`);
		}
	}
	return join(input.privateOperatorRoot, "run-d708-live.ts");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const repositoryRoot = join(import.meta.dirname, "../../../..");
	const privateOperatorRoot = join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance",
	);
	const runnerPath = await assertD708QualifiedLiveImplementation({
		repositoryRoot,
		privateOperatorRoot,
		nodeVersion: process.version,
	});
	await import(pathToFileURL(runnerPath).href);
}
