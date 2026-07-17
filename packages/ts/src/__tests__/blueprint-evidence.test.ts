import { describe, expect, it } from "vitest";
import {
	blueprintToMermaid,
	canonicalTopologyJson,
	diffGraphBlueprints,
	GRAPH_BLUEPRINT_VERSION,
	GRAPH_BLUEPRINT_VERSION_V1,
	type GraphBlueprint,
	type LegacyGraphBlueprint,
	parseGraphBlueprint,
	verifyBlueprintHash,
	withBlueprintHash,
} from "../index.js";

const testHash = (bytes: Uint8Array) => `h:${new TextDecoder().decode(bytes)}`;

const blueprint = (meta: Record<string, unknown> = {}): GraphBlueprint =>
	parseGraphBlueprint({
		version: GRAPH_BLUEPRINT_VERSION,
		topology: {
			name: "root",
			nodes: [
				{ id: "input", factory: "state", deps: [], meta },
				{ id: "output", factory: "derived", deps: ["input"] },
			],
			edges: [{ from: "input", to: "output" }],
			subgraphs: [
				{
					mountId: "child",
					name: "child",
					nodes: [
						{ id: "child::source", factory: "state", deps: [] },
						{
							id: "child::sink",
							factory: "effect",
							deps: ["child::source"],
						},
					],
					edges: [{ from: "child::source", to: "child::sink" }],
				},
			],
		},
	}) as GraphBlueprint;

const legacyBlueprint = (named = true): LegacyGraphBlueprint =>
	parseGraphBlueprint({
		version: GRAPH_BLUEPRINT_VERSION_V1,
		topology: {
			nodes: [{ id: "root", factory: "state", deps: [] }],
			edges: [],
			subgraphs: [
				{
					...(named ? { name: "legacy-child" } : {}),
					nodes: [{ id: "legacy::node", factory: "state", deps: [] }],
					edges: [],
				},
			],
		},
	}) as LegacyGraphBlueprint;

