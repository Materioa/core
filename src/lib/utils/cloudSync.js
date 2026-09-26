export async function syncUserDataToCloud(data) {
    try {
        const res = await fetch('/api/v2/features?action=sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) {
        console.error('Cloud Sync Error:', e);
        return false;
    }
}
