export const LIBRARY_APPEARANCE_KEY = 'tierscope:library-appearance:v1';

function appearance(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) return null;
    const compactScale = Object.prototype.hasOwnProperty.call(value, 'compactScale') ? value.compactScale : 1;
    const compactOpacity = Object.prototype.hasOwnProperty.call(value, 'compactOpacity') ? value.compactOpacity : 95;
    if (![value.scale, compactScale].every(scale => Number.isFinite(scale) && scale >= 0.5 && scale <= 3) ||
        ![value.opacity, compactOpacity].every(opacity => Number.isFinite(opacity) && opacity >= 30 && opacity <= 100)) return null;
    return {scale: value.scale, opacity: value.opacity, compactScale, compactOpacity};
}
export function readLibraryAppearance() {
    try {
        const raw = GM_getValue(LIBRARY_APPEARANCE_KEY, null), value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const settings = appearance(value);
        if (settings) return settings;
    } catch (_) { /* Invalid or unavailable preferences never block Library. */ }
    return {scale: 1, opacity: 95, compactScale: 1, compactOpacity: 95};
}
export function saveLibraryAppearance(value) {
    const settings = appearance(value && typeof value === 'object' && !Array.isArray(value) ? {...value, schemaVersion: 1} : null);
    if (!settings) throw new Error('Invalid Library appearance.');
    const record = {schemaVersion: 1, ...settings};
    const raw = JSON.stringify(record);
    GM_setValue(LIBRARY_APPEARANCE_KEY, raw);
    if (GM_getValue(LIBRARY_APPEARANCE_KEY, null) !== raw) throw new Error('Library appearance could not be saved.');
}
