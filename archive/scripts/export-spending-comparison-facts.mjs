/** B121 read-only passive schedule and plain-call source extraction. No consumer execution. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

assert.equal(process.argv.length, 2);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hash = (x) => createHash("sha256").update(x).digest("hex");
const binding = JSON.parse(
	readFileSync(join(root, "docs/design/causal-comparison-preparation/capture-binding.json")),
).binding;
const bundle = await build({
	absWorkingDir: root,
	entryPoints: ["scripts/fixtures/spending-proof-scenarios.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	write: false,
	metafile: true,
});
assert.ok(
	Object.keys(bundle.metafile.inputs).every((p) =>
		/^scripts\/fixtures\/spending-(proof-(scenarios|verifier)|numeric-oracle)\.ts$/.test(p),
	),
	"passive fixture closure changed",
);
const { proofScenarios } = await import(
	"data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const cases = proofScenarios(binding);
const plainPath = "scripts/fixtures/spending-proof-plain-host.ts",
	plainText = readFileSync(join(root, plainPath), "utf8");
// Build only: esbuild's runtime import closure is hashed, never imported or executed.
const plainBundle = await build({
	absWorkingDir: root,
	entryPoints: [plainPath],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	write: false,
	metafile: true,
});
const plainPaths = Object.keys(plainBundle.metafile.inputs).sort();
assert.ok(
	plainPaths.every((p) => /^scripts\/fixtures\/spending-[\w-]+\.ts$/.test(p)),
	"plain runtime closure escaped the independent fixtures",
);
const program = ts.createProgram(
	plainPaths.map((p) => join(root, p)),
	{
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		skipLibCheck: true,
	},
);
const checker = program.getTypeChecker();
const localFiles = new Set(plainPaths.map((p) => join(root, p)));
const candidates = new Map();
const declarations = new Map();
const symbolTarget = (node) => {
	let symbol = checker.getSymbolAtLocation(node);
	if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
	return (symbol?.declarations ?? []).map((d) => declarations.get(d)).filter(Boolean);
};
const location = (node) => {
	const sf = node.getSourceFile();
	return {
		path: relative(root, sf.fileName),
		start: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
		end: sf.getLineAndCharacterOfPosition(node.end).line + 1,
	};
};
for (const path of plainPaths) {
	const sf = program.getSourceFile(join(root, path));
	const visit = (node, scope = []) => {
		let name;
		if (ts.isClassDeclaration(node) && node.name) scope = [...scope, node.name.text];
		if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.body)
			name = node.name?.getText(sf);
		if (ts.isConstructorDeclaration(node)) name = "constructor";
		if (
			ts.isVariableDeclaration(node) &&
			node.initializer &&
			(ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
		)
			name = node.name.getText(sf);
		if (name) {
			const id = `${path}::${[...scope, name].join(".")}`;
			assert.ok(!candidates.has(id), `ambiguous declaration ${id}`);
			const body = ts.isVariableDeclaration(node) ? node.initializer : node;
			let enclosing = node.parent;
			while (enclosing && !ts.isClassDeclaration(enclosing)) enclosing = enclosing.parent;
			const record = {
				id,
				node,
				body,
				group: `${path}::${enclosing?.name?.text ?? "functions"}`,
				factory: ts.isConstructorDeclaration(node)
					? "source-constructor"
					: ts.isMethodDeclaration(node)
						? "source-method"
						: "source-function",
			};
			candidates.set(id, record);
			declarations.set(node, id);
			declarations.set(body, id);
			scope = [...scope, name];
		}
		ts.forEachChild(node, (child) => visit(child, scope));
	};
	visit(sf);
}
const roots = [...candidates.values()].filter(
	(r) =>
		r.group === `${plainPath}::PlainSpendingProofHost` &&
		(ts.isConstructorDeclaration(r.node) ||
			(ts.isMethodDeclaration(r.node) &&
				!ts.isPrivateIdentifier(r.node.name) &&
				!r.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword))),
);
const reached = new Set();
const callEvidence = [];
const unresolvedCalls = [];
const queue = roots.map((r) => r.id);
for (let i = 0; i < queue.length; i++) {
	const id = queue[i];
	if (reached.has(id)) continue;
	reached.add(id);
	const record = candidates.get(id);
	const add = (to, kind, node) => {
		callEvidence.push({ from: id, to, kind, ...location(node), expression: node.getText() });
		if (!reached.has(to)) queue.push(to);
	};
	const visit = (node, callback = false) => {
		if (node !== record.node && node !== record.body && declarations.has(node)) return;
		if (ts.isTypeNode(node)) return;
		if (node !== record.body && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)))
			callback = true;
		if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
			const expression = node.expression;
			const targets = new Set(
				symbolTarget(ts.isPropertyAccessExpression(expression) ? expression.name : expression),
			);
			const signatureDeclaration = checker.getResolvedSignature(node)?.declaration;
			if (declarations.has(signatureDeclaration))
				targets.add(declarations.get(signatureDeclaration));
			if (ts.isNewExpression(node)) {
				let symbol = checker.getSymbolAtLocation(expression);
				if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
				for (const cls of symbol?.declarations ?? [])
					if (ts.isClassDeclaration(cls))
						for (const member of cls.members)
							if (ts.isConstructorDeclaration(member) && declarations.has(member))
								targets.add(declarations.get(member));
			}
			for (const target of targets)
				add(target, callback ? "possible-callback-body-call" : "direct-syntactic-call", node);
			if (!targets.size)
				unresolvedCalls.push({
					from: id,
					...location(node),
					expression: expression.getText(),
					context: callback ? "possible-callback-body" : "direct-body",
					boundary:
						signatureDeclaration && !localFiles.has(signatureDeclaration.getSourceFile().fileName)
							? "external-runtime-or-standard-library"
							: "unresolved-dynamic-or-injected-call",
				});
		}
		// Named functions supplied as values (including validator shape tables) are possible
		// callbacks, not proof that the receiving API invokes them or of execution order.
		if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
			const parent = node.parent;
			const isName = parent.name === node && !ts.isShorthandPropertyAssignment(parent);
			const isCallee =
				(ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node;
			const isMemberCallee =
				ts.isPropertyAccessExpression(parent) &&
				parent.name === node &&
				(ts.isCallExpression(parent.parent) || ts.isNewExpression(parent.parent)) &&
				parent.parent.expression === parent;
			if (!isName && !isCallee && !isMemberCallee)
				for (const target of symbolTarget(node))
					add(target, "possible-function-value-reference", node);
		}
		ts.forEachChild(node, (child) => visit(child, callback));
	};
	visit(record.body);
	// Constructor execution also evaluates instance property initializers.
	if (ts.isConstructorDeclaration(record.node))
		for (const member of record.node.parent.members)
			if (
				ts.isPropertyDeclaration(member) &&
				member.initializer &&
				!member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
			)
				visit(member.initializer);
}
const nodes = [...reached].sort().map((id) => ({ id, factory: candidates.get(id).factory }));
const edges = [
	...new Map(callEvidence.map(({ from, to }) => [`${from}\0${to}`, { from, to }])).values(),
].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
const groupIds = [...new Set(nodes.map(({ id }) => candidates.get(id).group))].sort();
const groups = groupIds.map((id) => {
	const members = nodes.filter((n) => candidates.get(n.id).group === id).map((n) => n.id);
	const memberSet = new Set(members);
	return {
		id,
		members,
		internalEdges: edges.filter((e) => memberSet.has(e.from) && memberSet.has(e.to)),
	};
});
const crossEdges = edges
	.filter((e) => candidates.get(e.from).group !== candidates.get(e.to).group)
	.map((e) => ({
		...e,
		fromGroup: candidates.get(e.from).group,
		toGroup: candidates.get(e.to).group,
	}));
const relations = {
	kind: "plain",
	nodeCount: nodes.length,
	displayUnits: groups.length,
	nodes,
	edges,
	groups,
	crossEdges,
};
assert.ok(relations.displayUnits <= 20);
assert.ok(
	nodes.some((n) => n.id.endsWith("spending-numeric-plain.ts::plainNumbers")),
	"numeric dependency missing",
);
assert.ok(edges.some((e) => e.from.endsWith("::plainBusiness") && e.to.endsWith("::plainNumbers")));
const reviewNodes = nodes.map(({ id }) => {
	const node = candidates.get(id).node;
	const source = node.getText();
	return { id, ...location(node), sha256: hash(source), source };
});
// Retain the old host-method review surface for downstream readers.
const methods = reviewNodes
	.filter((n) => candidates.get(n.id).group === `${plainPath}::PlainSpendingProofHost`)
	.map((n) => ({
		...n,
		id: n.id.split("PlainSpendingProofHost.")[1],
		calls: callEvidence.filter((e) => e.from === n.id).map((e) => e.expression),
	}));
const inputs = [...new Set([...Object.keys(bundle.metafile.inputs), ...plainPaths])]
	.sort()
	.map((path) => ({ path, sha256: hash(readFileSync(join(root, path))) }));
const review = {
	semantics:
		"Conservative source-call projection, not observed runtime topology. Direct edges identify syntactic calls; possible edges include calls inside anonymous callbacks and named function value references. Dynamic targets and external builtins remain explicit boundaries. No control-flow, invocation frequency, callback scheduling, or dataflow proof is claimed.",
	roots: roots.map((r) => r.id),
	nodes: reviewNodes,
	callEvidence,
	unresolvedCalls,
	runtimeInputs: plainPaths,
	externalImports: [
		...new Set(
			Object.values(plainBundle.metafile.inputs).flatMap((v) =>
				v.imports.filter((i) => i.external).map((i) => i.path),
			),
		),
	].sort(),
	toolchain: { typescript: ts.version },
};
writeFileSync(
	join(root, "docs/design/causal-comparison-preparation/passive-facts.json"),
	JSON.stringify(
		{
			kind: "passive-source-extraction",
			consumerRuns: 0,
			realInboxIO: 0,
			inputs,
			binding,
			cases,
			plain: { path: plainPath, sha256: hash(plainText), methods, edges, relations, review },
		},
		null,
		2,
	) + "\n",
);
console.log(
	JSON.stringify({ passiveSchedules: cases.length, plainMethods: methods.length, consumerRuns: 0 }),
);
