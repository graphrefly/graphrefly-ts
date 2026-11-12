/** Private generated-worker instrumentation; no consumer execution. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export function derive(source) {
	assert.equal(
		createHash("sha256").update(source).digest("hex"),
		"9e0ee5e980e38348b8e132c247ab25d20bfeeff0a873b29f21236e46b6e9650e",
	);
	const pairs = [
		["  release(opts = {}) {", "  release(opts = {}, diagnostic) {"],
		[
			"      reason: opts.reason ?? this.name\n    });",
			"      reason: opts.reason ?? this.name\n    }, diagnostic);",
		],
		[
			"  releaseNodes(nodes, opts) {\n    this.host._releaseNodes(nodes, opts);",
			"  releaseNodes(nodes, opts, diagnostic) {\n    this.host._releaseNodes(nodes, opts, diagnostic);",
		],
		[
			"  _releaseNodes(nodes, _opts = {}) {",
			"  _releaseNodes(nodes, _opts = {}, diagnostic) {\n    if (diagnostic) diagnostic.r0 = diagnostic.now(); // RELEASE",
		],
		[
			"    const releaseIds = new Map(entries.map(({ node, entry }) => [node, entry.id]));",
			"    const releaseIds = new Map(entries.map(({ node, entry }) => [node, entry.id]));\n    if (diagnostic) diagnostic.r1 = diagnostic.now(); // RELEASE",
		],
		[
			"    for (const { node, entry } of entries) {\n      if (!isNodeRuntimeQuiescentForRelease(node)) {",
			"    if (diagnostic) diagnostic.r2 = diagnostic.now(); // RELEASE\n    for (const { node, entry } of entries) {\n      if (!isNodeRuntimeQuiescentForRelease(node)) {",
		],
		[
			"    const releasedEvents = this._topologyObservers.size === 0 ? [] : entries.map",
			"    if (diagnostic) diagnostic.r3 = diagnostic.now(); // RELEASE\n    const releasedEvents = this._topologyObservers.size === 0 ? [] : entries.map",
		],
		[
			"    let releaseFailed = false;\n    for (const { node } of entries) {",
			"    let releaseFailed = false;\n    if (diagnostic) diagnostic.r4 = diagnostic.now(); // RELEASE\n    for (const { node } of entries) {",
		],
		[
			"    if (!releaseFailed) {\n      const constructions = graphRegistrations.get(this).existingConstructions;",
			"    if (diagnostic) diagnostic.r5 = diagnostic.now(); // RELEASE\n    if (!releaseFailed) {\n      const constructions = graphRegistrations.get(this).existingConstructions;",
		],
		[
			"    if (releaseFailed) throw releaseError;",
			"    if (releaseFailed) throw releaseError;\n    if (diagnostic) diagnostic.r6 = diagnostic.now(); // RELEASE",
		],
		[
			"      group.release();\n      if (diagnostic) diagnostic.d4",
			"      group.release(void 0, diagnostic?.release);\n      if (diagnostic) diagnostic.d4",
		],
	];
	let out = source;
	for (const [a, b] of pairs) {
		assert.equal(out.split(a).length, 2, a);
		out = out.replace(a, b);
	}
	return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assert.equal(process.argv.length, 4);
	writeFileSync(process.argv[3], derive(readFileSync(process.argv[2], "utf8")), { flag: "wx" });
}
