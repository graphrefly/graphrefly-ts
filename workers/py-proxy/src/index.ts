/**
 * Cloudflare Worker: proxy /py/* requests to graphrefly-py GitHub Pages.
 *
 * graphrefly.dev/py/api/node  →  graphrefly.github.io/graphrefly-py/api/node
 *
 * Astro builds with base=/py/ so HTML references include /py/ in URLs,
 * but the output directory structure does NOT contain a /py/ subdirectory.
 * We strip the /py prefix before forwarding to GitHub Pages.
 */
export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (!url.pathname.startsWith("/py")) {
			// Should not happen (route filter), but be safe
			return fetch(request);
		}

		// Strip /py prefix — Astro base=/py/ affects URLs, not output dirs
		const upstreamPath = url.pathname.replace(/^\/py/, "") || "/";
		const upstream = `https://graphrefly.github.io/graphrefly-py${upstreamPath}${url.search}`;

		const resp = await fetch(upstream, {
			method: request.method,
			headers: {
				Accept: request.headers.get("Accept") ?? "*/*",
				"User-Agent": "graphrefly-py-proxy",
			},
			redirect: "follow",
		});

		// Clone headers, override cache for HTML (short), cache assets longer
		const headers = new Headers(resp.headers);
		headers.set("X-Proxy", "graphrefly-py-proxy");

		const ct = headers.get("Content-Type") ?? "";
		if (ct.includes("text/html")) {
			headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
		} else {
			headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
		}

		return new Response(resp.body, {
			status: resp.status,
			headers,
		});
	},
};
