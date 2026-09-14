import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { empiricalSha256 } from "./canonical.js";
import {
	checkRootEvalGeneratedArtifactSnapshot,
	ROOT_EVAL_ARTIFACT_DIRECTORY,
	ROOT_EVAL_GENERATED_ARTIFACT_PATHS,
} from "./generate-root-eval-artifacts.js";

// Fixed external anchor from git f42fb43e12e351dc86601d184ae26e45cf8ed909:
// packages/ts/evals/graph-native-rerun-avoidance/artifacts/root-eval-artifact-set.json
const HISTORICAL_MARKER_DIGEST =
	"sha256:cf9add2a071ee40a850e5eb2e0d6537ae4fd748accd7a8fccc132ffab0a68d0c";

/** Integrity of retained D159 bytes only. Never grants current execution qualification. */
export async function checkRootEvalHistoricalArtifacts(
	artifactDirectory = ROOT_EVAL_ARTIFACT_DIRECTORY,
) {
	const root = resolve(artifactDirectory);
	const marker = resolve(root, "root-eval-artifact-set.json");
	const markerStat = await lstat(marker);
	if (!markerStat.isFile() || markerStat.size > 65_536)
		throw new Error("historical marker byte bound");
	const before = await readFile(marker);
	if (empiricalSha256(before) !== HISTORICAL_MARKER_DIGEST)
		throw new Error("historical artifact fixed anchor mismatch");
	const members: string[] = [];
	const visit = async (dir: string, prefix: string) => {
		for (const name of await readdir(dir)) {
			const path = resolve(dir, name),
				entry = await lstat(path);
			if (entry.isSymbolicLink()) throw new Error("historical artifact symlink rejected");
			if (entry.isDirectory()) await visit(path, `${prefix}${name}/`);
			else if (entry.isFile()) members.push(`${prefix}${name}`);
			else throw new Error("historical artifact non-file rejected");
		}
	};
	await visit(root, "");
	const expected = Object.values(ROOT_EVAL_GENERATED_ARTIFACT_PATHS)
		.map((p) => p.slice(ROOT_EVAL_ARTIFACT_DIRECTORY.length + 1))
		.sort();
	if (members.sort().join("\0") !== expected.join("\0"))
		throw new Error("historical artifact directory membership mismatch");
	const snapshot = await checkRootEvalGeneratedArtifactSnapshot({ artifactDirectory: root });
	if (
		snapshot.artifactSetDigest !== HISTORICAL_MARKER_DIGEST ||
		empiricalSha256(await readFile(marker)) !== HISTORICAL_MARKER_DIGEST
	)
		throw new Error("historical artifact marker changed");
	return Object.freeze({
		kind: "historical-integrity" as const,
		currentQualified: false as const,
		...snapshot,
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	console.log(JSON.stringify(await checkRootEvalHistoricalArtifacts(), null, 2));
