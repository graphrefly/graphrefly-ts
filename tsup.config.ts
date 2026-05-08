import { defineConfig } from "tsup";

// Phase 13.9.A shim build — `@graphrefly/graphrefly` is a thin re-export layer
// over `@graphrefly/pure-ts`. Each entry is a one-liner `export *`. The
// browser-safety guardrail lives in the legacy package's tsup config; the shim
// doesn't introduce any imports of its own beyond the external legacy package,
// so node:* leakage cannot originate here.
//
// When `@graphrefly/native` (napi binding) publishes and per-Rust-milestone
// swap-overs land, this config grows to include conditional native loading.
// Until then, every entry just re-exports.

const ENTRY_POINTS = [
	"src/index.ts",
	"src/core/index.ts",
	"src/testing/index.ts",
	"src/extra/index.ts",
	"src/extra/node.ts",
	"src/extra/browser.ts",
	"src/extra/sources.ts",
	"src/extra/operators.ts",
	"src/extra/reactive.ts",
	"src/extra/storage-core.ts",
	"src/extra/storage-node.ts",
	"src/extra/storage-browser.ts",
	"src/extra/storage-tiers.ts",
	"src/extra/storage-tiers-node.ts",
	"src/extra/storage-tiers-browser.ts",
	"src/extra/render/index.ts",
	"src/graph/index.ts",
	"src/compat/index.ts",
	"src/compat/jotai/index.ts",
	"src/compat/nanostores/index.ts",
	"src/compat/zustand/index.ts",
	"src/compat/react/index.ts",
	"src/compat/vue/index.ts",
	"src/compat/solid/index.ts",
	"src/compat/svelte/index.ts",
	"src/compat/nestjs/index.ts",
	"src/patterns/ai/index.ts",
	"src/patterns/ai/node.ts",
	"src/patterns/ai/browser.ts",
	"src/patterns/cqrs/index.ts",
	"src/patterns/demo-shell/index.ts",
	"src/patterns/domain-templates/index.ts",
	"src/patterns/graphspec/index.ts",
	"src/patterns/harness/index.ts",
	"src/patterns/inspect/index.ts",
	"src/patterns/job-queue/index.ts",
	"src/patterns/memory/index.ts",
	"src/patterns/messaging/index.ts",
	"src/patterns/orchestration/index.ts",
	"src/patterns/process/index.ts",
	"src/patterns/reactive-layout/index.ts",
	"src/patterns/reduction/index.ts",
	"src/patterns/surface/index.ts",
	"src/patterns/topology-view/index.ts",
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
