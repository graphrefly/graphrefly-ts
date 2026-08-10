import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const D711_QUALIFIED_IMPLEMENTATION_ANCESTOR =
	"73f58f68ae6297a362f0f1a8ba59f13f78ba2824" as const;
export const D711_QUALIFIED_NODE_VERSION = "v24.18.0" as const;
export const D711_QUALIFIED_EVAL_SOURCE_TREE_DIGEST =
	"sha256:e132765f6a099a8288b4b6585d01739f26aee9629436230cda426ad20e2411d0" as const;
export const D711_QUALIFIED_PRIVATE_SOURCE_TREE_DIGEST =
	"sha256:c55d8d2152540d4aa4256020386c158f58145c5bda105d57b9bfd3e9d03a60c9" as const;

const execFileAsync = promisify(execFile);

function sha256(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeEntrypointSource(bytes: Uint8Array): Uint8Array {
	const source = new TextDecoder().decode(bytes);
	return new TextEncoder().encode(
		source.replace(
			/(D711_QUALIFIED_(?:EVAL|PRIVATE)_SOURCE_TREE_DIGEST\s*=\s*\n?\s*")[^"]+("\s+as const;)/g,
			"$1sha256:QUALIFIED_SOURCE_TREE_DIGEST$2",
		),
	);
}

async function sourceTreeDigest(input: {
	readonly root: string;
	readonly extensions: readonly string[];
	readonly normalizeEntrypoint: boolean;
}): Promise<string> {
	const names = (await readdir(input.root, { withFileTypes: true }))
		.filter(
			(entry) =>
				entry.isFile() && input.extensions.some((extension) => entry.name.endsWith(extension)),
		)
		.map((entry) => entry.name)
		.sort();
	const entries: Array<readonly [string, string]> = [];
	for (const name of names) {
		const bytes = new Uint8Array(await readFile(join(input.root, name)));
		entries.push([
			name,
			sha256(
				input.normalizeEntrypoint && name === "d711-qualified-live-entrypoint.ts"
					? normalizeEntrypointSource(bytes)
					: bytes,
			),
		]);
	}
	return sha256(new TextEncoder().encode(JSON.stringify(entries)));
}

export async function assertD711QualifiedLiveImplementation(input: {
	readonly repositoryRoot: string;
	readonly privateOperatorRoot: string;
	readonly nodeVersion: string;
}): Promise<string> {
	if (input.nodeVersion !== D711_QUALIFIED_NODE_VERSION) {
		throw new TypeError("D711 live operator requires the exact qualified Node toolchain");
	}
	await execFileAsync(
		"git",
		["merge-base", "--is-ancestor", D711_QUALIFIED_IMPLEMENTATION_ANCESTOR, "HEAD"],
		{ cwd: input.repositoryRoot },
	);
	const evalSourceRoot = join(
		input.repositoryRoot,
		"packages/ts/evals/empirical-memory-rerun-avoidance",
	);
	const evalSourceDigest = await sourceTreeDigest({
		root: evalSourceRoot,
		extensions: [".ts"],
		normalizeEntrypoint: true,
	});
	if (evalSourceDigest !== D711_QUALIFIED_EVAL_SOURCE_TREE_DIGEST) {
		throw new TypeError("D711 package-private eval source tree drifted after qualification");
	}
	const privateSourceDigest = await sourceTreeDigest({
		root: input.privateOperatorRoot,
		extensions: [".ts", ".mjs"],
		normalizeEntrypoint: false,
	});
	if (privateSourceDigest !== D711_QUALIFIED_PRIVATE_SOURCE_TREE_DIGEST) {
		throw new TypeError("D711 private operator source tree drifted after qualification");
	}
	return join(input.privateOperatorRoot, "run-d711-live.ts");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const repositoryRoot = join(import.meta.dirname, "../../../..");
	const privateOperatorRoot = join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance",
	);
	const runnerPath = await assertD711QualifiedLiveImplementation({
		repositoryRoot,
		privateOperatorRoot,
		nodeVersion: process.version,
	});
	await import(pathToFileURL(runnerPath).href);
}
