<script>
    import { activeModalStore } from '$lib/stores.js';
    import HugeIcon from './HugeIcon.svelte';

    function openMcpModal() {
        activeModalStore.set('mcp');
    }

    function closeMcpModal() {
        activeModalStore.set(null);
    }
</script>

<div class="ai-connectors-banner" id="aiConnectorsBanner" style="display: flex;" on:click={openMcpModal} role="button" tabindex="0">
    <div class="ai-banner-content">
        <div style="display: flex; align-items: center; gap: 8px;">
            <span class="ai-banner-text">
                <span class="desktop-only-text">Try Integrations with ChatGPT, Claude, Perplexity and Thinklet.</span>
                <span class="mobile-only">Try Thinklet</span>
            </span>
        </div>
        <div class="ai-banner-right">
            <div class="ai-icons-group">
                <img src="https://www.google.com/s2/favicons?sz=128&domain=perplexity.ai" alt="Perplexity" class="ai-icon perplexity-icon">
                <img src="https://www.google.com/s2/favicons?sz=128&domain=chatgpt.com" alt="ChatGPT" class="ai-icon chatgpt-icon">
                <img src="https://www.google.com/s2/favicons?sz=128&domain=claude.com" alt="Claude" class="ai-icon claude-icon">
                <img src="https://chat.getmaterio.app/favicon.png" alt="Thinklet" class="ai-icon thinklet-icon">
            </div>
            <HugeIcon name="arrow-right-01" />
        </div>
    </div>
</div>

