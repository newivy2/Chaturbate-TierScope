import { makeStorageId } from './record-validation.js';
import { roomFromUrl } from './room-context.js';

export const BACKGROUND_TRACKING_PREFIX = 'tierscope:background-tracking:v1:';
export const BACKGROUND_TRACKING_NOTICE = 'tierscope:background-tracking:changed:v1';

function roomName(value) {
    const room = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!room || !/^[a-z0-9_-]{1,100}$/.test(room) || !roomFromUrl('https://chaturbate.com/' + room + '/')) {
        throw new Error('Enter a room username, without a URL or spaces.');
    }
    return room;
}

export function createBackgroundTrackingPreferences(effects) {
    function decode(raw, room) {
        if (raw === undefined) return null;
        const value = JSON.parse(raw);
        if (!value || value.schemaVersion !== 1 || value.room !== room || typeof value.active !== 'boolean' ||
            typeof value.revision !== 'string' || !/^[a-z0-9-]{1,160}$/i.test(value.revision) ||
            !Number.isSafeInteger(value.changedAt) || value.changedAt < 0 || value.changedAt > 8640000000000000) {
            throw new Error('Background tracking settings for ' + room + ' are invalid.');
        }
        return Object.freeze({room, active: value.active, revision: value.revision, changedAt: value.changedAt});
    }
    function read(value) {
        const room = roomName(value);
        return decode(effects.get(BACKGROUND_TRACKING_PREFIX + room, undefined), room);
    }
    function list() {
        const choices = new Map(), errors = [];
        for (const key of effects.list().filter(key => key.startsWith(BACKGROUND_TRACKING_PREFIX))) {
            const room = key.slice(BACKGROUND_TRACKING_PREFIX.length);
            try {
                if (roomName(room) !== room) throw new Error('Invalid background tracking key.');
                const choice = read(room);
                if (choice) choices.set(room, choice);
            } catch (_) {errors.push(room);}
        }
        return {choices, error: errors.length ? 'Some background tracking settings are unavailable.' : ''};
    }
    function set(value, active, expectedRevision) {
        const room = roomName(value), key = BACKGROUND_TRACKING_PREFIX + room;
        if (typeof active !== 'boolean') throw new Error('Invalid background tracking choice.');
        const before = effects.get(key, undefined), previous = decode(before, room);
        if (expectedRevision !== undefined && previous?.revision !== expectedRevision) return {changed: false, choice: previous};
        if (previous?.active === active) return {changed: false, choice: previous};
        const record = {schemaVersion: 1, room, active, revision: effects.id(), changedAt: effects.now()};
        const raw = JSON.stringify(record);
        try {
            // A later user choice must never be replaced by a stale absence stop.
            if (effects.get(key, undefined) !== before) return {changed: false, choice: read(room)};
            effects.set(key, raw);
            if (effects.get(key, undefined) !== raw) throw new Error('Background tracking choice could not be verified.');
        } catch (error) {
            try {
                if (effects.get(key, undefined) === raw) {
                    if (before === undefined) effects.remove(key); else effects.set(key, before);
                }
            } catch (_) {throw new Error('Background tracking settings could not be saved or restored. Refresh before retrying.');}
            throw error;
        }
        try {effects.notice({version: 1, at: record.changedAt, revision: record.revision});} catch (_) { /* The periodic read also discovers changes. */ }
        return {changed: true, choice: decode(raw, room)};
    }
    return {read, list, set};
}

const preferences = createBackgroundTrackingPreferences({
    get: (key, fallback) => GM_getValue(key, fallback), set: (key, value) => GM_setValue(key, value),
    remove: key => GM_deleteValue(key), list: () => GM_listValues(), now: () => Date.now(), id: makeStorageId,
    notice: value => GM_setValue(BACKGROUND_TRACKING_NOTICE, value)
});
export function readBackgroundTrackingPreference(room) {return preferences.read(room);}
export function readBackgroundTrackingPreferences() {return preferences.list();}
export function setBackgroundTrackingPreference(room, active, expectedRevision) {return preferences.set(room, active, expectedRevision);}
