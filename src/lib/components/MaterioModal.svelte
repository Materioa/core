<script>
    import { onMount } from 'svelte';
    import HugeIcon from './HugeIcon.svelte';

    let visible = false;
    let title = '';
    let message = '';
    let type = 'info';
    let isConfirm = false;
    let confirmText = 'Confirm';
    let cancelText = 'Cancel';
    let okText = 'OK';
    let danger = false;
    let resolver = null;

    function getIcon() {
        if (type === 'success') return 'checkmark-circle-01';
        if (type === 'warning') return 'alert-02';
        if (type === 'danger' || type === 'error') return 'alert-circle';
        return 'information-circle';
    }

    export function alert(msg, options = {}) {
        return new Promise((resolve) => {
            title = options.title || 'Notice';
            message = String(msg || '');
            const rawType = options.type || 'info';
            type = rawType === 'error' ? 'danger' : rawType;
            okText = options.buttonText || options.okText || 'OK';
            isConfirm = false;
            resolver = resolve;
            visible = true;
            setTimeout(() => document.getElementById('materio-modal-ok')?.focus(), 100);
        });
    }

    export function confirm(msg, options = {}) {
        return new Promise((resolve) => {
            title = options.title || 'Confirm';
            message = String(msg || '');
            const rawType = options.type || 'warning';
            type = rawType === 'error' ? 'danger' : rawType;
            confirmText = options.confirmText || 'Confirm';
            cancelText = options.cancelText || 'Cancel';
            danger = !!options.danger || type === 'danger';
            isConfirm = true;
            resolver = resolve;
            visible = true;
            setTimeout(() => document.getElementById('materio-modal-cancel')?.focus(), 100);
        });
    }

    function handleOk() {
        visible = false;
        if (resolver) resolver();
        resolver = null;
    }

    function handleConfirm(val) {
        visible = false;
        if (resolver) resolver(val);
        resolver = null;
    }

    function handleBackdrop(e) {
        if (e.target === e.currentTarget) {
            handleConfirm(isConfirm ? false : undefined);
        }
    }

    function handleKeydown(e) {
        if (!visible) return;
        if (e.key === 'Escape') {
            handleConfirm(isConfirm ? false : undefined);
        } else if (e.key === 'Enter') {
            if (isConfirm) {
                if (document.activeElement?.id === 'materio-modal-cancel') {
                    handleConfirm(false);
                } else {
                    handleConfirm(true);
                }
            } else {
                handleOk();
            }
        }
    }

    onMount(() => {
        window.materioAlert = alert;
        window.materioConfirm = confirm;
        window.MaterioModal = { alert, confirm };
        // Override native window.alert so all alert() calls throughout the site use MaterioModal
        window.alert = (msg) => { alert(msg); };
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    });
</script>

{#if visible}
    <div class="materio-modal-overlay visible" on:click={handleBackdrop} role="alertdialog" aria-modal="true" aria-labelledby="materio-modal-title">
        <div class="materio-modal">
            <div class="materio-modal-icon {type}">
                <HugeIcon name={getIcon()} size="28px" />
            </div>
            <h3 id="materio-modal-title" class="materio-modal-title">{title}</h3>
            <p class="materio-modal-message">{message}</p>
            <div class="materio-modal-buttons">
                {#if isConfirm}
                    <button id="materio-modal-cancel" class="materio-modal-btn secondary" on:click={() => handleConfirm(false)}>{cancelText}</button>
                    <button id="materio-modal-confirm" class="materio-modal-btn {danger ? 'danger' : 'primary'}" on:click={() => handleConfirm(true)}>{confirmText}</button>
                {:else}
                    <button id="materio-modal-ok" class="materio-modal-btn primary" on:click={handleOk}>{okText}</button>
                {/if}
            </div>
        </div>
    </div>
{/if}