describe("portable GraphBlueprint evidence helpers (D629/D630)", () => {
	it("strictly parses, normalizes, and freezes a versioned Blueprint", () => {
		const parsed = parseGraphBlueprint(
			JSON.parse(JSON.stringify(blueprint({ z: 2, a: 1 }))) as unknown,
		);

		expect(parsed.topology.nodes.map((node) => node.id)).toEqual(["input", "output"]);
		expect(parsed.topology.nodes[0]?.meta).toEqual({ a: 1, z: 2 });
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.topology.nodes)).toBe(true);
		expect(() => parseGraphBlueprint({ ...parsed, version: "graphrefly.blueprint.v3" })).toThrow(
			/version must be/,
		);
		expect(() => parseGraphBlueprint({ ...parsed, surprise: true })).toThrow(/unknown field/);
		expect(() =>
			parseGraphBlueprint({ ...parsed, topology: { ...parsed.topology, mountId: "root" } }),
		).toThrow(/absent on the root/);
		const child = parsed.topology.subgraphs?.[0];
		expect(() =>
			parseGraphBlueprint({
				...parsed,
				topology: {
					...parsed.topology,
					subgraphs: [{ ...child, mountId: undefined }],
				},
			}),
		).toThrow(/not JSON-encodable/);
		expect(() =>
			parseGraphBlueprint({
				...parsed,
				topology: {
					...parsed.topology,
					subgraphs: [child, { ...child }],
				},
			}),
		).toThrow(/duplicate mountId/);
	});

	it("fails closed on inconsistent edges, diagnostics, provenance, and hash metadata", () => {
		const parsed = blueprint();
		expect(() =>
			parseGraphBlueprint({
				...parsed,
				topology: { ...parsed.topology, edges: [] },
			}),
		).toThrow(/edges must exactly match/);
		expect(() =>
			parseGraphBlueprint({ ...parsed, diagnostics: { ok: false, issues: [] } }),
		).toThrow(/diagnostics does not match/);
		expect(() => parseGraphBlueprint({ ...parsed, provenance: { bad: undefined } })).toThrow(
			/not JSON-encodable/,
		);
		expect(() =>
			parseGraphBlueprint({
				...parsed,
				hash: {
					kind: "topology",
					algorithm: "sha256",
					input: "wholeBlueprint",
					value: "bad",
				},
			}),
		).toThrow(/strictCanonicalTopologyBytes/);
	});

	it("verifies caller-owned sync and async topology hashes and detects tampering", async () => {
		const base = blueprint();
		const hashed = await withBlueprintHash(base, { algorithm: "test", hash: testHash });

		expect(verifyBlueprintHash(hashed, { algorithm: "test", hash: testHash })).toBe(true);
		await expect(
			verifyBlueprintHash(hashed, {
				algorithm: "test",
				hash: async (bytes) => testHash(bytes),
			}),
		).resolves.toBe(true);
		expect(verifyBlueprintHash(hashed, { algorithm: "other", hash: testHash })).toBe(false);

		const changed = blueprint({ changed: true });
		const tampered = parseGraphBlueprint({ ...changed, hash: hashed.hash });
		expect(verifyBlueprintHash(tampered, { algorithm: "test", hash: testHash })).toBe(false);

		const legacy = legacyBlueprint();
		const legacyHashed: LegacyGraphBlueprint = {
			...legacy,
			hash: {
				kind: "topology",
				algorithm: "test",
				input: "strictCanonicalTopologyBytes",
				value: testHash(new TextEncoder().encode(canonicalTopologyJson(legacy.topology))),
			},
		};
		expect(verifyBlueprintHash(legacyHashed, { algorithm: "test", hash: testHash })).toBe(true);
	});

	it("renders Mermaid directly from the Blueprint and preserves subgraph grouping", () => {
		expect(blueprintToMermaid(blueprint(), { direction: "TD" })).toBe(
			[
				"flowchart TD",
				'  n0["input"]',
				'  n1["output"]',
				"  n0 --> n1",
				'  subgraph sg0["child"]',
				'    n2["child::sink"]',
				'    n3["child::source"]',
				"    n3 --> n2",
				"  end",
			].join("\n"),
		);
		expect(blueprintToMermaid(legacyBlueprint(false))).toContain("legacy::node");
	});

	it("returns deterministic intrinsic node, edge, metadata, and subgraph events", () => {
		const before = blueprint({ role: "old" });
		const child = before.topology.subgraphs?.[0];
		const after = parseGraphBlueprint({
			version: GRAPH_BLUEPRINT_VERSION,
			topology: {
				name: "root",
				nodes: [
					{ id: "input", factory: "state", deps: [], meta: { role: "new" } },
					{ id: "replacement", factory: "effect", deps: ["input"] },
				],
				edges: [{ from: "input", to: "replacement" }],
				subgraphs: [
					{
						...child,
						nodes: child?.nodes.map((node) =>
							node.id === "child::sink" ? { ...node, factory: "changed-effect" } : node,
						),
					},
					{
						mountId: "extra",
						name: "extra",
						nodes: [{ id: "extra::node", factory: "state", deps: [] }],
						edges: [],
					},
				],
			},
		});

		const first = diffGraphBlueprints(before, after);
		const second = diffGraphBlueprints(before, after);
		expect(first).toEqual(second);
		expect(first.events.map((event) => event.type)).toEqual([
			"subgraph-added",
			"node-added",
			"node-added",
			"node-changed",
			"node-changed",
			"edge-added",
			"edge-removed",
			"node-removed",
		]);
		const changed = first.events.find(
			(event) => event.type === "node-changed" && event.after.id === "input",
		);
		expect(changed).toMatchObject({
			type: "node-changed",
			before: { id: "input", meta: { role: "old" } },
			after: { id: "input", meta: { role: "new" } },
		});
		expect(
			first.events.find(
				(event) => event.type === "node-changed" && event.topologyPath[0] === "child",
			),
		).toMatchObject({
			type: "node-changed",
			topologyPath: ["child"],
			after: { id: "child::sink", factory: "changed-effect" },
		});
		expect(canonicalTopologyJson(before.topology)).not.toBe(canonicalTopologyJson(after.topology));
	});

	it("fails closed when a structural diff lacks trustworthy identity", () => {
		const legacyAmbiguous = legacyBlueprint(false);
		expect(() => diffGraphBlueprints(legacyAmbiguous, legacyAmbiguous)).toThrow(
			/v1 subgraphs require non-empty unique names/,
		);
		expect(() => diffGraphBlueprints(legacyBlueprint(), blueprint())).toThrow(
			/versions must match/,
		);

		const duplicate = parseGraphBlueprint({
			version: GRAPH_BLUEPRINT_VERSION,
			topology: {
				nodes: [
					{ id: "same", factory: "state", deps: [] },
					{ id: "same", factory: "effect", deps: [] },
				],
				edges: [],
			},
		});
		expect(() => diffGraphBlueprints(duplicate, duplicate)).toThrow(/error diagnostics/);
	});
});
