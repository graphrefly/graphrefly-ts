import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
if (!process.argv[2])
	throw Error("Pass an existing output directory; no implicit artifact overwrite.");
const out = `${resolve(process.argv[2])}/`;
const source = `import {presetRun,evaluationFixture,evaluationPack} from '${root}/scripts/fixtures/spending-preset-harness.ts';
const rows=[];for(const mode of ['off','summary'] as const){for(const flagged of [true,false]){const r=presetRun(mode);const e=evaluationFixture(0,'coffee',2,flagged);r.send('pack',evaluationPack([e]));r.drive(e);rows.push({mode,flagged,owner:r.owner.phase,authorityPresent:!!r.state(),effects:r.state()?.effects.size,publication:r.events.publication.at(-1),issues:r.events.issues,dirty:r.graph.describe().nodes.filter(n=>n.status==='dirty').map(n=>n.id)});r.cleanup();}} console.log(JSON.stringify(rows));`;
for (const patched of [false, true]) {
	let originalDigest, patchedDigest;
	const file = out + (patched ? "lane-partial-probe.cjs" : "lane-original-probe.cjs");
	await build({
		stdin: { contents: source, resolveDir: root, loader: "ts" },
		bundle: true,
		platform: "node",
		format: "cjs",
		outfile: file,
		plugins: [
			{
				name: "isolated-lane-probe",
				setup(b) {
					b.onLoad({ filter: /causal-occurrence\/construction\.ts$/ }, async (args) => {
						let contents = await readFile(args.path, "utf8");
						originalDigest = createHash("sha256").update(contents).digest("hex");
						if (patched) {
							const target = '{ name, factory: "causalOccurrenceInputLane" }';
							if (!contents.includes(target)) throw Error("missing exact patch target");
							contents = contents.replace(
								target,
								'{ name, factory: "causalOccurrenceInputLane", partial: true }',
							);
						}
						patchedDigest = createHash("sha256").update(contents).digest("hex");
						return { contents, loader: "ts" };
					});
				},
			},
		],
	});
	const result = JSON.parse(
		execFileSync(process.execPath, [file], { encoding: "utf8", timeout: 30000 }),
	);
	const evidence = { patched, originalDigest, patchedDigest, result };
	await writeFile(
		out + (patched ? "lane-partial-result.json" : "lane-original-result.json"),
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	console.log(
		JSON.stringify({
			patched,
			originalDigest,
			patchedDigest,
			rows: result.map(({ publication, issues, ...r }) => ({
				...r,
				recorded: publication?.rows.map((r) => r.recorded),
				issues: issues.map((x) => x.code),
			})),
		}),
	);
}
