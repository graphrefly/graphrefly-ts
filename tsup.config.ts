import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/core/index.ts",
		"src/extra/index.ts",
		"src/graph/index.ts",
		"src/compat/nestjs/index.ts",
		"src/patterns/reactive-layout/index.ts",
	],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
	external: [
		"@nestjs/common",
		"@nestjs/core",
		"@nestjs/microservices",
		"@nestjs/platform-express",
		"@nestjs/websockets",
		"rxjs",
		"reflect-metadata",
	],
});
