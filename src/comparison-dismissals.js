import { isStorageTimestamp, makeStorageId } from './record-validation.js';

export const COMPARISON_DISMISSAL_PREFIX = 'tierscope:comparison-dismissal:v1:';
export const COMPARISON_DISMISSAL_NOTICE = 'tierscope:comparison-dismissal:changed:v1';

function identity(value) {
    if (!value || typeof value.id !== 'string' || !value.id.length || value.id.length > 512 ||
        /[\s\x00-\x1f\x7f]/.test(value.id) || typeof value.room !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(value.room) ||
        !(value.sessionStartedAt === null || isStorageTimestamp(value.sessionStartedAt)) ||
        !Number.isSafeInteger(value.sampleCount) || value.sampleCount < 0 || value.sampleCount > 1000000 ||
        !(value.sampleCount === 0 ? value.sampleAt === null : isStorageTimestamp(value.sampleAt))) {
        throw new Error('Invalid comparison entry.');
    }
    return {id: value.id, room: value.room.toLowerCase(), sessionStartedAt: value.sessionStartedAt,
        sampleAt: value.sampleAt, sampleCount: value.sampleCount};
}

function keyFor(id) {return COMPARISON_DISMISSAL_PREFIX + id;}

// A view preference only: neither acquisition nor recording storage consults
// this store. Metadata heartbeats cannot revive a dismissed recording; accepted
// samples or a different source/session can. Reads never erase stored data.
export function createComparisonDismissals(effects) {
    const cache = new Map(), listeners = new Set();
    let detachRemote = null;
    function decode(raw, key) {
        if (raw === undefined) return null;
        const value = JSON.parse(raw), marker = identity(value);
        if (value.schemaVersion !== 1 || !isStorageTimestamp(value.dismissedAt) || keyFor(marker.id) !== key) {
            throw new Error('Invalid comparison cleanup preference.');
        }
        return Object.freeze({...marker, schemaVersion: 1, dismissedAt: value.dismissedAt});
    }
    function read(id) {
        const at = effects.now(), cached = cache.get(id);
        if (cached && at >= cached.at && at - cached.at < 1000) return cached.marker;
        const key = keyFor(id), raw = effects.get(key, undefined), marker = decode(raw, key);
        cache.set(id, {at, marker}); return marker;
    }
    function isHidden(source) {
        try {
            const value = identity(source), marker = read(value.id);
            return !!marker && marker.room === value.room && marker.sessionStartedAt === value.sessionStartedAt &&
                value.sampleCount <= marker.sampleCount && (value.sampleAt === null || marker.sampleAt !== null && value.sampleAt <= marker.sampleAt);
        } catch (_) {return false;}
    }
    function changed() {
        cache.clear();
        for (const listener of listeners) {try {listener();} catch (_) { /* A view cannot undo the saved preference. */ }}
    }
    function notify() {
        changed();
        try {if (effects.notice) effects.notice();} catch (_) { /* Periodic readers still discover stored preferences. */ }
    }
    function dismiss(sources) {
        if (!Array.isArray(sources)) throw new Error('Choose comparison entries to clear.');
        const values = new Map(sources.map(source => {const value = identity(source); return [value.id, value];}));
        let count = 0;
        for (const value of values.values()) {
            const key = keyFor(value.id), before = effects.get(key, undefined), previous = decode(before, key);
            const same = previous?.room === value.room && previous.sessionStartedAt === value.sessionStartedAt;
            const sampleAt = same ? previous.sampleAt === null ? value.sampleAt : value.sampleAt === null ? previous.sampleAt :
                Math.max(previous.sampleAt, value.sampleAt) : value.sampleAt;
            const sampleCount = same ? Math.max(previous.sampleCount, value.sampleCount) : value.sampleCount;
            if (same && previous.sampleAt === sampleAt && previous.sampleCount === sampleCount) continue;
            const record = {...value, sampleAt, sampleCount, schemaVersion: 1, dismissedAt: effects.now()};
            if (!isStorageTimestamp(record.dismissedAt)) throw new Error('Invalid cleanup timestamp.');
            const raw = JSON.stringify(record);
            try {
                if (effects.get(key, undefined) !== before) throw new Error('Comparison cleanup preferences changed in another tab. Try again.');
                effects.set(key, raw);
                if (effects.get(key, undefined) !== raw) throw new Error('Comparison cleanup preference could not be verified.');
            } catch (error) {
                try {
                    if (effects.get(key, undefined) === raw) {
                        if (before === undefined) effects.remove(key); else effects.set(key, before);
                    }
                } catch (_) { /* Preserve any concurrent preference rather than overwrite it. */ }
                notify(); throw error;
            }
            count++;
        }
        if (count) notify(); return count;
    }
    function removeMatching(matches) {
        let count = 0;
        try {
            for (const key of effects.list().filter(key => key.startsWith(COMPARISON_DISMISSAL_PREFIX))) {
                const before = effects.get(key, undefined);
                let marker;
                try {marker = decode(before, key);} catch (_) {continue;}
                if (!marker || !matches(marker)) continue;
                if (effects.get(key, undefined) !== before) throw new Error('Comparison cleanup preferences changed in another tab. Try again.');
                effects.remove(key);
                if (effects.get(key, undefined) !== undefined) throw new Error('Comparison cleanup preference could not be cleared.');
                count++;
            }
        } catch (error) {notify(); throw error;}
        if (count) notify(); return count;
    }
    function clearRoom(room) {
        if (typeof room !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(room)) throw new Error('Invalid room name.');
        return removeMatching(marker => marker.room === room.toLowerCase());
    }
    // Only call with a complete discovery, including retained closed sources.
    // No automatic age expiry: an unchanged stopped tab must stay dismissed.
    function prune(knownSources) {
        const ids = new Set(knownSources.map(source => identity(source).id));
        return removeMatching(marker => !ids.has(marker.id));
    }
    function subscribe(listener) {
        cache.clear(); listeners.add(listener);
        if (listeners.size === 1 && effects.subscribe) detachRemote = effects.subscribe(changed);
        return () => {
            listeners.delete(listener);
            if (!listeners.size && detachRemote) {detachRemote(); detachRemote = null;}
        };
    }
    return {isHidden, dismiss, clearRoom, prune, subscribe};
}

const dismissals = createComparisonDismissals({
    get: (key, fallback) => GM_getValue(key, fallback), set: (key, value) => GM_setValue(key, value),
    remove: key => GM_deleteValue(key), list: () => GM_listValues(), now: () => Date.now(),
    notice: () => GM_setValue(COMPARISON_DISMISSAL_NOTICE, {version: 1, at: Date.now(), revision: makeStorageId()}),
    subscribe: changed => {
        let id = null;
        try {if (typeof GM_addValueChangeListener === 'function') id = GM_addValueChangeListener(COMPARISON_DISMISSAL_NOTICE,
            (key, before, after, remote) => {if (remote !== false) changed();});} catch (_) { /* Short-lived cache still refreshes on reads. */ }
        return () => {try {if (id !== null && typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(id);} catch (_) { /* Already removed. */ }};
    }
});
export function isComparisonDismissed(source) {return dismissals.isHidden(source);}
export function dismissComparisonSources(sources) {return dismissals.dismiss(sources);}
export function clearComparisonDismissalsForRoom(room) {return dismissals.clearRoom(room);}
export function subscribeComparisonDismissals(listener) {return dismissals.subscribe(listener);}
