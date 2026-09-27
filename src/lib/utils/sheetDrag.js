/**
 * Shared bottom-sheet drag gesture for the Android app (and narrow mobile web).
 *
 * Behaviour (matches the promo modal):
 * - Engages only on small viewports, and only when the gesture starts on the
 *   drag handle OR the sheet is scrolled to the top (so scrolling content
 *   never accidentally dismisses the sheet).
 * - The sheet follows the finger with resistance; the overlay dims.
 * - On release, a long-enough or fast-enough downward drag closes the sheet
 *   via `onClose`; otherwise it springs back.
 *
 * Usage:
 *   const detach = attachSheetDrag({ sheet, overlay, onClose, handleSelector });
 *   // ... detach() on destroy
 */

export function attachSheetDrag({ sheet, overlay = null, onClose, handleSelector = null, breakpoint = 500, threshold = 90, velocityThreshold = 0.45 } = {}) {
	if (!sheet || typeof onClose !== 'function') return () => {};
	if (typeof window === 'undefined') return () => {};

	let startY = 0;
	let currentY = 0;
	let startTime = 0;
	let dragging = false;
	let engaged = false;

	const isNarrow = () => window.innerWidth <= breakpoint;

	function scrolledToTop() {
		try {
			// The sheet itself or its first scrollable child.
			if (sheet.scrollTop <= 8) return true;
			const scroller = sheet.querySelector('[data-sheet-scroll]');
			if (scroller && scroller.scrollTop <= 8) return true;
			return false;
		} catch {
			return true;
		}
	}

	function startedOnHandle(e) {
		if (!handleSelector) return false;
		try {
			const t = e.touches && e.touches[0];
			if (!t) return false;
			const el = document.elementFromPoint(t.clientX, t.clientY);
			return !!(el && el.closest && el.closest(handleSelector));
		} catch {
			return false;
		}
	}

	function onStart(e) {
		if (!isNarrow()) return;
		const t = e.touches && e.touches[0];
		if (!t) return;
		// Engage on the handle, or anywhere while scrolled to top.
		engaged = startedOnHandle(e) || scrolledToTop();
		if (!engaged) return;
		startY = t.clientY;
		currentY = t.clientY;
		startTime = Date.now();
		dragging = true;
		sheet.style.transition = 'none';
		sheet.style.willChange = 'transform';
	}

	function onMove(e) {
		if (!dragging || !engaged) return;
		const t = e.touches && e.touches[0];
		if (!t) return;
		currentY = t.clientY;
		const deltaY = currentY - startY;
		if (deltaY > 0) {
			sheet.style.transform = `translateY(${deltaY * 0.6}px)`;
			if (overlay) {
				const opacity = Math.max(0.15, 1 - deltaY / 320);
				overlay.style.backgroundColor = `rgba(0, 0, 0, ${0.5 * opacity})`;
			}
			if (e.cancelable) e.preventDefault();
		} else {
			// Dragged back up past the start — cancel the gesture.
			dragging = false;
			engaged = false;
			sheet.style.transform = '';
			sheet.style.willChange = '';
			if (overlay) overlay.style.backgroundColor = '';
		}
	}

	function onEnd() {
		if (!dragging || !engaged) {
			dragging = false;
			engaged = false;
			return;
		}
		const deltaY = currentY - startY;
		const elapsed = Date.now() - startTime;
		const velocity = deltaY / (elapsed || 1);
		sheet.style.transition = 'transform 0.38s cubic-bezier(0.32, 0.72, 0, 1)';
		if (overlay) overlay.style.transition = 'background-color 0.38s cubic-bezier(0.32, 0.72, 0, 1)';
		const dismiss = deltaY > threshold || velocity > velocityThreshold;
		if (dismiss) {
			sheet.style.transform = 'translateY(105%)';
			if (overlay) overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
			const done = () => {
				sheet.style.transform = '';
				sheet.style.transition = '';
				sheet.style.willChange = '';
				if (overlay) {
					overlay.style.backgroundColor = '';
					overlay.style.transition = '';
				}
				onClose();
			};
			setTimeout(done, 380);
		} else {
			sheet.style.transform = 'translateY(0)';
			if (overlay) overlay.style.backgroundColor = '';
			setTimeout(() => {
				sheet.style.transform = '';
				sheet.style.transition = '';
				sheet.style.willChange = '';
				if (overlay) overlay.style.transition = '';
			}, 380);
		}
		dragging = false;
		engaged = false;
		startY = 0;
		currentY = 0;
	}

	sheet.addEventListener('touchstart', onStart, { passive: true });
	sheet.addEventListener('touchmove', onMove, { passive: false });
	sheet.addEventListener('touchend', onEnd, { passive: true });
	sheet.addEventListener('touchcancel', onEnd, { passive: true });

	return () => {
		try {
			sheet.removeEventListener('touchstart', onStart);
			sheet.removeEventListener('touchmove', onMove);
			sheet.removeEventListener('touchend', onEnd);
			sheet.removeEventListener('touchcancel', onEnd);
		} catch {}
	};
}
