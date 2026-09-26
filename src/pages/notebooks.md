---
layout: default
title: My Notebooks
permalink: /pages/notebooks
---

<div class="notebooks-page-container">
    <div class="notebooks-header">
        <h1>My Notebooks</h1>
        <div class="notebooks-actions">
            <button class="site-button" onclick="createNewNotebook(true)">
                <i class="fas fa-plus"></i> New Note
            </button>
            <button class="site-button secondary" onclick="syncNotebooks()" id="syncBtn" style="display: none;">
                <i class="fas fa-sync"></i> Sync
            </button>
        </div>
    </div>

    <!-- Notebooks Grid -->
    <div id="notebooksGrid" class="notebooks-grid">
        <!-- Notebook cards will be populated here -->
        <div class="notebook-loading">
            <i class="fa-regular fa-loader fa-spin"></i> Loading notebooks...
        </div>
    </div>

    <!-- Empty State -->
    <div id="emptyState" class="notebooks-empty" style="display: none;">
        <div class="empty-icon">
            <i class="far fa-notebook"></i>
        </div>
        <h3>No notebooks yet</h3>
        <p>Create your first note to get started.</p>
        <button class="site-button" onclick="createNewNotebook(true)">Create Note</button>
    </div>
</div>

<style>
    .notebooks-page-container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 40px 20px;
        min-height: 80vh;
    }

    .notebooks-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 30px;
    }

    .notebooks-header h1 {
        font-size: 2rem;
        color: var(--text-color);
        margin: 0;
    }

    .notebooks-actions {
        display: flex;
        gap: 12px;
    }

    .notebooks-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 24px;
    }

    .notebook-card {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        padding: 20px;
        cursor: pointer;
        transition: all 0.3s ease;
        position: relative;
        display: flex;
        flex-direction: column;
        height: 200px;
    }

    .notebook-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
        border-color: var(--primary-color);
    }

    .notebook-card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;
    }

    .notebook-title {
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--text-color);
        margin: 0;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .notebook-date {
        font-size: 0.85rem;
        color: var(--text-secondary);
        margin-top: auto;
    }

    .notebook-preview {
        font-size: 0.9rem;
        color: var(--text-secondary);
        line-height: 1.5;
        flex-grow: 1;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        margin-bottom: 12px;
    }

    .notebook-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 12px;
        font-size: 0.85rem;
    }

    .notebook-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(var(--primary-rgb), 0.1);
        color: var(--primary-color);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 0.8rem;
    }

    .notebook-actions-dropdown {
        position: absolute;
        top: 16px;
        right: 16px;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .notebook-card:hover .notebook-actions-dropdown {
        opacity: 1;
    }

    .notebook-loading {
        grid-column: 1 / -1;
        text-align: center;
        padding: 40px;
        color: var(--text-secondary);
        font-size: 1.1rem;
    }

    .notebooks-empty {
        text-align: center;
        padding: 60px 20px;
        background: var(--bg-secondary);
        border-radius: 16px;
        border: 2px dashed var(--border-color);
    }

    .empty-icon {
        font-size: 4rem;
        color: var(--text-secondary);
        margin-bottom: 20px;
        opacity: 0.5;
    }

    /* Dark mode adjustments */
    [data-theme="dark"] .notebook-card {
        background: #1e1e1e;
    }
</style>

<script>
    document.addEventListener('DOMContentLoaded', () => {
        // Wait for bundle to load
        if (window.MaterioNotebook) {
            initNotebooksPage();
        } else {
            window.addEventListener('bundle:loaded', initNotebooksPage);
            // Fallback
            setTimeout(initNotebooksPage, 1000);
        }
    });

    async function initNotebooksPage() {
        const grid = document.getElementById('notebooksGrid');
        const emptyState = document.getElementById('emptyState');
        const syncBtn = document.getElementById('syncBtn');

        if (!window.MaterioNotebook) {
            console.warn('Notebook module not loaded');
            return;
        }

        // Show sync button for privileged users
        if (window.materioUserHasAdminPrivileges || window.materioUserHasPrivateAccess) {
            syncBtn.style.display = 'inline-flex';
        }

        function renderNotebooks() {
            const notebooks = window.MaterioNotebook.getAll();
            
            if (notebooks.length === 0) {
                grid.style.display = 'none';
                emptyState.style.display = 'block';
                return;
            }

            grid.style.display = 'grid';
            emptyState.style.display = 'none';
            grid.innerHTML = '';

            // Sort by updated date desc
            const sortedNotebooks = [...notebooks].sort((a, b) => 
                new Date(b.updatedAt) - new Date(a.updatedAt)
            );

            sortedNotebooks.forEach(notebook => {
                const card = document.createElement('div');
                card.className = 'notebook-card';
                card.onclick = (e) => {
                    // Don't open if clicked delete button (to be implemented)
                    window.MaterioNotebook.open(notebook.id);
                };

                // Strip HTML for preview
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = notebook.content || '';
                const previewText = tempDiv.textContent || 'No content';

                const dateStr = new Date(notebook.updatedAt).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric'
                });

                let badgeHtml = '';
                if (notebook.linkedPdf) {
                    badgeHtml = `<div class="notebook-badge"><i class="fas fa-file-pdf"></i> PDF</div>`;
                }

                if (notebook.syncedToCloud) {
                    badgeHtml += `<div class="notebook-badge" style="margin-left: 6px;"><i class="fas fa-cloud"></i></div>`;
                }

                card.innerHTML = `
                    <div class="notebook-card-header">
                        <h3 class="notebook-title">${notebook.title || 'Untitled Note'}</h3>
                    </div>
                    <div class="notebook-preview">${previewText.slice(0, 150)}${previewText.length > 150 ? '...' : ''}</div>
                    <div class="notebook-meta">
                        <span class="notebook-date">${dateStr}</span>
                        <div>${badgeHtml}</div>
                    </div>
                `;
                grid.appendChild(card);
            });
        }

        // Initial render
        renderNotebooks();

        // Listen for storage changes to update list
        window.addEventListener('storage', (e) => {
            if (e.key === 'materio_notebooks') {
                renderNotebooks();
            }
        });

        // Sync function
        window.syncNotebooks = async () => {
            const btn = document.getElementById('syncBtn');
            const icon = btn.querySelector('i');
            
            icon.className = 'fa-regular fa-loader fa-spin';
            btn.disabled = true;

            if (window.MaterioNotebook.syncToCloud) {
                await window.MaterioNotebook.syncToCloud();
                // Also try loading
                 // Wait, syncToCloud doesn't load? 
                 // We should probably load as well.
                 // But for now just sync local to cloud.
            }

            // re-render in case of updates
            renderNotebooks();

            setTimeout(() => {
                icon.className = 'fa-regular fa-sync';
                btn.disabled = false;
            }, 1000);
        };
    }
</script>
