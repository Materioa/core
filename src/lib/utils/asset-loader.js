/**
 * On-demand Asset Loader for heavy libraries (KaTeX, Highlight.js, Mermaid).
 * Loads assets only when specific pages/modals (notebooks, articles) require them.
 */

let katexPromise = null;
export function loadKatex() {
    if (typeof window === 'undefined') return Promise.resolve();
    if (window.renderMathInElement && window.katex) return Promise.resolve();
    if (katexPromise) return katexPromise;

    katexPromise = new Promise((resolve) => {
        if (!document.querySelector('link[href*="katex.min.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css';
            document.head.appendChild(link);
        }

        const s1 = document.createElement('script');
        s1.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js';
        s1.defer = true;
        s1.onload = () => {
            const s2 = document.createElement('script');
            s2.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js';
            s2.defer = true;
            s2.onload = () => resolve();
            s2.onerror = () => resolve();
            document.head.appendChild(s2);
        };
        s1.onerror = () => resolve();
        document.head.appendChild(s1);
    });

    return katexPromise;
}

let hljsPromise = null;
export function loadHighlightJs() {
    if (typeof window === 'undefined') return Promise.resolve();
    if (window.hljs) return Promise.resolve();
    if (hljsPromise) return hljsPromise;

    hljsPromise = new Promise((resolve) => {
        if (!document.querySelector('#highlight-theme') && !document.querySelector('link[href*="highlight.js"]')) {
            const link = document.createElement('link');
            link.id = 'highlight-theme';
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/github-dark.min.css';
            document.head.appendChild(link);
        }

        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js';
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = () => resolve();
        document.head.appendChild(s);
    });

    return hljsPromise;
}

let mermaidPromise = null;
export function loadMermaid() {
    if (typeof window === 'undefined') return Promise.resolve();
    if (window.mermaid) return Promise.resolve();
    if (mermaidPromise) return mermaidPromise;

    mermaidPromise = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js';
        s.defer = true;
        s.onload = () => {
            if (window.mermaid) {
                try {
                    const isDark = document.body?.classList.contains('dark-mode') || document.documentElement?.classList.contains('dark-mode');
                    window.mermaid.initialize({
                        startOnLoad: false,
                        theme: isDark ? 'dark' : 'default'
                    });
                } catch {}
            }
            resolve();
        };
        s.onerror = () => resolve();
        document.head.appendChild(s);
    });

    return mermaidPromise;
}

/**
 * Loads all notebook-related heavy dependencies on-demand.
 */
export async function loadNotebookAssets() {
    await Promise.all([loadKatex(), loadHighlightJs(), loadMermaid()]);
}

/**
 * Renders syntax highlighting and math formulas on a container element.
 */
export function renderFormulasAndCode(container) {
    if (!container || typeof window === 'undefined') return;

    if (window.hljs) {
        container.querySelectorAll('pre code').forEach((block) => {
            try {
                window.hljs.highlightElement(block);
            } catch {}
        });
    }

    if (window.renderMathInElement) {
        try {
            // The live editor keeps its raw text on purpose — typing into
            // rendered KaTeX output would fight the caret — so it is skipped
            // here. The read-only view pane deliberately does NOT carry that
            // class, which is what lets LaTeX render when reading a note.
            window.renderMathInElement(container, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    // The notebook toolbar inserts \( \) (KaTeX's own default),
                    // while prose written by hand tends to use $.
                    { left: '\\(', right: '\\)', display: false },
                    { left: '$', right: '$', display: false },
                    { left: '\\[', right: '\\]', display: true }
                ],
                ignoredClasses: ['notebook-editor'],
                ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
                throwOnError: false
            });
        } catch {}
    }

    if (window.mermaid) {
        try {
            window.mermaid.init(undefined, container.querySelectorAll('.mermaid, .mermaid-diagram'));
        } catch {}
    }
}
