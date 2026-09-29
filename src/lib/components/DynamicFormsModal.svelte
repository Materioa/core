<script>
    import { onMount, tick } from 'svelte';
    import { activeModalStore } from '$lib/stores.js';
    import HugeIcon from './HugeIcon.svelte';
    import { trackModalView, trackModalEvent, runMagicJs } from '$lib/utils/promoMagic.js';
    import { attachSheetDrag } from '$lib/utils/sheetDrag.js';

    let magicCleanup = null;

    // Bottom-sheet drag on mobile: handle or scrolled-top pulls the sheet
    // down to dismiss, otherwise it springs back.
    function sheetDrag(node) {
        const overlay = typeof document !== 'undefined' ? document.getElementById('dynamicFormModal') : null;
        const detach = attachSheetDrag({
            sheet: node,
            overlay,
            onClose: () => closeModal(),
            handleSelector: '.sheet-drag-handle'
        });
        return { destroy: detach };
    }

    function fireFormMagic(stage) {
        if (!formConfig || !formType) return;
        const id = formConfig.id || formType;
        const title = formConfig.title || formType;
        const trackingId = formConfig.trackingId || formConfig.gaId || formConfig.gtmId || '';
        const trackViews = formConfig.trackViews ?? true;
        const overlay = (typeof document !== 'undefined' && document.getElementById('dynamicFormModal')) || (typeof document !== 'undefined' ? document.body : null);
        const root = overlay?.querySelector?.('.promo-modal') || overlay;
        const code = formConfig.magicJs || formConfig.magic?.js || '';
        const enabled = formConfig.magicEnabled ?? formConfig.magic?.enabled ?? !!String(code).trim();
        if (stage === 'open') {
            trackModalView({ id, title, kind: 'popup', trackingId, trackViews });
            if (!code || !enabled) return;
            // Wait a tick so .promo-modal exists for DOM tweaks.
            // Snapshot the config: the modal may be closed before first paint.
            const cfg = formConfig, fd = formData;
            tick().then(() => {
                const el = (typeof document !== 'undefined' && document.getElementById('dynamicFormModal')) || null;
                if (!el) return; // closed before first paint — nothing to enhance
                try { if (typeof magicCleanup === 'function') magicCleanup(); } catch {}
                magicCleanup = runMagicJs(code, {
                    root: el.querySelector?.('.promo-modal') || el,
                    overlay: el,
                    data: cfg, id, title, kind: 'popup', stage,
                    trackingId, formData: fd,
                    close: () => closeModal()
                }, { enabled: true });
            });
        } else if (stage === 'submit') {
            if (trackingId) trackModalEvent({ id, title, kind: 'popup', trackingId, action: 'form_submit' });
            if (!code || !enabled) return;
            runMagicJs(code, {
                root, overlay, data: formConfig, id, title, kind: 'popup', stage,
                trackingId, formData,
                close: () => closeModal()
            }, { enabled: true });
        } else if (stage === 'close') {
            if (trackingId) trackModalEvent({ id, title, kind: 'popup', trackingId, action: 'form_close' });
            try { if (typeof magicCleanup === 'function') magicCleanup(); } catch {}
            magicCleanup = null;
        }
    }

    let formType = null; // 'bug-report' | 'contribution' | 'feedback'
    let formConfig = null;
    let formData = {};
    let fileList = [];
    let ratingValues = {};
    let hoveredRating = {};
    let confirmationValues = {};
    let isSubmitting = false;
    let submitStatus = null; // null | 'success' | 'error'
    let errorMessage = '';
    let successMessage = '';

    let rawFormsConfig = null;
    let popupIds = new Set();
    let pendingModal = null;
    let wizardIndex = 0;
    let configLoading = false;

    // Normalize trigger IDs to config IDs.
    function normalizeType(t) {
        if (t === 'contribute') return 'contribution';
        if (t === 'satisfaction-survey') return 'satisfaction';
        if (t === 'bugreport' || t === 'bug_report') return 'bug-report';
        return t;
    }

    $: introSteps = (formConfig?.steps || []).filter((s) => s && s.type !== 'form');
    $: currentStep = introSteps[wizardIndex];
    $: showIntro = introSteps.length > 0 && wizardIndex < introSteps.length;

    function tryOpen(nt) {
        try {
            if (!nt) {
                formType = null;
                formConfig = null;
                wizardIndex = 0;
                return;
            }
            if (!popupIds.has(nt)) return; // owned by a different modal
            submitStatus = null;
            errorMessage = '';
            if (rawFormsConfig) loadForm(nt);
            else formType = nt;
        } catch (err) {
            console.error('Dynamic form open failed:', err);
        }
    }

    function refreshPopupIndex() {
        popupIds = new Set(Object.keys(rawFormsConfig?.forms || {}));
        if (pendingModal && popupIds.has(pendingModal)) {
            const nt = pendingModal;
            pendingModal = null;
            tryOpen(nt);
        }
    }

    // IDs owned by other (non-dynamic) modals — never claim or clear these.
    const FOREIGN_MODALS = new Set([
        'notebook', 'shortcuts', 'examModal', 'exam', 'exam-modal',
        'ai-chat', 'mcp', 'interview', 'viva', 'viva-box', 'viva-question-bank'
    ]);

    function releaseIfDead() {
        if (!pendingModal || popupIds.has(pendingModal)) return;
        if (FOREIGN_MODALS.has(pendingModal)) {
            // Belongs to another modal component — drop our pending claim
            // but leave the store alone so that modal can open.
            pendingModal = null;
            return;
        }
        // Truly unknown id: release the store so a dead value can't wedge
        // tab navigation and suppress other pop-ups until refresh.
        console.warn(`Unknown pop-up id "${pendingModal}" — ignoring`);
        pendingModal = null;
        try { activeModalStore.set(null); } catch {}
    }
    activeModalStore.subscribe(val => {
        // Never let a modal bug throw out of a store subscriber: Svelte
        // aborts the whole notify queue on throw, which used to wedge all
        // tab navigation until refresh.
        try {
            const nt = val ? normalizeType(val) : null;
            if (!nt) {
                formType = null;
                formConfig = null;
                wizardIndex = 0;
                pendingModal = null;
            } else if (popupIds.has(nt)) {
                pendingModal = null;
                tryOpen(nt);
            } else if (FOREIGN_MODALS.has(nt)) {
                // Owned by a different modal component — ignore.
                pendingModal = null;
            } else {
                pendingModal = nt; // may be a Mongo-managed pop-up we haven't loaded yet
                // If the config isn't loaded (or the earlier load failed), retry
                // now so the click isn't silently swallowed.
                ensureConfig();
            }
        } catch (err) {
            console.error('DynamicForms open failed:', err);
        }
    });

    async function ensureConfig() {
        if (rawFormsConfig || configLoading) {
            if (rawFormsConfig && !configLoading) releaseIfDead();
            return;
        }
        configLoading = true;
        try {
            const res = await fetch('/assets/data/forms-config.json');
            if (res.ok) {
                rawFormsConfig = await res.json();
                refreshPopupIndex();
                if (formType) loadForm(formType);
            }
        } catch (e) { console.error(e); }
        try {
            // Published pop-up configs from MongoDB (managed in the admin panel) win over the static file.
            const res = await fetch('/api/v2/forms/popups');
            if (res.ok) {
                const data = await res.json();
                rawFormsConfig = rawFormsConfig || { forms: {} };
                for (const doc of data.popups || []) {
                    if (doc && doc.id) rawFormsConfig.forms[doc.id] = doc;
                }
                refreshPopupIndex();
                if (formType) loadForm(formType);
            }
        } catch (e) { console.error('Mongo pop-up configs unavailable, using local file:', e); }
        configLoading = false;
        releaseIfDead();
    }

    onMount(async () => {
        await ensureConfig();
    });

    function loadForm(type) {
        try {
            const cfg = rawFormsConfig?.forms?.[type];
            if (!cfg || !Array.isArray(cfg.fields)) return;
            // Build all field state BEFORE publishing formConfig so the
            // template never renders a half-initialized form.
            const nextData = {};
            const nextFiles = [];
            const nextRatings = {};
            const nextConfirmations = {};
            cfg.fields.forEach(f => {
                if (!f || typeof f !== 'object') return;
                if (f.type === 'rating') nextRatings[f.name] = 0;
                else if (f.defaultValue !== undefined) nextData[f.name] = f.defaultValue;
                else nextData[f.name] = '';
                // for allowOther we track extra
                if (f.allowOther) nextData[f.name + '_other'] = '';
            });
            cfg.confirmations?.forEach(c => { if (c && c.name) nextConfirmations[c.name] = false; });
            formData = nextData;
            fileList = nextFiles;
            ratingValues = nextRatings;
            confirmationValues = nextConfirmations;
            wizardIndex = 0;
            successMessage = '';
            errorMessage = '';
            formType = type;
            formConfig = cfg;
            fireFormMagic('open');
        } catch (err) {
            console.error('Dynamic form load failed:', err);
        }
    }

    function isFieldVisible(field) {
        if (!field || typeof field !== 'object') return false;
        if (!field.showWhen) return true;
        const depVal = formData[field.showWhen.field];
        return depVal === field.showWhen.value;
    }

    function handleFileChange(e, field) {
        const files = Array.from(e.target.files || []);
        const maxSize = field.maxSize || 6291456;
        const valid = files.filter(f => f.size <= maxSize);
        fileList = valid;
        if (valid.length !== files.length) {
            errorMessage = `Some files exceed ${field.maxSizeLabel || '6MB'} limit`;
        }
    }

    function removeFile(idx) {
        fileList = fileList.filter((_, i) => i !== idx);
    }

    function setRating(name, val) {
        // Reassign (not mutate) so Svelte re-renders the stars — the old
        // direct mutation updated the value but left the UI unselected.
        ratingValues = { ...ratingValues, [name]: val };
    }

    function markSubmitted() {
        // Lets the auto-show engine treat "once" schedules as satisfied.
        try { localStorage.setItem(`materio_form_done_${formType}`, String(Date.now())); } catch {}
        fireFormMagic('submit');
    }

    function closeModal() {
        fireFormMagic('close');
        activeModalStore.set(null);
        formType = null;
        formConfig = null;
        wizardIndex = 0;
        submitStatus = null;
        errorMessage = '';
        if (typeof document !== 'undefined') document.body.classList.remove('modal-open');
    }

    async function handleSubmit() {
        if (!formConfig || isSubmitting) return;
        // validate required
        for (const f of formConfig.fields || []) {
            if (!f || typeof f !== 'object' || !isFieldVisible(f)) continue;
            const val = f.type === 'rating' ? ratingValues[f.name] : f.type === 'file' ? fileList : formData[f.name];
            if (f.required) {
                if (f.type === 'file' && (!val || val.length === 0)) { errorMessage = `${f.label} is required`; return; }
                if (f.type === 'rating' && (!val || val === 0)) { errorMessage = `${f.label} is required`; return; }
                if (!val || String(val).trim() === '') { errorMessage = `${f.label} is required`; return; }
            }
            if (f.allowOther && formData[f.name] === 'Other' && !String(formData[f.name + '_other']).trim()) {
                errorMessage = `Please specify ${f.label}`; return;
            }
        }
        for (const c of formConfig.confirmations || []) {
            if (!c || typeof c !== 'object') continue;
            if (c.required && !confirmationValues[c.name]) { errorMessage = 'Please confirm accuracy'; return; }
        }

        isSubmitting = true;
        errorMessage = '';
        try {
            let res;
            if (formType === 'contribution') {
                const fd = new FormData();
                // append fields
                for (const f of formConfig.fields) {
                    if (!f || typeof f !== 'object' || !isFieldVisible(f)) continue;
                    if (f.type === 'file') {
                        fileList.forEach(file => fd.append('files', file));
                    } else if (f.type === 'rating') {
                        fd.append(f.name, String(ratingValues[f.name] || ''));
                    } else {
                        let v = formData[f.name] || '';
                        if (f.allowOther && v === 'Other') v = formData[f.name + '_other'] || '';
                        fd.append(f.name, v);
                    }
                }
                for (const c of formConfig.confirmations || []) fd.append(c.name, String(!!confirmationValues[c.name]));
                // Identity contract the server expects (parent shape).
                let contribUser = null;
                try {
                    contribUser = JSON.parse(localStorage.getItem('user') || localStorage.getItem('materio_user') || 'null');
                } catch {}
                fd.append('userType', formData.userIdentity || 'anonymous');
                const contribName = contribUser?.username || contribUser?.displayName || null;
                if (contribName) fd.append('username', contribName);
                if (contribUser?.email) fd.append('email', contribUser.email);
                res = await fetch('/api/v2/features?action=contribute', { method: 'POST', body: fd });
            } else if (formType === 'bug-report') {
                // Bug reports go to the health API /report endpoint (MongoDB),
                // same as parent: fire-and-forget, show success immediately.
                const sessionId = window.materioSessionId || sessionStorage.getItem('materio_session_id');
                const payload = {
                    title: formData.title,
                    severity: formData.severity,
                    affectedArea: formData.affectedArea,
                    description: formData.description,
                    stepsToReproduce: formData.stepsToReproduce || null,
                    email: formData.email || null,
                    sessionId
                };
                submitStatus = 'success';
                successMessage = 'Bug report submitted! Our team will investigate this issue. Thank you for helping improve Materio!';
                markSubmitted();
                fetch('/api/v2/health?action=report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).then(async (resp) => {
                    if (!resp.ok) {
                        const err = await resp.json().catch(() => ({}));
                        console.warn('Bug report background submit issue:', err.error || resp.status);
                    }
                }).catch((err) => {
                    console.warn('Bug report background submit failed:', err.message);
                });
                return;
            } else {
                // Other JSON forms (feedback, etc.) go to ?action=forms with
                // the parent shape {formType, user, data, confirmations}.
                const data = {};
                for (const f of formConfig.fields) {
                    if (!f || typeof f !== 'object' || !isFieldVisible(f)) continue;
                    if (f.type === 'rating') data[f.name] = ratingValues[f.name];
                    else if (f.type !== 'file') {
                        let v = formData[f.name] || '';
                        if (f.allowOther && v === 'Other') v = formData[f.name + '_other'] || '';
                        data[f.name] = v;
                    }
                }
                const confirmations = {};
                for (const c of formConfig.confirmations || []) confirmations[c.name] = !!confirmationValues[c.name];
                let cachedUser = null;
                try {
                    cachedUser = JSON.parse(localStorage.getItem('user') || localStorage.getItem('materio_user') || 'null');
                } catch {}
                const token = localStorage.getItem('token') || localStorage.getItem('materio_auth_token') || localStorage.getItem('materio_token');
                const payload = {
                    formType,
                    user: {
                        type: cachedUser ? 'authenticated' : 'anonymous',
                        username: cachedUser?.username || cachedUser?.displayName || null,
                        email: cachedUser?.email || null,
                        githubUsername: cachedUser?.githubUsername || null
                    },
                    data,
                    confirmations
                };
                // Show success immediately (parent behavior); submit in background.
                submitStatus = 'success';
                successMessage = 'Your submission has been received. Thank you!';
                markSubmitted();
                fetch('/api/v2/features?action=forms', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify(payload)
                }).then(async (resp) => {
                    if (!resp.ok) {
                        const err = await resp.json().catch(() => ({}));
                        console.warn('Form background submit issue:', err.error || resp.status);
                    }
                }).catch((err) => {
                    console.warn('Form background submit failed:', err.message);
                });
                return;
            }
            if (res && res.ok) {
                submitStatus = 'success';
                successMessage = 'Your submission has been received.';
                markSubmitted();
            } else {
                submitStatus = 'error';
                errorMessage = 'Submission failed. Please try again.';
            }
        } catch (e) {
            console.error(e);
            submitStatus = 'error';
            errorMessage = 'Connection failed. Please check network.';
        } finally { isSubmitting = false; }
    }

    function nextWizard() {
        wizardIndex += 1;
    }

    function resetForm() { submitStatus = null; errorMessage=''; }

    function buildJson() {
        const payload = { type: formType };
        for (const f of formConfig.fields || []) {
            if (!f || typeof f !== 'object' || !isFieldVisible(f)) continue;
            if (f.type === 'rating') payload[f.name] = ratingValues[f.name];
            else if (f.type !== 'file') {
                let v = formData[f.name] || '';
                if (f.allowOther && v === 'Other') v = formData[f.name + '_other'] || '';
                payload[f.name] = v;
            }
        }
        const jsonStr = JSON.stringify(payload, null, 2);
        navigator.clipboard?.writeText(jsonStr);
        successMessage = jsonStr;
        submitStatus = 'success';
    }
