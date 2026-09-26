export function initReferralTracker() {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref') || params.get('invite');
    if (refCode) {
        localStorage.setItem('materio_referral_code', refCode);
    }
}

export function getReferralCode() {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('materio_referral_code');
}
