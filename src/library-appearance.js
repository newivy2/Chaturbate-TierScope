export const LIBRARY_APPEARANCE_KEY = 'tierscope:library-appearance:v1';

function valid(value) {
    return value && value.schemaVersion === 1 && Number.isFinite(value.scale) && value.scale >= 0.5 && value.scale <= 3 &&
        Number.isFinite(value.opacity) && value.opacity >= 30 && value.opacity <= 100;
}
export function readLibraryAppearance() {
    try {
        const raw = GM_getValue(LIBRARY_APPEARANCE_KEY, null), value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (valid(value)) return {scale: value.scale, opacity: value.opacity};
    } catch (_) { /* Invalid or unavailable preferences never block Library. */ }
    return {scale: 1, opacity: 95};
}
export function saveLibraryAppearance(value) {
    const record = {schemaVersion: 1, scale: value.scale, opacity: value.opacity};
    if (!valid(record)) throw new Error('Invalid Library appearance.');
    const raw = JSON.stringify(record);
    GM_setValue(LIBRARY_APPEARANCE_KEY, raw);
    if (GM_getValue(LIBRARY_APPEARANCE_KEY, null) !== raw) throw new Error('Library appearance could not be saved.');
}
