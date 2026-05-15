/**
 * Unit tests for the dogfood `catalogOverlay` reactive overlay over
 * `portableCatalog`. Validates that:
 *   - effective catalog merges base ∪ overlay
 *   - overlay upserts shadow base entries with matching names
 *   - tombstones (delete patches) shadow base entries
 *   - templates use a separate overlay surface
 *   - `effective` re-emits exactly when overlay state changes
 */

import { DATA } from "@graphrefly/pure-ts/core";
import { describe, expect, it } from "vitest";
import { type CatalogPatch, catalogOverlay } from "../../../../../evals/lib/catalog-overlay.js";
import { portableCatalog, portableFns } from "../../../../../evals/lib/portable-catalog.js";
import { portableTemplates } from "../../../../../evals/lib/portable-templates.js";
import type { CatalogFnEntry, GraphSpecCatalog } from "../../../utils/graphspec/index.js";

const sentinelEntry: CatalogFnEntry = {
	factory: () =>
		({ subscribe: () => () => {} }) as unknown as ReturnType<CatalogFnEntry["factory"]>,
	description: "sentinel test entry",
	tags: ["test"],
};

function snapshot(node: { cache?: GraphSpecCatalog | undefined }): GraphSpecCatalog {
	const cached = node.cache;
	if (!cached) throw new Error("expected effective catalog node to have cached value");
	return cached;
}

describe("catalogOverlay — base passthrough", () => {
	it("effective catalog equals base when overlay is empty", () => {
		const overlay = catalogOverlay({ base: portableCatalog });
		// Force the derived to settle by subscribing.
		overlay.effective.subscribe(() => {});
		const eff = snapshot(overlay.effective);
		expect(Object.keys(eff.fns ?? {})).toEqual(Object.keys(portableFns));
		// No accidental aliasing — overlay returns a fresh record.
		expect(eff.fns).not.toBe(portableFns);
		overlay.dispose();
	});
});

describe("catalogOverlay — fn upsert / shadow / delete", () => {
	it("upsertFn adds a new entry visible in effective", () => {
		const overlay = catalogOverlay({ base: portableCatalog });
		overlay.effective.subscribe(() => {});
		const patch = overlay.upsertFn("brandNewFn", sentinelEntry);
		expect(patch.kind).toBe("fn-upsert");
		const eff = snapshot(overlay.effective);
		expect(eff.fns?.brandNewFn).toBe(sentinelEntry);
		overlay.dispose();
	});

	it("upsertFn shadows a base entry with the same name", () => {
		const overlay = catalogOverlay({ base: portableCatalog });
		overlay.effective.subscribe(() => {});
		// `filterBy` exists in portableFns — overlay should win.
		overlay.upsertFn("filterBy", sentinelEntry);
		const eff = snapshot(overlay.effective);
		expect(eff.fns?.filterBy).toBe(sentinelEntry);
		expect(eff.fns?.filterBy).not.toBe(portableFns.filterBy);
		overlay.dispose();
	});

	it("fn-delete patch tombstones a base entry", () => {
		const overlay = catalogOverlay({ base: portableCatalog });
		overlay.effective.subscribe(() => {});
		const before = snapshot(overlay.effective);
		expect(before.fns?.filterBy).toBeDefined();
		overlay.applyPatch({ kind: "fn-delete", name: "filterBy" } as CatalogPatch);
		const after = snapshot(overlay.effective);
		expect(after.fns?.filterBy).toBeUndefined();
		overlay.dispose();
	});

	it("reset() restores base view", () => {
		const overlay = catalogOverlay({ base: portableCatalog });
		overlay.effective.subscribe(() => {});
		overlay.upsertFn("brandNewFn", sentinelEntry);
		overlay.applyPatch({ kind: "fn-delete", name: "filterBy" } as CatalogPatch);
		overlay.reset();
		const eff = snapshot(overlay.effective);
		expect(eff.fns?.filterBy).toBeDefined();
		expect(eff.fns?.brandNewFn).toBeUndefined();
		overlay.dispose();
	});
});

describe("catalogOverlay — templates", () => {
	it("effective templates expose base + overlay merge", () => {
		const overlay = catalogOverlay({ baseTemplates: portableTemplates });
		overlay.effectiveTemplates.subscribe(() => {});
		const before = overlay.effectiveTemplates.cache;
		expect(before).toBeDefined();
		expect(Object.keys(before ?? {}).length).toBe(Object.keys(portableTemplates).length);

		const newTpl = { params: ["x"], nodes: {}, output: "x" };
		overlay.upsertTemplate("brandNew", newTpl);
		const after = overlay.effectiveTemplates.cache;
		expect(after?.brandNew).toBe(newTpl);
		overlay.dispose();
	});
});

describe("catalogOverlay — reactive emission cadence", () => {
	it("effective emits a fresh snapshot on every patch", () => {
		const overlay = catalogOverlay({ base: portableCatalog });
		const seen: GraphSpecCatalog[] = [];
		overlay.effective.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) seen.push(m[1] as GraphSpecCatalog);
			}
		});
		// Initial subscription gives one DATA.
		const initialCount = seen.length;
		overlay.upsertFn("brandNewFn", sentinelEntry);
		overlay.upsertFn("anotherOne", sentinelEntry);
		// Each upsert should produce a new effective snapshot.
		expect(seen.length - initialCount).toBe(2);
		overlay.dispose();
	});
});