{#if $activeModalStore === "mcp"}
        <!-- MCP Connectors Modal -->
        <div class="promo-modal-overlay dynamic-form-overlay show" id="mcpConnectorsModal" role="dialog" aria-modal="true" on:click|self={closeMcpModal}>
            <div class="promo-modal dynamic-form-modal" style="border-radius: var(--radius-full, 40px) !important; corner-shape: squircle !important; overflow: hidden;">
                <button type="button" class="promo-close-btn" on:click={closeMcpModal} aria-label="Close">
                    <HugeIcon name="cancel-01" />
                </button>

                <div class="promo-content dynamic-form-content-wrapper">
                    <div class="dynamic-form-header" style="margin-bottom: 20px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; width: 100%; padding-top: 16px;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" color="currentColor" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; color: var(--color-text-primary);">
                            <path d="M22 18C22 19.4001 22 20.1002 21.7275 20.635C21.4878 21.1054 21.1054 21.4878 20.635 21.7275C20.635 21.7275 20.635 21.7275 20.635 21.7275C20.1002 22 19.4001 22 18 22C16.5999 22 15.8998 22 15.365 21.7275C14.8946 21.4878 14.5122 21.1054 14.2725 20.635C14 20.1002 14 19.4001 14 18C14 16.5999 14 15.8998 14.2725 15.365C14.5122 14.8946 14.8946 14.5122 15.365 14.2725C15.8998 14 16.5999 14 18 14C19.4001 14 20.1002 14 20.635 14.2725C21.1054 14.5122 21.4878 14.8946 21.7275 15.365C22 15.8998 22 16.5999 22 18Z"></path>
                            <path d="M22 10C22 11.4001 22 12.1002 21.7275 12.635C21.4878 13.1054 21.1054 13.4878 20.635 13.7275C20.1002 14 19.4001 14 18 14C16.5999 14 15.8998 14 15.365 13.7275C14.8946 13.4878 14.5122 13.1054 14.2725 12.635C14 12.1002 14 11.4001 14 10C14 8.59987 14 7.8998 14.2725 7.36502C14.5122 6.89462 14.8946 6.51217 15.365 6.27248C15.8998 6 16.5999 6 18 6C19.4001 6 20.1002 6 20.635 6.27248C21.1054 6.51217 21.4878 6.89462 21.7275 7.36502C22 7.8998 22 8.59987 22 10Z"></path>
                            <path d="M14 18C14 19.4001 14 20.1002 13.7275 20.635C13.4878 21.1054 13.1054 21.4878 12.635 21.7275C12.1002 22 11.4001 22 10 22C8.59987 22 7.8998 22 7.36502 21.7275C6.89462 21.4878 6.51217 21.1054 6.27248 20.635C6 20.1002 6 19.4001 6 18C6 16.5999 6 15.8998 6.27248 15.365C6.51217 14.8946 6.89462 14.5122 7.36502 14.2725C7.8998 14 8.59987 14 10 14C11.4001 14 12.1002 14 12.635 14.2725C13.1054 14.5122 13.4878 14.8946 13.7275 15.365C14 15.8998 14 16.5999 14 18Z"></path>
                            <path d="M10 6C10 7.40013 10 8.1002 9.72752 8.63497C9.48783 9.10538 9.10538 9.48783 8.63498 9.72752C8.1002 10 7.40013 10 6 10C4.59987 10 3.8998 10 3.36502 9.72751C2.89462 9.48783 2.51217 9.10538 2.27248 8.63497C2 8.10019 2 7.40013 2 6C2 4.59987 2 3.8998 2.27248 3.36502C2.51217 2.89462 2.89462 2.51217 3.36502 2.27248C3.8998 2 4.59987 2 6 2C7.40013 2 8.1002 2 8.63498 2.27248C9.10538 2.51217 9.48783 2.89462 9.72752 3.36502C10 3.8998 10 4.59987 10 6Z"></path>
                        </svg>
                        <h2 style="font-size: 1.3rem; font-weight: 700; margin: 0;">Try Integrations with</h2>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <!-- Thinklet -->
                        <a href="https://chat.getmaterio.app/" target="_blank" class="mcp-connect-card">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <img src="https://chat.getmaterio.app/favicon.png" alt="Thinklet"
                                    style="width: 36px; height: 36px; border-radius: 10px; corner-shape: squircle;"
                                    on:error={(e) => { const el = e.currentTarget; if (el.dataset.fb) { el.style.display = 'none'; return; } el.dataset.fb = '1'; el.src = '/assets/img/favicon.png'; }}>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-weight: 600; font-size: 16px;">Thinklet</span>
                                    <span
                                        style="font-size: 11px; font-weight: 600; background-color: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 5px;">New</span>
                                </div>
                            </div>
                            <HugeIcon name="arrow-right-01" />
                        </a>

                        <!-- ChatGPT -->
                        <a href="https://chatgpt.com/g/g-69b90f449ff08191a3d32d3c0bec0591-materio" target="_blank"
                            class="mcp-connect-card">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <img src="https://www.google.com/s2/favicons?sz=128&domain=chatgpt.com" alt="ChatGPT"
                                    style="width: 36px; height: 36px; border-radius: 10px; corner-shape: squircle;"
                                    on:error={(e) => { const el = e.currentTarget; if (el.dataset.fb) { el.style.display = 'none'; return; } el.dataset.fb = '1'; el.src = '/assets/img/chatgpt-icon.svg'; }}>
                                <span style="font-weight: 600; font-size: 16px;">ChatGPT</span>
                            </div>
                            <HugeIcon name="arrow-right-01" />
                        </a>

                        <!-- Claude Container -->
                        <div class="mcp-connect-card-container">
                            <div
                                style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid rgba(128, 128, 128, 0.1);">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <img src="https://www.google.com/s2/favicons?sz=128&domain=claude.com" alt="Claude"
                                        style="width: 36px; height: 36px; border-radius: 10px; corner-shape: squircle;"
                                        on:error={(e) => { const el = e.currentTarget; if (el.dataset.fb) { el.style.display = 'none'; return; } el.dataset.fb = '1'; el.src = '/assets/img/claude-ai-icon.svg'; }}>
                                    <span style="font-weight: 600; font-size: 16px;">Claude</span>
                                </div>
                            </div>
                            <div style="display: flex; flex-direction: column;">
                                <a href="https://claude.ai/customize/connectors?modal=add-custom-connector"
                                    target="_blank" class="mcp-sublink">
                                    <span>Connect</span>
                                    <HugeIcon name="arrow-right-01" />
                                </a>
                                <a href="https://getmaterio.app/docs/mcp#connecting-claude" target="_blank"
                                    class="mcp-sublink">
                                    <span>Guide</span>
                                    <HugeIcon name="arrow-right-01" />
                                </a>
                            </div>
                        </div>
                        <!-- Perplexity Container -->
                        <div class="mcp-connect-card-container">
                            <div
                                style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid rgba(128, 128, 128, 0.1);">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <img src="https://www.google.com/s2/favicons?sz=128&domain=perplexity.ai"
                                        alt="Claude" style="width: 36px; height: 36px; border-radius: 10px; corner-shape: squircle;"
                                        on:error={(e) => { const el = e.currentTarget; if (el.dataset.fb) { el.style.display = 'none'; return; } el.dataset.fb = '1'; el.src = '/assets/img/perplexity-ai-icon.svg'; }}>
                                    <span style="font-weight: 600; font-size: 16px;">Perplexity</span>
                                </div>
                            </div>
                            <div style="display: flex; flex-direction: column;">
                                <a href="https://www.perplexity.ai/computer/connectors" target="_blank"
                                    class="mcp-sublink">
                                    <span>Connect</span>
                                    <HugeIcon name="arrow-right-01" />
                                </a>
                                <a href="https://getmaterio.app/docs/mcp#connecting-perplexity" target="_blank"
                                    class="mcp-sublink">
                                    <span>Guide</span>
                                    <HugeIcon name="arrow-right-01" />
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

{/if}
