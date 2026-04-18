// Pan + zoom for the mermaid graph container. Framework-agnostic DOM helper —
// each framework mounts it once (useEffect / onMount / createEffect / $effect)
// against the `.mermaid-graph` element and calls the returned cleanup on
// unmount. Pan/zoom is pure DOM interaction — no framework state involved —
// so sharing the helper is cleaner than duplicating 60 lines of listener
// wiring across React/Vue/Solid/Svelte.
//
// Controls: wheel zooms toward cursor, drag pans, double-click resets.

export function attachPanZoom(container: HTMLElement): () => void {
	let scale = 1;
	let tx = 0;
	let ty = 0;
	let dragging = false;
	let lastX = 0;
	let lastY = 0;

	const applyTransform = () => {
		const svg = container.querySelector("svg") as (SVGElement & { style: CSSStyleDeclaration }) | null;
		if (!svg) return;
		svg.style.transformOrigin = "0 0";
		svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
	};

	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		const rect = container.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		// Zoom around cursor: keep the point under the pointer fixed.
		tx = mx - (mx - tx) * factor;
		ty = my - (my - ty) * factor;
		scale = Math.max(0.1, Math.min(10, scale * factor));
		applyTransform();
	};

	const onPointerDown = (e: PointerEvent) => {
		// Left-click + drag pans. Ignore other buttons so the browser's
		// native context menu / middle-click-autoscroll still work.
		if (e.button !== 0) return;
		dragging = true;
		lastX = e.clientX;
		lastY = e.clientY;
		container.setPointerCapture(e.pointerId);
		container.style.cursor = "grabbing";
	};

	const onPointerMove = (e: PointerEvent) => {
		if (!dragging) return;
		tx += e.clientX - lastX;
		ty += e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;
		applyTransform();
	};

	const onPointerUp = (e: PointerEvent) => {
		if (!dragging) return;
		dragging = false;
		try {
			container.releasePointerCapture(e.pointerId);
		} catch {
			// pointer capture may have already been released (e.g. leaving the window)
		}
		container.style.cursor = "grab";
	};

	const onDoubleClick = () => {
		scale = 1;
		tx = 0;
		ty = 0;
		applyTransform();
	};

	container.addEventListener("wheel", onWheel, { passive: false });
	container.addEventListener("pointerdown", onPointerDown);
	container.addEventListener("pointermove", onPointerMove);
	container.addEventListener("pointerup", onPointerUp);
	container.addEventListener("pointercancel", onPointerUp);
	container.addEventListener("dblclick", onDoubleClick);
	container.style.cursor = "grab";
	container.style.touchAction = "none";

	// Mermaid re-renders replace the SVG inside the container. Reapply the
	// current transform to the new SVG so pan/zoom state survives re-renders.
	const observer = new MutationObserver(() => applyTransform());
	observer.observe(container, { childList: true });

	return () => {
		container.removeEventListener("wheel", onWheel);
		container.removeEventListener("pointerdown", onPointerDown);
		container.removeEventListener("pointermove", onPointerMove);
		container.removeEventListener("pointerup", onPointerUp);
		container.removeEventListener("pointercancel", onPointerUp);
		container.removeEventListener("dblclick", onDoubleClick);
		observer.disconnect();
		container.style.cursor = "";
		container.style.touchAction = "";
	};
}
