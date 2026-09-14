import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalSha256 } from "../../evals/graph-native-rerun-avoidance/canonical.js";
import { checkRootEvalHistoricalArtifacts } from "../../evals/graph-native-rerun-avoidance/check-historical-artifacts.js";
import { ROOT_EVAL_ARTIFACT_DIRECTORY } from "../../evals/graph-native-rerun-avoidance/generate-root-eval-artifacts.js";

describe("D159 retained history is not current qualification", () => {
	it("checks the externally anchored history without measuring current implementation", async () => {
		expect(await checkRootEvalHistoricalArtifacts()).toMatchObject({
			kind: "historical-integrity",
			currentQualified: false,
		});
	});
	for (const kind of ["missing", "extra", "content", "resigned-marker"] as const)
		it(`rejects ${kind}`, async () => {
			const root = await mkdtemp(join(tmpdir(), "root-history-"));
			try {
				await cp(ROOT_EVAL_ARTIFACT_DIRECTORY, root, { recursive: true });
				const path = join(root, "root-eval-run-summary.json");
				if (kind === "missing") await rm(path);
				else if (kind === "extra") await writeFile(join(root, "extra.json"), "{}");
				else {
					await writeFile(path, "{}\n");
					if (kind === "resigned-marker") {
						const markerPath = join(root, "root-eval-artifact-set.json"),
							marker = JSON.parse(await readFile(markerPath, "utf8"));
						marker.files["root-eval-run-summary.json"] = empiricalSha256(Buffer.from("{}\n"));
						await writeFile(markerPath, JSON.stringify(marker));
					}
				}
				await expect(checkRootEvalHistoricalArtifacts(root)).rejects.toThrow(/historical|snapshot/);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
});
