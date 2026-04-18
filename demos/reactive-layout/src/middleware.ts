// Redirect `/demos/reactive-layout` (no trailing slash) → `/demos/reactive-layout/`.
// Astro serves the page at both paths in dev, but the hydration island's module
// URL resolves against the page URL: without the trailing slash, Vite's base
// prefix gets clipped and `import("/src/components/App.tsx")` 404s. A 301 gets
// every user onto the path where island URLs resolve correctly.
import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware((context, next) => {
	const url = new URL(context.request.url);
	if (url.pathname === "/demos/reactive-layout") {
		url.pathname = "/demos/reactive-layout/";
		// Prefer the explicit Response constructor over `Response.redirect()` —
		// the Fetch spec's `init` for redirect() only accepts 301/302/303/307/308
		// as a second arg across runtimes, and the undici/Astro dev handler
		// sometimes narrows the accepted set further.
		return new Response(null, {
			status: 301,
			headers: { Location: url.toString() },
		});
	}
	return next();
});
