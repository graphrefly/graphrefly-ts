import { defineConfig } from "tsup";

/**
 * @graphrefly/graphrefly — presentation layer build (cleave A3, 2026-05-14).
 *
 * Entry structure mirrors the 4-layer model:
 *   substrate → base → utils → presets → solutions (compat sits alongside)
 *
 * Browser-safety: presentation files may import from @graphrefly/pure-ts (external)
 * and from within src/. Node-only subpaths are identified in nodeOnlyEntries.
 * The universal entries must not transitively import node:* — validated by
 * assertBrowserSafeBundles in @graphrefly/pure-ts's tsup config; this config
 * relies on correct layer segregation (node-only behind node/ subpaths).
 */

const ENTRY_POINTS = [
	// Root barrel — substrate re-export + full presentation
	"src/index.ts",
	// Base layer
	"src/base/index.ts",
	"src/base/composition/index.ts",
	"src/base/io/index.ts",
	"src/base/meta/index.ts",
	"src/base/mutation/index.ts",
	"src/base/render/index.ts",
	"src/base/sources/index.ts",
	"src/base/sources/event/index.ts",
	"src/base/sources/node/index.ts", // Node-only
	"src/base/sources/browser/index.ts", // Browser-only
	"src/base/utils/index.ts",
	"src/base/worker/index.ts",
	// Utils layer
	"src/utils/index.ts",
	"src/utils/ai/index.ts",
	"src/utils/cqrs/index.ts",
	"src/utils/demo-shell/index.ts",
	"src/utils/domain-templates/index.ts",
	"src/utils/graphspec/index.ts",
	"src/utils/harness/index.ts",
	"src/utils/inspect/index.ts",
	"src/utils/job-queue/index.ts",
	"src/utils/memory/index.ts",
	"src/utils/messaging/index.ts",
	"src/utils/orchestration/index.ts",
	"src/utils/process/index.ts",
	"src/utils/reactive-layout/index.ts",
	"src/utils/reduction/index.ts",
	"src/utils/resilience/index.ts",
	"src/utils/surface/index.ts",
	"src/utils/topology-view/index.ts",
	// Presets layer
	"src/presets/index.ts",
	"src/presets/ai/index.ts",
	"src/presets/harness/index.ts",
	"src/presets/inspect/index.ts",
	"src/presets/resilience/index.ts",
	// Solutions layer
	"src/solutions/index.ts",
	// Compat — per-framework adapters
	"src/compat/index.ts",
	"src/compat/jotai/index.ts",
	"src/compat/nanostores/index.ts",
	"src/compat/nestjs/index.ts",
	"src/compat/react/index.ts",
	"src/compat/solid/index.ts",
	"src/compat/svelte/index.ts",
	"src/compat/vue/index.ts",
	"src/compat/zustand/index.ts",
	// AI platform subpaths (browser + node variants)
	"src/utils/ai/node.ts",
	"src/utils/ai/browser.ts",
];

export default defineConfig({
	entry: ENTRY_POINTS,
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: process.env.NODE_ENV !== "production",
	minify: process.env.NODE_ENV === "production",
	platform: "neutral",
	target: "es2022",
	external: [
		"@graphrefly/pure-ts",
		"@graphrefly/native",
		"@nestjs/common",
		"@nestjs/core",
		"@nestjs/microservices",
		"@nestjs/platform-express",
		"@nestjs/websockets",
		"rxjs",
		"reflect-metadata",
		"react",
		"react-dom",
		"vue",
		"solid-js",
		"svelte",
	],
});
