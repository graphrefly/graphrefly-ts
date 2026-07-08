import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const RESULT_START = "__GRAPHREFLY_AGENTIC_MEMORY_IDB_SMOKE__";
const RESULT_END = "__GRAPHREFLY_AGENTIC_MEMORY_IDB_SMOKE_END__";
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entry = join(repoRoot, "scripts/browser-smoke/agentic-memory-indexeddb-smoke.ts");
const chromeCandidates = [
	process.env.CHROME_BIN,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"google-chrome",
	"google-chrome-stable",
	"chrome",
	"chromium",
	"chromium-browser",
].filter(Boolean);

async function findChrome() {
	for (const candidate of chromeCandidates) {
		try {
			await execFileAsync(candidate, ["--version"], { timeout: 5000 });
			return candidate;
		} catch {
			// Try the next common Chrome executable name/path.
		}
	}
	throw new Error("Could not find Chrome/Chromium. Set CHROME_BIN to run the browser smoke.");
}

function decodeResult(dom) {
	const start = dom.indexOf(RESULT_START);
	const end = dom.indexOf(RESULT_END, start + RESULT_START.length);
	if (start === -1 || end === -1) {
		throw new Error(`Browser smoke did not emit a result marker.\n${dom}`);
	}
	const encoded = dom.slice(start + RESULT_START.length, end).trim();
	const text = Buffer.from(encoded, "base64").toString("utf8");
	return JSON.parse(text);
}

function waitForDevtoolsEndpoint(chrome) {
	return new Promise((resolve, reject) => {
		let stderr = "";
		const timeout = setTimeout(() => {
			reject(new Error(`Timed out waiting for Chrome DevTools endpoint.\n${stderr}`));
		}, 10000);
		chrome.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
			const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (match) {
				clearTimeout(timeout);
				resolve(match[1]);
			}
		});
		chrome.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		chrome.on("exit", (code, signal) => {
			clearTimeout(timeout);
			reject(new Error(`Chrome exited before DevTools was ready: code=${code} signal=${signal}`));
		});
	});
}

async function firstPageWebSocket(browserWsUrl) {
	const url = new URL(browserWsUrl);
	const listUrl = `http://${url.host}/json/list`;
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const res = await fetch(listUrl);
		const targets = await res.json();
		const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
		if (page) return page.webSocketDebuggerUrl;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Chrome DevTools did not expose a page target");
}

function connectPage(wsUrl) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		const callbacks = new Map();
		let nextId = 0;
		ws.addEventListener("open", () => {
			const send = (method, params = {}) =>
				new Promise((sendResolve, sendReject) => {
					const id = ++nextId;
					callbacks.set(id, { resolve: sendResolve, reject: sendReject });
					ws.send(JSON.stringify({ id, method, params }));
				});
			ws.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.id !== undefined) {
					const callback = callbacks.get(message.id);
					if (callback) {
						callbacks.delete(message.id);
						if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
						else callback.resolve(message.result);
					}
				}
			});
			resolve({ ws, send });
		});
		ws.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket failed")));
	});
}

function stopChrome(child) {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			resolve();
		}, 5000);
		child.once("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
		child.kill("SIGTERM");
	});
}

async function runInChrome(chrome, htmlPath, profileDir) {
	const child = spawn(
		chrome,
		[
			"--headless=new",
			"--disable-gpu",
			"--no-first-run",
			"--no-default-browser-check",
			"--remote-debugging-port=0",
			`--user-data-dir=${profileDir}`,
			"about:blank",
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	try {
		const browserWs = await waitForDevtoolsEndpoint(child);
		const pageWs = await firstPageWebSocket(browserWs);
		const page = await connectPage(pageWs);
		const resultPromise = new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("Timed out waiting for browser smoke result")),
				30000,
			);
			const fail = (error) => {
				clearTimeout(timeout);
				reject(error);
			};
			page.ws.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.method === "Runtime.exceptionThrown") {
					const details = message.params.exceptionDetails;
					fail(new Error(`Browser smoke exception: ${details.text ?? JSON.stringify(details)}`));
					return;
				}
				if (message.method === "Page.loadEventFired") return;
				if (message.method !== "Runtime.consoleAPICalled") return;
				const text = message.params.args
					.map((arg) => (typeof arg.value === "string" ? arg.value : ""))
					.join(" ");
				if (!text.includes(RESULT_START)) return;
				clearTimeout(timeout);
				try {
					resolve(decodeResult(text));
				} catch (error) {
					reject(error);
				}
			});
		});
		await page.send("Runtime.enable");
		await page.send("Page.enable");
		const navigation = await page.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
		if (navigation.errorText) {
			throw new Error(`Browser smoke navigation failed: ${navigation.errorText}`);
		}
		return await resultPromise;
	} finally {
		await stopChrome(child);
	}
}

const tempDir = await mkdtemp(join(tmpdir(), "graphrefly-idb-smoke-"));
let exitCode = 0;
try {
	const bundlePath = join(tempDir, "agentic-memory-indexeddb-smoke.js");
	const htmlPath = join(tempDir, "index.html");
	const profileDir = join(tempDir, "chrome-profile");
	await build({
		entryPoints: [entry],
		outfile: bundlePath,
		bundle: true,
		format: "iife",
		platform: "browser",
		target: "chrome120",
		logLevel: "silent",
	});
	await writeFile(
		htmlPath,
		`<!doctype html><html><head><meta charset="utf-8"><title>GraphReFly IndexedDB smoke</title></head><body><script src="./agentic-memory-indexeddb-smoke.js"></script></body></html>`,
	);
	const chrome = await findChrome();
	const result = await runInChrome(chrome, htmlPath, profileDir);
	if (!result.ok) {
		console.error("agentic-memory IndexedDB browser smoke failed:");
		console.error(result.error);
		if (result.stack) console.error(result.stack);
		exitCode = 1;
	} else {
		console.log("agentic-memory IndexedDB browser smoke passed");
		console.log(JSON.stringify(result, null, 2));
	}
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
process.exitCode = exitCode;
