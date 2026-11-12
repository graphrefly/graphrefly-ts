/** Offline maintenance checks. Normalization is source comparison, not a performance replay. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (name) => readFileSync(new URL(name, new URL("../", import.meta.url)), "utf8");
const maintenance = JSON.parse(read("docs/design/causal-l-closeout/maintenance.json"));
const manifest = JSON.parse(read("docs/design/causal-l-closeout/frozen-files.json"));
for (const name of maintenance.unboundJson) {
	const before = execFileSync("git", ["show", `${manifest.baseline}:${name}`], { cwd: root });
	assert.deepEqual(JSON.parse(read(name)), JSON.parse(before), name);
}
function normalized(source) {
	const code = transformSync(source, {
		format: "esm",
		minifySyntax: true,
		legalComments: "none",
	}).code;
	const lines = code.split("\n");
	const imports = lines
		.filter((line) => line.startsWith("import "))
		.map((line) =>
			line.replace(
				/\{([^}]+)\}/,
				(_whole, names) =>
					`{${names
						.split(",")
						.map((name) => name.trim())
						.sort()
						.join(",")}}`,
			),
		)
		.sort();
	return transformSync(
		imports.concat(lines.filter((line) => !line.startsWith("import "))).join("\n"),
		{ format: "esm", minifyWhitespace: true, legalComments: "none" },
	).code;
}
let comparisons = 0;
const fixtures = [];
for (const row of maintenance.copies) {
	execFileSync(process.execPath, ["--check", row.maintained], { cwd: root });
	if (row.maintained.includes("test_child-lint-v1")) {
		fixtures.push(JSON.parse(execFileSync(process.execPath, [row.maintained], { cwd: root })));
		continue;
	}
	let before = read(row.original);
	const after = read(row.maintained)
		.replaceAll("./driver-lint-v1.mjs", "./driver.mjs")
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Compare literal source paths.
		.replaceAll("${doc}/verification-lint-v1.json", "${doc}/verification.json");
	if (row.original.endsWith("dependency-comparison-tools/build.mjs")) {
		// The sole non-format code edit: no reassignment of this local binding exists.
		const old = 'let after = readFileSync(path.join(root, "sources/C", different[0]), "utf8");';
		assert.equal(before.split(old).length, 2);
		before = before.replace(old, old.replace("let after", "const after"));
	}
	assert.equal(normalized(after), normalized(before), row.maintained);
	comparisons++;
}
console.log(
	JSON.stringify({
		kind: "lint-maintenance-offline-check",
		jsonValuesUnchanged: maintenance.unboundJson.length,
		normalizedSourceComparisons: comparisons,
		fixtures,
		currentQualified: false,
	}),
);
