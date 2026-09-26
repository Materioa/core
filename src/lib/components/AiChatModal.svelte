<script>
    import { activeModalStore } from '$lib/stores.js';
    import HugeIcon from '$lib/components/HugeIcon.svelte';

    let messages = [
        { role: 'assistant', text: 'Hello! I am your Materio AI study assistant. How can I help you ace your CS preparation today?' }
    ];
    let promptInput = '';
    let isSending = false;
    let selectedModel = 'deepseek/deepseek-chat-v3-0324:free';
    let showModelDropdown = false;
    let currentMode = 'general';

    const models = [
        { id: 'deepseek/deepseek-chat-v3-0324:free', label: 'DeepSeek Chat (V3)' },
        { id: 'qwen/qwen3-235b-a22b:free', label: 'Qwen 3 (235B)' },
        { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 (70B)' },
        { id: 'google/gemma-3-27b-it:free', label: 'Gemma 3 (27B)' }
    ];

    function closeModal() {
        activeModalStore.set(null);
    }

    async function sendMessage() {
        if (!promptInput.trim() || isSending) return;

        const userText = promptInput.trim();
        messages = [...messages, { role: 'user', text: userText }];
        promptInput = '';
        isSending = true;

        try {
            const res = await fetch('/api/v2/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: messages.map(m => ({ role: m.role, content: m.text })),
                    model: selectedModel
                })
            });

            if (res.ok) {
                const data = await res.json();
                const reply = data.choices?.[0]?.message?.content || data.reply || 'No response generated.';
                messages = [...messages, { role: 'assistant', text: reply }];
            } else {
                messages = [...messages, { role: 'assistant', text: 'Sorry, I encountered an issue processing your request. Please try again later.' }];
            }
        } catch (e) {
            console.error('AI Chat Error:', e);
            messages = [...messages, { role: 'assistant', text: 'Connection failed. Make sure you are online.' }];
        } finally {
            isSending = false;
        }
    }
</script>

{#if $activeModalStore === 'ai-chat'}
    <div class="keyboard-shortcuts-modal visible" role="dialog" aria-modal="true" style="display: flex;" on:click|self={closeModal}>
        <div class="keyboard-shortcuts-backdrop" on:click={closeModal}></div>
        <div class="keyboard-shortcuts-dialog" style="max-width: 680px; width: min(92vw, 680px); max-height: min(78vh, 680px); padding: 24px;">
            <div class="ai-chat-container">
                <div class="ai-chat-header">
                    <div class="ai-chat-header-left">
                        <div class="ai-chat-logo-container" on:click={() => showModelDropdown = !showModelDropdown}>
                            <div class="ai-chat-logo">AI Chat</div>
                            <svg class="ai-chat-chevron-down" class:active={showModelDropdown} viewBox="0 0 24 24" fill="none">
                                <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                    </div>
                    {#if showModelDropdown}
                        <div class="ai-chat-model-dropdown show">
                            {#each models as m}
                                <div
                                    class="ai-chat-model-option"
                                    class:selected={selectedModel === m.id}
                                    on:click={() => { selectedModel = m.id; showModelDropdown = false; }}
                                >
                                    {m.label}
                                </div>
                            {/each}
                        </div>
                    {/if}
                    <button type="button" class="shortcuts-close-btn" on:click={closeModal} style="position: relative; top: 0; right: 0;">
                        <HugeIcon name="cancel-01" />
                    </button>
                </div>

                <div class="ai-chat-messages-container">
                    {#each messages as msg}
                        <div class="ai-chat-message {msg.role}">
                            {#if msg.role === 'user'}
                                <div class="ai-chat-user-message">{msg.text}</div>
                            {:else}
                                <div class="ai-chat-ai-response">{msg.text}</div>
                            {/if}
                        </div>
                    {/each}

                    {#if isSending}
                        <div class="ai-chat-thinking">
                            <span>AI is thinking</span>
                            <div class="ai-chat-thinking-dots">
                                <div class="ai-chat-thinking-dot"></div>
                                <div class="ai-chat-thinking-dot"></div>
                                <div class="ai-chat-thinking-dot"></div>
                            </div>
                        </div>
                    {/if}
                </div>

                <div class="ai-chat-input-container bottom">
                    <div class="ai-chat-input-wrapper">
                        <div class="ai-chat-input-controls">
                            <button type="button" class="ai-chat-mode-button" class:active={currentMode === 'reasoning'} on:click={() => currentMode = 'reasoning'} title="Reasoning Mode">
                                🧠
                            </button>
                            <button type="button" class="ai-chat-mode-button" class:active={currentMode === 'code'} on:click={() => currentMode = 'code'} title="Code Mode">
                                💻
                            </button>
                        </div>
                        <div style="position: relative;">
                            <textarea
                                class="ai-chat-input-box"
                                placeholder="Ask anything..."
                                rows="1"
                                bind:value={promptInput}
                                on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                            ></textarea>
                            <button type="button" class="ai-chat-send-button" disabled={!promptInput.trim() || isSending} on:click={sendMessage}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="22" y1="2" x2="11" y2="13"></line>
                                    <polygon points="22,2 15,22 11,13 2,9"></polygon>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}
