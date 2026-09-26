/**
 * Shared Utility Functions (ESM)
 * Common utilities used across multiple scripts.
 */

export function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

export function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i].trim();
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
    }
    return null;
}

export function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

if (typeof window !== 'undefined') {
    window.setCookie = setCookie;
    window.getCookie = getCookie;
    window.formatDateTime = formatDateTime;
}
