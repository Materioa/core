/**
 * Materio Theme Engine
 * Manages theme detection, cookies, localStorage, system preference sync, and DOM classes.
 */

export function getCookie(name) {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    if (match) return match[2];
    try {
        return (typeof localStorage !== 'undefined') ? localStorage.getItem(name) : null;
    } catch {
        return null;
    }
}

export function setCookie(name, value, days = 365) {
    if (typeof document === 'undefined') return;
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = `${name}=${value || ""}${expires}; path=/; SameSite=Lax`;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(name, value || "");
        }
    } catch {}
}

export function resolveActualMode(theme) {
    const isPureLight = getCookie('pureLightMode') === 'true';
    const isCoffeeDark = getCookie('coffeeDarkMode') === 'true';

    let actualMode = theme || getCookie('theme') || 'system';

    if (actualMode === 'system') {
        if (isPureLight) {
            actualMode = 'light';
        } else if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            actualMode = 'dark';
        } else {
            const now = new Date();
            const current = now.getHours() * 60 + now.getMinutes();
            actualMode = (current >= 19 * 60 || current < 6 * 60 + 45) ? 'dark' : 'light';
        }
    } else if (actualMode === 'light' && isPureLight) {
        actualMode = 'light';
    } else if (actualMode === 'coffee') {
        actualMode = isCoffeeDark ? 'coffee-dark' : 'coffee';
    }

    return actualMode;
}

export function initTheme() {
    if (typeof document === 'undefined') return 'system';

    const savedTheme = getCookie('theme') || 'system';
    const actualMode = resolveActualMode(savedTheme);
    const isDark = (actualMode === 'dark' || actualMode === 'coffee-dark' || actualMode === 'amoled');

    const targets = [document.documentElement];
    if (document.body) targets.push(document.body);

    targets.forEach(el => {
        if (isDark) {
            el.classList.add('dark-mode');
            el.classList.remove('light-mode', 'coffee-mode');
            if (actualMode === 'coffee-dark') {
                el.classList.add('coffee-dark-mode');
                el.classList.remove('amoled-mode');
            } else if (actualMode === 'amoled') {
                el.classList.add('amoled-mode');
                el.classList.remove('coffee-dark-mode');
            } else {
                el.classList.remove('coffee-dark-mode', 'amoled-mode');
            }
        } else {
            el.classList.remove('dark-mode', 'coffee-dark-mode', 'amoled-mode');
            if (actualMode === 'coffee') {
                el.classList.add('coffee-mode');
                el.classList.remove('light-mode');
            } else {
                el.classList.add('light-mode');
                el.classList.remove('coffee-mode');
            }
        }
    });

    const metaThemeColor = document.querySelector('meta[name=theme-color]');
    if (metaThemeColor) {
        if (actualMode === 'dark' || actualMode === 'coffee-dark' || actualMode === 'amoled') {
            metaThemeColor.setAttribute('content', actualMode === 'coffee-dark' ? '#1c1510' : '#121212');
        } else if (actualMode === 'coffee') {
            metaThemeColor.setAttribute('content', '#fdf6e3');
        } else {
            metaThemeColor.setAttribute('content', '#faf9f5');
        }
    }

    return actualMode;
}

// Immediately initialize if running in browser
if (typeof document !== 'undefined') {
    initTheme();
}