</script>

{#if formType && formConfig}
    <div class="promo-modal-overlay dynamic-form-overlay show" id="dynamicFormModal" role="dialog" aria-modal="true" aria-labelledby="dynamicFormTitle" on:click|self={closeModal}>
        <div class="promo-modal dynamic-form-modal" use:sheetDrag>
            <div class="sheet-drag-handle" aria-hidden="true"><span></span></div>
            <button type="button" class="promo-close-btn" on:click={closeModal} aria-label="Close">
                <HugeIcon name="cancel-01" />
            </button>

            <div class="promo-content dynamic-form-content-wrapper">
                {#if !submitStatus}
                    <div class="dynamic-form-header">
                        <span id="dynamicFormIcon" class="dynamic-form-icon"><HugeIcon name="plus-sign-circle"  /></span>
                        <h2 id="dynamicFormTitle">{formConfig.title}</h2>
                        <p id="dynamicFormDescription" class="promo-description">{formConfig.description}</p>
                    </div>
                {/if}

                {#if submitStatus === 'success'}
                    <div id="dynamicFormSuccess" class="dynamic-form-result" style="display: flex;">
                        <div class="result-icon success-icon"><HugeIcon name="checkmark-circle-01" /></div>
                        <h3>Thank You!</h3>
                        <p id="dynamicFormSuccessMessage">{successMessage || 'Your submission has been received.'}</p>
                        <button type="button" class="site-button promo-secondary-btn" on:click={closeModal}>Close</button>
                    </div>
                {:else if submitStatus === 'error'}
                    <div id="dynamicFormError" class="dynamic-form-result" style="display: flex;">
                        <div class="result-icon error-icon"><HugeIcon name="alert-circle" /></div>
                        <h3>Something went wrong</h3>
                        <p id="dynamicFormErrorMessage">{errorMessage || 'Please try again later.'}</p>
                        <button type="button" class="site-button promo-primary-btn" on:click={resetForm}>Try Again</button>
                    </div>
                {:else if showIntro && currentStep}
                    <div class="wizard-page" style="text-align:center;padding:12px 4px;">
                        <h3 style="margin:6px 0;">{currentStep.title}</h3>
                        {#if currentStep.subtitle}<p class="promo-description">{currentStep.subtitle}</p>{/if}
                        {#if currentStep.content}
                            <div style="text-align:left;margin:14px 0;display:grid;gap:8px;">
                                {#each currentStep.content as item}
                                    {#if typeof item === 'string'}
                                        <p class="promo-description" style="margin:0;">{item}</p>
                                    {:else}
                                        <div><strong style="font-size:14px;">{item.title}</strong><p class="promo-description" style="margin:2px 0 0;">{item.description}</p></div>
                                    {/if}
                                {/each}
                            </div>
                        {/if}
                        {#if currentStep.description}<p class="promo-description">{currentStep.description}</p>{/if}
                        <div class="promo-actions dynamic-form-actions" style="margin-top:18px;">
                            {#if currentStep.type === 'cover'}
                                <button type="button" class="site-button promo-primary-btn" on:click={nextWizard}>{currentStep.nextButton?.text || 'Get Started'}</button>
                            {:else}
                                <button type="button" class="site-button promo-primary-btn" on:click={nextWizard}>{currentStep.continueButton?.text || 'Continue'}</button>
                                {#if currentStep.exitButton}
                                    <button type="button" class="site-button promo-secondary-btn" on:click={closeModal} style="margin-top:10px;width:100%;justify-content:center;">{currentStep.exitButton.text || 'Maybe Later'}</button>
                                {/if}
                            {/if}
                        </div>
                    </div>
                {:else}
                    <form id="dynamicFormContent" class="dynamic-form-fields-container" on:submit|preventDefault={handleSubmit}>
                        <div id="dynamicFormFields" class="dynamic-form-fields">
                            {#each (formConfig.fields || []) as field}
                                {#if field && typeof field === 'object'}
                                {#if isFieldVisible(field)}
                                    <div class="dynamic-form-group">
                                        <label>{field.label} {#if field.required}<span class="required">*</span>{/if}</label>

                                        {#if field.type === 'text' || field.type === 'email'}
                                            <input type={field.type} placeholder={field.placeholder || ''} bind:value={formData[field.name]} maxlength={field.maxLength || 524288} />

                                        {:else if field.type === 'select'}
                                            <select bind:value={formData[field.name]}>
                                                <option value="" disabled>Select {field.label}</option>
                                                {#each (field.options || []) as opt}
                                                    {#if opt && typeof opt === 'object'}
                                                    <option value={opt.value}>{opt.label}</option>
                                                    {/if}
                                                {/each}
                                                {#if field.allowOther}<option value="Other">Other</option>{/if}
                                            </select>
                                            {#if field.allowOther && formData[field.name] === 'Other'}
                                                <input type="text" placeholder={field.otherPlaceholder || ''} bind:value={formData[field.name + '_other']} style="margin-top:8px;" />
                                            {/if}

                                        {:else if field.type === 'textarea'}
                                            <textarea placeholder={field.placeholder || ''} bind:value={formData[field.name]} rows="4" maxlength={field.maxLength || 524288}></textarea>

                                        {:else if field.type === 'file'}
                                            <label class="dynamic-form-file-area">
                                                <HugeIcon name="file-02" style="font-size:32px;color:#ff8200;margin-bottom:12px;display:block;text-align:center;" />
                                                <p>Click to upload or drag and drop</p>
                                                {#if field.hint}<span class="field-hint">{field.hint}</span>{/if}
                                                <input type="file" accept={field.accept || '.pdf'} multiple={field.multiple} on:change={(e)=>handleFileChange(e, field)} />
                                            </label>
                                            {#if fileList.length}
                                                <div class="dynamic-form-file-preview">
                                                    {#each fileList as f, i}
                                                        <div class="dynamic-form-file-item">
                                                            <HugeIcon name="file-02" />
                                                            <span class="file-name">{f.name}</span>
                                                            <span class="file-size">{(f.size/1024).toFixed(0)} KB</span>
                                                            <button type="button" class="remove-file" on:click={()=>removeFile(i)}><HugeIcon name="cancel-01" /></button>
                                                        </div>
                                                    {/each}
                                                </div>
                                            {/if}

                                        {:else if field.type === 'rating'}
                                            <div class="dynamic-form-rating" role="radiogroup" aria-label={field.label || 'Rating'}>
                                                {#each Array(field.max || 5) as _, i}
                                                    {@const starIndex = i + 1}
                                                    {@const isFilled = (hoveredRating[field.name] || ratingValues[field.name] || 0) >= starIndex}
                                                    <button
                                                        type="button"
                                                        class="star-btn"
                                                        class:active={isFilled}
                                                        on:click|preventDefault={() => setRating(field.name, starIndex)}
                                                        on:pointerdown={() => setRating(field.name, starIndex)}
                                                        on:mouseenter={() => { hoveredRating = { ...hoveredRating, [field.name]: starIndex }; }}
                                                        on:mouseleave={() => { hoveredRating = { ...hoveredRating, [field.name]: 0 }; }}
                                                        on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRating(field.name, starIndex); } }}
                                                        aria-label={`${starIndex} star${starIndex > 1 ? 's' : ''}`}
                                                    >
                                                        <svg class="star-svg" viewBox="0 0 24 24" fill={isFilled ? "#ff8200" : "none"} stroke={isFilled ? "#ff8200" : "currentColor"} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                                        </svg>
                                                    </button>
                                                {/each}
                                            </div>
                                        {/if}
                                        {#if field.hint && field.type !== 'file'}<span class="field-hint">{field.hint}</span>{/if}
                                    </div>
                                {/if}
                                {/if}
                            {/each}
                        </div>

                        {#if formConfig.confirmations?.length}
                            <div id="dynamicFormConfirmations" class="dynamic-form-confirmations">
                                {#each formConfig.confirmations as conf}
                                    <div class="dynamic-form-confirmation">
                                        <input type="checkbox" id={conf.name} bind:checked={confirmationValues[conf.name]} />
                                        <label for={conf.name}>{conf.label}{#if conf.required}<span class="required">*</span>{/if}</label>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </form>

                    {#if errorMessage}<p style="color:#ea5455;font-size:13px;margin:8px 0;">{errorMessage}</p>{/if}

                    <div class="promo-actions dynamic-form-actions">
                        <button type="button" id="dynamicFormSubmitBtn" class="site-button promo-primary-btn" on:click={handleSubmit} disabled={isSubmitting}>
                            <span style="margin-right: 8px;"><HugeIcon name="paper-plane"  /></span>
                            <span id="dynamicFormSubmitText">{isSubmitting ? 'Submitting...' : (formConfig.submitButton?.text || 'Submit')}</span>
                        </button>
                        {#if formType === 'contribution'}
                            <button type="button" id="dynamicFormBuildJsonBtn" class="site-button promo-secondary-btn" on:click={buildJson} style="display: flex; margin-top: 10px; width: 100%; justify-content: center;">
                                <HugeIcon name="code-01" style="margin-right:8px;" /><span>Build JSON Object</span>
                            </button>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    /* Result screens: render in normal flow (not as a transparent overlay),
       so they never collide with the form header. */
    .dynamic-form-overlay .dynamic-form-result {
        position: static;
        width: auto;
        height: auto;
        min-height: 300px;
        padding: 36px 24px;
        border-radius: 0;
    }
    .dynamic-form-overlay .dynamic-form-result p {
        max-width: 44ch;
    }

    /* Clean star rating: no box wrappers, no glowing background */
    .dynamic-form-rating {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
    }
    .dynamic-form-rating .star-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px !important;
        margin: 0 !important;
        border: none !important;
        border-radius: 0 !important;
        background: transparent !important;
        color: rgba(140, 140, 140, 0.45) !important;
        cursor: pointer !important;
        outline: none !important;
        box-shadow: none !important;
        transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    :global(body:not(.dark-mode)) .dynamic-form-rating .star-btn {
        border: none !important;
        background: transparent !important;
        color: rgba(0, 0, 0, 0.28) !important;
    }
    .dynamic-form-rating .star-btn:hover {
        transform: scale(1.18);
        border: none !important;
        background: transparent !important;
        color: #ff8200 !important;
        box-shadow: none !important;
    }
    .dynamic-form-rating .star-btn.active {
        border: none !important;
        background: transparent !important;
        color: #ff8200 !important;
        box-shadow: none !important;
    }
    .dynamic-form-rating .star-svg {
        width: 30px;
        height: 30px;
        pointer-events: none;
        transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), fill 0.15s ease, stroke 0.15s ease;
    }
    .dynamic-form-rating .star-btn:hover .star-svg {
        transform: scale(1.1);
    }

    /* Bottom-sheet drag handle — mobile only */
    .sheet-drag-handle {
        display: none;
    }
    @media (max-width: 500px) {
        .sheet-drag-handle {
            display: flex;
            justify-content: center;
            padding: 10px 0 2px;
            cursor: grab;
        }
        .sheet-drag-handle span {
            width: 40px;
            height: 4px;
            border-radius: 999px;
            background: rgba(0, 0, 0, 0.18);
        }
        :global(body.dark-mode) .sheet-drag-handle span {
            background: rgba(255, 255, 255, 0.28);
        }
    }
</style>
