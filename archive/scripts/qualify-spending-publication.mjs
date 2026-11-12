/** Isolated real runtime mutations for the private publication consumer. No host effects. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--output");
assert.ok(arg >= 0 && process.argv[arg + 1]);
const output = resolve(process.argv[arg + 1]);
assert.equal(existsSync(output), false);
const artifacts = output + ".artifacts";
mkdirSync(artifacts);
const temp = mkdtempSync(join(tmpdir(), "publication-mutations-"));
const sourcePath = "examples/spending-alerts/causal-publication.ts",
	testPath = "packages/ts/src/__tests__/spending-alerts-causal-publication.test.ts";
const source = readFileSync(join(root, sourcePath), "utf8"),
	tests = readFileSync(join(root, testPath), "utf8");
const hash = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const replace = (s, a, b) => {
	assert.equal(s.split(a).length, 2, a);
	return s.replace(a, b);
};
const between = (s, start, end, body) => {
	const a = s.indexOf(start),
		b = s.indexOf(end, a);
	assert.ok(a >= 0 && b > a);
	return s.slice(0, a) + body + s.slice(b);
};
const variants = [
	{
		id: "trust-mutable-binding-reference",
		kind: "runtime-output",
		pattern: "mutable authority binding is revalidated",
		change: (s) =>
			replace(
				s,
				"if (Object.isFrozen(view.binding)) state.validatedBinding = view.binding;",
				"state.validatedBinding = view.binding;",
			),
	},
	{
		id: "omit-request-proposal-key",
		kind: "runtime-output",
		pattern: "valid alternate request cannot match",
		change: (s) =>
			between(
				s,
				"function associationKey(",
				"interface MaterialIndex",
				"function associationKey(p:CausalEffectProposal):string{const o=p.occurrence;return JSON.stringify([o.revisionDomain,o.occurrenceId,o.revision,o.digest,o.sourceRefs.map(r=>[r.kind,r.id]),p.effectId]);}\n",
			),
	},
	{
		id: "effect-id-only",
		kind: "runtime-output",
		pattern: "full association coordinate",
		change: (s) =>
			between(
				s,
				"function associationKey(",
				"interface MaterialIndex",
				"function associationKey(p:CausalEffectProposal):string{return p.effectId;}\n",
			),
	},
	{
		id: "source-binding-bypass",
		kind: "runtime-output",
		pattern: "same topology/source change",
		change: (s) =>
			between(
				s,
				"function sameBinding(",
				"export function proposalForMaterial",
				"function sameBinding(a:unknown,b:unknown){return true;}\n",
			),
	},
	{
		id: "trust-frame-self-digest",
		kind: "runtime-output",
		pattern: "independent verifier rejects each negative input: frame",
		change: (s) =>
			replace(s, "materialDigest(canonicalMaterial(frame.body)) !== frame.digest", "false"),
	},
	{
		id: "payload-binding-bypass",
		kind: "runtime-output",
		pattern: "independent verifier rejects each negative input: payload",
		change: (s) =>
			replace(
				replace(s, "materialDigest(b.payloadText) !== b.payloadDigest", "false"),
				"m.requestRef.id !== materialDigest(canonicalMaterial(b))",
				"false",
			),
	},
	{
		id: "drop-same-commit-outcome",
		kind: "runtime-output",
		pattern: "same-commit outcome projects",
		change: (s) => replace(s, "record.outcome?.state ??", "undefined ??"),
	},
	{
		id: "missing-material-old-index",
		kind: "runtime-output",
		pattern: "invalid new frame clears old match|A/B fan-in",
		change: (s) =>
			replace(
				s,
				"state.index = validateMaterialSnapshot(raw, asOf);",
				"{const fresh=validateMaterialSnapshot(raw,asOf);state.index=fresh.rows.size?fresh:(state.index??fresh);}",
			),
	},
	{
		id: "ui-cleanup-deletes-authority",
		kind: "runtime-authority-state",
		pattern: "UI cleanup leaves the actual authority map",
		change: (s) =>
			'import {checkpointStateOfNode} from "../../packages/ts/src/node/runtime-accessors.js";\n' +
			replace(
				s,
				"const materialArrived = Boolean(depBatch(ctx, 1)?.length);",
				"const materialArrived = Boolean(depBatch(ctx, 1)?.length);ctx.onDeactivation(()=>{(checkpointStateOfNode(ownerGraph.find(authorityId)!).ctxState?.value as {effects:Map<unknown,unknown>})?.effects.clear();});",
			),
	},
	{
		id: "unrelated-data-rehash",
		kind: "runtime-work-count",
		pattern: "immutable repeated DATA and view-only change",
		change: (s) => replace(s, "raw !== state.raw ||", "true ||"),
	},
	{
		id: "actual-material-edge-deletion",
		kind: "runtime-dependency-guard",
		pattern: "uses two nodes and original roots",
		change: (s) =>
			replace(s, "[causal.committedEffects, materialSource],", "[causal.committedEffects],"),
	},
	{
		id: "actual-authority-edge-deletion",
		kind: "runtime-dependency-guard",
		pattern: "uses two nodes and original roots",
		change: (s) => replace(s, "[causal.committedEffects, materialSource],", "[materialSource],"),
	},
	{
		id: "raw-unaccepted-admission-rewire",
		kind: "runtime-output-and-rewire",
		pattern: "raw unaccepted admission lane",
		change: (s) => {
			s = replace(
				s,
				"[causal.committedEffects, materialSource],",
				"[prepared.options.effectAdmissions, materialSource],",
			);
			s = replace(
				s,
				"requestMaterialJoin.deps[0] !== causal.committedEffects",
				"requestMaterialJoin.deps[0] !== prepared.options.effectAdmissions",
			);
			return replace(
				s,
				"const view = depLatest(ctx, 0) as CommittedEffectsView | undefined;",
				`const rawAdmission=depLatest(ctx,0) as any;const view:CommittedEffectsView|undefined=rawAdmission?{kind:'causal-committed-effects',authorityId,binding,effects:[{proposal:{occurrence:rawAdmission.occurrence,effectId:rawAdmission.effectId,requestRef:rawAdmission.requestRef,proposalDigest:rawAdmission.proposalDigest},admission:rawAdmission}],retention:[]}:undefined;`,
			);
		},
	},
];
const report = {
	schema: "graphrefly-ts/spending-publication-mutations/v1",
	runnerDigest: hash(readFileSync(fileURLToPath(import.meta.url))),
	sourceDigest: hash(source),
	testDigest: hash(tests),
	results: [],
	complete: false,
};
try {
	cpSync(join(root, "packages/ts/src"), join(temp, "packages/ts/src"), { recursive: true });
	mkdirSync(join(temp, "examples/spending-alerts"), { recursive: true });
	for (const name of ["causal-publication.ts", "pipeline.ts"])
		cpSync(
			join(root, "examples/spending-alerts", name),
			join(temp, "examples/spending-alerts", name),
		);
	cpSync(join(root, "scripts/fixtures"), join(temp, "scripts/fixtures"), { recursive: true });
	cpSync(join(root, "docs/design"), join(temp, "docs/design"), { recursive: true });
	symlinkSync(join(root, "node_modules"), join(temp, "node_modules"), "dir");
	symlinkSync(
		join(root, "examples/spending-alerts/node_modules"),
		join(temp, "examples/spending-alerts/node_modules"),
		"dir",
	);
	writeFileSync(join(temp, "package.json"), '{"type":"module"}');
	writeFileSync(
		join(temp, "vitest.config.mts"),
		`export default {define:{__GRAPHREFLY_TS_PACKAGE_REVISION__:'"graphrefly-ts:0.9.0"'},test:{include:['${testPath}']}}`,
	);
	for (const v of [
		{ id: "unchanged", kind: "baseline", pattern: ".", change: (s) => s },
		...variants,
	]) {
		const changed =
			v.change(source) +
			`\n(globalThis as unknown as {__publicationMutant:string}).__publicationMutant=${JSON.stringify(v.id)};\n`;
		writeFileSync(join(temp, sourcePath), changed);
		const withLoaded =
			tests +
			`\nit('mutant loaded evidence',()=>expect((globalThis as unknown as {__publicationMutant:string}).__publicationMutant).toBe(${JSON.stringify(v.id)}));\n`;
		writeFileSync(join(temp, testPath), withLoaded);
		const resultPath = join(artifacts, v.id + ".result.json");
		const child = spawnSync(
			process.execPath,
			[
				join(root, "node_modules/vitest/vitest.mjs"),
				"run",
				"--root",
				temp,
				"--config",
				join(temp, "vitest.config.mts"),
				"--testNamePattern",
				v.pattern + "|mutant loaded evidence",
				"--reporter=json",
				`--outputFile=${resultPath}`,
			],
			{ cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
		);
		writeFileSync(join(artifacts, v.id + ".log"), child.stdout + child.stderr);
		writeFileSync(join(artifacts, v.id + ".ts"), changed);
		assert.ifError(child.error);
		assert.equal(child.signal, null);
		assert.ok(existsSync(resultPath));
		const result = JSON.parse(readFileSync(resultPath, "utf8"));
		assert.equal(result.numRuntimeErrorTestSuites ?? 0, 0);
		assert.equal(result.unhandledErrors?.length ?? 0, 0);
		const checks = result.testResults
			.flatMap((x) => x.assertionResults)
			.filter((x) => ["passed", "failed"].includes(x.status));
		assert.ok(checks.find((x) => x.fullName === "mutant loaded evidence" && x.status === "passed"));
		const failed = checks.filter((x) => x.status === "failed");
		const entry = {
			id: v.id,
			kind: v.kind,
			loadedDigest: hash(changed),
			checks: checks.length,
			failed: failed.map((x) => ({ name: x.fullName, reason: x.failureMessages.join("\n") })),
			exitCode: child.status,
			resultDigest: hash(readFileSync(resultPath)),
			outcome:
				v.kind === "baseline"
					? child.status === 0
						? "passed"
						: "failed"
					: failed.length
						? "detected"
						: "survived",
		};
		report.results.push(entry);
		writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
		if (v.kind === "baseline") assert.equal(child.status, 0, JSON.stringify(failed));
		else {
			assert.equal(child.status, 1, v.id + " survived");
			assert.ok(failed.length > 0);
			for (const x of failed)
				assert.match(
					x.failureMessages.join("\n"),
					/AssertionError/u,
					v.id + " not assertion-detected",
				);
		}
		console.log(v.id, entry.outcome);
	}
	report.complete = true;
} finally {
	rmSync(temp, { recursive: true, force: true });
	assert.equal(readFileSync(join(root, sourcePath), "utf8"), source);
	report.cleanup = { temporaryRemoved: !existsSync(temp), childrenExited: true };
	writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
	console.log("PUBLICATION_MUTATIONS_DONE", report.complete);
}
