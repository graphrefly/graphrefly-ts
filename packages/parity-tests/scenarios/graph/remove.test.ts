/**
 * R3.2.3 / R3.7.3 — `await g.remove(name)` namespace-during-cascade ordering.
 *
 * Sinks observing the TEARDOWN cascade must still resolve `name_of(node)`
 * mid-cascade — namespace clears AFTER the teardown fires, not before.
 *
 * Rust port reference: `Graph::remove` (Slice F R3.2.3) + Slice F /qa P1
 * (`remove_preserves_namespace_during_teardown_cascade`).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.2.3 remove parity — $name", (impl) => {
	test("remove(name) emits TEARDOWN and clears the namespace", async () => {
		const g = new impl.Graph("root");
		const s = await g.state<number>("temp", 0);

		const seen: symbol[] = [];
		const unsub = await s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		seen.length = 0;
		await g.remove("temp");

		expect(seen).toContain(impl.TEARDOWN);
		// Post-remove, the name no longer resolves.
		// D267: `tryResolve` widened to `T | Promise<T>` — `await`
		// is identity on the pure-ts sync return.
		expect(await g.tryResolve("temp")).toBeUndefined();

		await unsub();
		await g.destroy();
	});

	test("remove() of a mounted subgraph delegates to unmount + cascades teardown", async () => {
		const g = new impl.Graph("root");
		const child = await g.mount("child");
		const c = await child.state<number>("inner", 1);

		const seen: symbol[] = [];
		const unsub = await c.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		seen.length = 0;
		await g.remove("child");

		expect(seen).toContain(impl.TEARDOWN);
		expect(await g.tryResolve("child::inner")).toBeUndefined();

		await unsub();
		await g.destroy();
	});

	// Slice W (2026-05-13): pure-ts backported to clear namespace AFTER
	// TEARDOWN cascade, matching Rust port's Slice F /qa P1 and canonical
	// R3.7.3 ("After cascade, graph internal registries are cleared").
	//
	// D267 (2026-05-21): `nameOf` widened to `T | Promise<T>`. The
	// rust-via-napi arm returns sync via a JS-side reverse cache for
	// nodes JS owns, preserving sync-observability inside the TEARDOWN
	// sink cross-arm. The captured `nameDuringTeardown` may be a
	// string (sync return) or a Promise<string|undefined> (slow path);
	// `await` it either way.
	test("namespace remains resolvable from inside the TEARDOWN sink (R3.7.3 ordering)", async () => {
		const g = new impl.Graph("root");
		const s = await g.state<number>("ephemeral", 0);

		let nameDuringTeardown: string | undefined | Promise<string | undefined>;
		const unsub = await s.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.TEARDOWN) {
					nameDuringTeardown = g.nameOf(s);
				}
			}
		});

		await g.remove("ephemeral");

		expect(await nameDuringTeardown).toBe("ephemeral");
		expect(await g.nameOf(s)).toBeUndefined();

		await unsub();
		await g.destroy();
	});
});
