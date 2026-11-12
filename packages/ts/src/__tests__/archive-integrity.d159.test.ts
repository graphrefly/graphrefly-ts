/**
 * D159's retained history (Q14): the graph-native-rerun-avoidance harness and its artifacts were
 * archived at origin/main's bytes. This checks the archived artifact set on its own, against the
 * fixed external anchor; it never runs the harness and grants no current qualification.
 */

import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ARCHIVED_ARTIFACTS = fileURLToPath(
	new URL(
		"../../../../archive/packages/ts/evals/graph-native-rerun-avoidance/artifacts",
		import.meta.url,
	),
);

// Fixed external anchor from git f42fb43e12e351dc86601d184ae26e45cf8ed909:
// packages/ts/evals/graph-native-rerun-avoidance/artifacts/root-eval-artifact-set.json
const HISTORICAL_MARKER_DIGEST =
	"sha256:cf9add2a071ee40a850e5eb2e0d6537ae4fd748accd7a8fccc132ffab0a68d0c";
const MARKER = "root-eval-artifact-set.json";

const sha256 = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function members(root: string): Promise<string[]> {
	const out: string[] = [];
	const visit = async (dir: string, prefix: string) => {
		for (const name of await readdir(dir)) {
			const entry = await lstat(resolve(dir, name));
			if (entry.isSymbolicLink()) throw new Error("historical artifact symlink rejected");
			if (entry.isDirectory()) await visit(resolve(dir, name), `${prefix}${name}/`);
			else if (entry.isFile()) out.push(`${prefix}${name}`);
			else throw new Error("historical artifact non-file rejected");
		}
	};
	await visit(root, "");
	return out.sort();
}

/** The archived set: the anchored marker, exactly its files, each with its recorded digest. */
async function checkArchivedArtifacts(root = ARCHIVED_ARTIFACTS) {
	const markerBytes = await readFile(resolve(root, MARKER));
	if (sha256(markerBytes) !== HISTORICAL_MARKER_DIGEST)
		throw new Error("historical artifact fixed anchor mismatch");
	const marker = JSON.parse(markerBytes.toString("utf8")) as { files: Record<string, string> };
	const expected = [...Object.keys(marker.files), MARKER].sort();
	if ((await members(root)).join("\0") !== expected.join("\0"))
		throw new Error("historical artifact directory membership mismatch");
	for (const [name, digest] of Object.entries(marker.files))
		if (sha256(await readFile(resolve(root, name))) !== digest)
			throw new Error(`historical artifact snapshot drift: ${name}`);
	return { kind: "historical-integrity" as const, currentQualified: false as const };
}

describe("D159 archived history is not current qualification", () => {
	it("checks the externally anchored archived artifacts", async () => {
		expect(await checkArchivedArtifacts()).toEqual({
			kind: "historical-integrity",
			currentQualified: false,
		});
	});

	for (const kind of ["missing", "extra", "content", "resigned-marker"] as const)
		it(`rejects ${kind}`, async () => {
			const root = await mkdtemp(join(tmpdir(), "root-history-"));
			try {
				await cp(ARCHIVED_ARTIFACTS, root, { recursive: true });
				const path = join(root, "root-eval-run-summary.json");
				if (kind === "missing") await rm(path);
				else if (kind === "extra") await writeFile(join(root, "extra.json"), "{}");
				else {
					await writeFile(path, "{}\n");
					if (kind === "resigned-marker") {
						const markerPath = join(root, MARKER);
						const marker = JSON.parse(await readFile(markerPath, "utf8"));
						marker.files["root-eval-run-summary.json"] = sha256(Buffer.from("{}\n"));
						await writeFile(markerPath, JSON.stringify(marker));
					}
				}
				await expect(checkArchivedArtifacts(root)).rejects.toThrow(/historical/);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
});
