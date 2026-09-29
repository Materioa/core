import { writable } from 'svelte/store';

// Global Search Term Store
export const searchTerm = writable('');

// Active Navigation Tab Store ('home', 'notifications', 'leaderboard', 'notebooks')
export const activeTab = writable('home');

function getCookie(name) {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    if (match) return match[2];
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem(name);
        }
    } catch {}
    return null;
}

function getInitialTheme() {
    let theme = getCookie('theme') || 'system';
    if (theme === 'true' || theme === 'false') {
        theme = theme === 'true' ? 'dark' : 'light';
    }
    return theme;
}

function resolveInitialActualTheme(mode) {
    if (typeof document === 'undefined') return 'dark';
    if (mode === 'system') {
        if (getCookie('pureLightMode') === 'true') return 'light';
        if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        const now = new Date();
        const current = now.getHours() * 60 + now.getMinutes();
        return (current >= 19 * 60 || current < 6 * 60 + 45) ? 'dark' : 'light';
    }
    if (mode === 'coffee') {
        return (getCookie('coffeeDarkMode') === 'true') ? 'coffee-dark' : 'coffee';
    }
    return mode;
}

const initialTheme = getInitialTheme();
// Theme Store ('system', 'dark', 'light', 'coffee', 'amoled')
export const themeStore = writable(initialTheme);

// Actual Theme Store ('dark', 'light', 'coffee', 'coffee-dark', 'amoled')
export const actualThemeStore = writable(resolveInitialActualTheme(initialTheme));

// PDF Reader Modal State Store
export const pdfModalStore = writable({
    isOpen: false,
    pdfUrl: '',
    title: '',
    semester: '',
    subject: '',
    category: '',
    topic: '',
    readingMode: 'default', // 'default', 'paper', 'night', 'eink'
    isBookmarked: false
});

/**
 * Open PDF viewer modal with the given URL and optional metadata
 * @param {string} pdfUrl 
 * @param {object} metadata 
 */
export function openPdfModal(pdfUrl, metadata = {}) {
    if (!pdfUrl) return;

    let semester = metadata.semester || '';
    let subject = metadata.subject || '';
    let topic = metadata.topic || '';
    let title = metadata.title || '';

    // If metadata not provided, parse from URL
    if (!title) {
        try {
            const u = new URL(pdfUrl, 'https://cdn.getmaterio.app');
            const parts = u.pathname.split('/').filter(Boolean); // e.g. ['pdfs', '3', 'Data_Structures', 'Trees.pdf']
            if (parts.length >= 4 && parts[0] === 'pdfs') {
                semester = semester || parts[1];
                subject = subject || decodeURIComponent(parts[2]).replace(/[-_]/g, ' ');
                topic = topic || decodeURIComponent(parts[parts.length - 1]).replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
                title = topic;
            } else {
                const filename = parts.pop() || 'Document';
                title = decodeURIComponent(filename).replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
                topic = title;
            }
        } catch {
            title = 'Document';
            topic = title;
        }
    }

    if (typeof window !== 'undefined') {
        window.materioCurrentPdfUrl = pdfUrl;
        window.openPdfModal = openPdfModal;
        window.loadPdfWithCache = (url, meta) => openPdfModal(url, meta);
    }

    pdfModalStore.set({
        isOpen: true,
        pdfUrl,
        title: title || 'Document',
        semester,
        subject,
        category: metadata.category || '',
        topic: topic || title || 'Document',
        readingMode: metadata.readingMode || 'default',
        isBookmarked: false
    });
}

if (typeof window !== 'undefined') {
    window.openPdfModal = openPdfModal;
    window.loadPdfWithCache = (url, meta) => openPdfModal(url, meta);
}

// Bookmarks / Offline PDFs Store
export const bookmarksStore = writable([]);

// Active Global Modal Store ('bug-report', 'contribute', 'ai-chat', 'seating-lookup', 'syllabus', null)
export const activeModalStore = writable(null);

// Notifications Store
export const notificationsStore = writable({
    unreadCount: 0,
    items: []
});

// Desktop (Tauri) update availability — set by AppUpdateModal when a newer
// Windows build is found; the navbar shows an update button while true and
// hides it again once the update starts/finishes. App-only, never on web.
export const desktopUpdateStore = writable({
    available: false,
    version: ''
});

// Search Results Modal Store (parent: #searchResultsModal)
export const searchModalStore = writable({
    isOpen: false,
    query: '',
    results: [],
    ai: null,
    aiUsed: false,
    isAiLoading: false,
    isDiscovery: false
});
