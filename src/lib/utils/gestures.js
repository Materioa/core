export function triggerHapticFeedback(pattern = [15]) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {}
    }
}

export function registerSwipeGesture(element, onSwipeLeft, onSwipeRight) {
    let startX = 0;
    let startY = 0;

    const handleTouchStart = (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e) => {
        const diffX = e.changedTouches[0].clientX - startX;
        const diffY = e.changedTouches[0].clientY - startY;

        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            if (diffX > 0 && onSwipeRight) {
                triggerHapticFeedback();
                onSwipeRight();
            } else if (diffX < 0 && onSwipeLeft) {
                triggerHapticFeedback();
                onSwipeLeft();
            }
        }
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
        element.removeEventListener('touchstart', handleTouchStart);
        element.removeEventListener('touchend', handleTouchEnd);
    };
}
