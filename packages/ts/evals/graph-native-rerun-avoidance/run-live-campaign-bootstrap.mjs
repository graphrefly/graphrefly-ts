import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRootEvalPrecredentialEnvironment } from "./precredential-environment.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const runner = fileURLToPath(new URL("./run-live-campaign.ts", import.meta.url));

const isolatedEnvironment = createRootEvalPrecredentialEnvironment(process.env);

await new Promise((resolvePromise, rejectPromise) => {
	const child = spawn(process.execPath, ["--import", "tsx", runner, ...process.argv.slice(2)], {
		cwd: repositoryRoot,
		env: isolatedEnvironment,
		stdio: "inherit",
		shell: false,
	});
	child.once("error", rejectPromise);
	child.once("close", (code, signal) => {
		if (code === 0) resolvePromise();
		else
			rejectPromise(new TypeError(`root eval D145 isolated live child failed (${signal ?? code})`));
	});
});
