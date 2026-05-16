// Regression guard for the memo:Re P0: `@graphrefly/graphrefly` root + `/base`
// barrels must NOT transitively import rxjs (an optional peer that bricks
// RN/Hermes builds when absent). rxjs is allowed ONLY under the opt-in
// `src/compat/nestjs` subpath, where `@nestjs/common` pulls it legitimately.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) {
			// rxjs is allowed ONLY under compat/nestjs (where @nestjs/common
			// legitimately pulls it). Every OTHER compat/* adapter (react, vue,
			// solid, svelte, …) can be loaded by RN/Hermes and MUST stay
			// guarded — so recurse into compat/, skipping only compat/nestjs.
			const rel = p.replace(/\\/g, "/");
			if (name === "__tests__" || rel.endsWith("/compat/nestjs")) continue;
			out.push(...walk(p));
		} else if (p.endsWith(".ts")) {
			out.push(p);
		}
	}
	return out;
}

describe("no rxjs in the always-loaded presentation path (memo:Re P0)", () => {
	it("no src/ file outside compat/ references rxjs", () => {
		const offenders = walk(SRC).filter((f) => {
			// Strip comments so JSDoc usage examples (`import { from } from
			// 'rxjs'`) don't count — only real import/require statements do.
			const code = readFileSync(f, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			// Catch: `… from "rxjs"`, `require("rxjs")`, dynamic `import("rxjs")`,
			// and side-effect `import "rxjs"` — any path that re-introduces the
			// optional peer into the always-loaded barrel.
			return /\bfrom\s*["']rxjs["']|\brequire\(\s*["']rxjs["']\)|\bimport\s*\(\s*["']rxjs["']\s*\)|\bimport\s+["']rxjs["']/.test(
				code,
			);
		});
		expect(offenders).toEqual([]);
	});
});
