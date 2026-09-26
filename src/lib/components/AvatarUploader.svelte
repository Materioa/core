<script>
    import { activeModalStore } from '$lib/stores.js';
    import HugeIcon from "./HugeIcon.svelte";

    let avatarUrl = '/assets/img/default-avatar.svg';
    let isUploading = false;
    let fileInput;

    function closeModal() {
        activeModalStore.set(null);
    }

    async function handleFileSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        isUploading = true;
        try {
            const formData = new FormData();
            formData.append('avatar', file);

            const res = await fetch('/api/v2/features?action=upload-avatar', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                if (data.url) avatarUrl = data.url;
            } else {
                // Local preview fallback
                avatarUrl = URL.createObjectURL(file);
            }
        } catch (e) {
            console.error('Avatar upload error:', e);
            avatarUrl = URL.createObjectURL(file);
        } finally {
            isUploading = false;
        }
    }
</script>

{#if $activeModalStore === 'avatar-uploader'}
    <div class="promo-modal-overlay" style="display: flex;" on:click={closeModal}>
        <div class="promo-modal dynamic-form-modal" style="max-width: 400px;" on:click|stopPropagation>
            <HugeIcon name="cancel-01" />
            <div class="promo-content dynamic-form-content-wrapper" style="text-align: center;">
                <h2><span class="promo-title">Change Profile Picture</span></h2>

                <div style="margin: 20px auto; width: 100px; height: 100px; border-radius: 50%; overflow: hidden; border: 2px solid #ff8200;">
                    <img src={avatarUrl} alt="Profile Avatar" style="width: 100%; height: 100%; object-fit: cover;" />
                </div>

                <input type="file" accept="image/*" bind:this={fileInput} on:change={handleFileSelect} style="display: none;" />

                <div style="display: flex; justify-content: center; gap: 10px; margin-top: 15px;">
                    <button class="site-button" on:click={() => fileInput.click()} disabled={isUploading}>
                        {isUploading ? 'Uploading...' : 'Choose Photo'}
                    </button>
                    <button class="site-button promo-primary-btn" on:click={closeModal}>Save</button>
                </div>
            </div>
        </div>
    </div>
{/if}
