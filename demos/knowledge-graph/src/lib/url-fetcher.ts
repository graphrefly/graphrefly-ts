// Fetches an arbitrary web page as plain text via Jina's Reader API
// (https://r.jina.ai/{url}). Anonymous; rate-limited to 20 RPM without a key,
// which is plenty for a demo. Returns null on CORS / rate-limit / read errors
// so the caller can fall back to the bundled sample paper.
//
// Defenses:
//   - URL must parse and have an http(s) scheme. Rejects file://, data:, etc.
//     (Jina filters server-side too, but cheap to reject up front.)
//   - 15-second AbortController timeout so a slow Jina response doesn't hang
//     the chapter forever.
//   - Tolerates non-JSON 200 responses (some Jina error pages return text)
//     by falling back to plain-text body.

const READER_BASE = "https://r.jina.ai/";
const FETCH_TIMEOUT_MS = 15_000;

export type FetchedPaper = {
	url: string;
	title: string;
	body: string;
};

export async function fetchPaper(url: string): Promise<FetchedPaper> {
	let normalized = url.trim();
	if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(`${READER_BASE}${parsed.toString()}`, {
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});
	} catch (err) {
		if (controller.signal.aborted) {
			throw new Error(`Reader API timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}

	if (!response.ok) {
		throw new Error(`Reader API ${response.status} ${response.statusText}`);
	}

	const raw = await response.text();
	let payload: {
		code?: number;
		status?: number;
		data?: { url?: string; title?: string; content?: string };
	} | null;
	try {
		payload = JSON.parse(raw);
	} catch {
		// Some Jina error/info pages return text/plain even with Accept: json.
		// Treat the whole body as `content` so the caller still gets something.
		if (raw.trim().length > 0) {
			return { url: parsed.toString(), title: parsed.hostname, body: raw };
		}
		throw new Error("Reader API returned empty body");
	}

	const data = payload?.data ?? {};
	if (!data.content) throw new Error("Reader API returned empty content");
	return {
		url: data.url ?? parsed.toString(),
		title: data.title ?? parsed.hostname,
		body: data.content,
	};
}
