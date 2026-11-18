import { freezeRecordingData } from './immutable-data.js';
import { readAutomaticKeepingMinutes } from './library-capacity.js';
import { readModelFavorite } from './library-models.js';
import { recordedCoverageMs } from './library-query.js';
import { decodeLiveModelSource, LIVE_MODEL_PREFIX } from './live-model-data.js';
import { isStorageTimestamp, makeStorageId } from './record-validation.js';
import { roomFromUrl } from './room-context.js';
import { validateSessionFile } from './session-file-format.js';
import { createLibraryReader, keepSessionInLibrary } from './session-library.js';

export const BACKGROUND_RECORDING_PREFIX = 'tierscope:background-recording:v1:';
export const BACKGROUND_RECORDING_NOTICE = 'tierscope:background-recording-notice:v1';
export const BACKGROUND_RECORDING_TTL_MS = 3 * 60 * 60 * 1000;

function recordingRoom(value) {
    if (typeof value !== 'string') throw new Error('Invalid background recording room.');
    const room = value.toLowerCase();
    if (value !== value.trim() || !/^[a-z0-9_-]{1,100}$/.test(room) || !roomFromUrl('https://chaturbate.com/' + room + '/')) {
        throw new Error('Invalid background recording room.');
    }
    return room;
}

// Recovery persistence and Library keeping are separate writes. Either can fail
// while the manager retains the accepted samples in memory.
export function createBackgroundRecordingStore(effects) {
    const libraryCheckpoints = new Map();
    const keyFor = room => BACKGROUND_RECORDING_PREFIX + recordingRoom(room);
    function clean(room, input, savedAt) {
        const archive = effects.validateArchive(input?.archive), raw = input?.source, state = input?.state;
        if (!isStorageTimestamp(savedAt) || savedAt > effects.now() + 5000 || archive.room.toLowerCase() !== room ||
            !raw || raw.kind !== 'background' || raw.recordKey !== null || raw.recordSavedAt !== null ||
            typeof raw.revision !== 'string' || raw.revision.length > 512) throw new Error('Invalid background recording.');
        // Do not turn old checkpoints into a different source or discard their
        // history solely because an owner heartbeat is now stale.
        const metadata = decodeLiveModelSource({...raw, revision: ''}, LIVE_MODEL_PREFIX + raw.publisherId, effects.now());
        const history = archive.session.history, lastAt = history.timestamps.at(-1);
        if (!metadata || metadata.room !== room || metadata.roomEpoch !== 'background' ||
            metadata.sessionStartedAt !== archive.session.sessionStartedAt || metadata.sampleCount !== history.timestamps.length ||
            metadata.sampleAt !== lastAt || metadata.lastSeenAt > savedAt + 5000 || lastAt > savedAt + 5000) {
            throw new Error('Background source and recording do not match.');
        }
        if (!state || state.room !== room || typeof state.active !== 'boolean' || state.status !== metadata.status ||
            typeof state.message !== 'string' || state.message.length > 2000 || state.sampleCount !== metadata.sampleCount ||
            state.sampleAt !== metadata.sampleAt || !(state.nextAt === null || isStorageTimestamp(state.nextAt))) {
            throw new Error('Invalid background recording status.');
        }
        const absentSince = state.absentSince ?? null, absenceObservations = state.absenceObservations ?? 0;
        const absenceObservedAt = state.absenceObservedAt ?? absentSince;
        const absenceMs = absentSince === null ? 0 : Math.max(0, absenceObservedAt - absentSince);
        const stoppedReason = state.stoppedReason ?? null;
        if (!(absentSince === null || isStorageTimestamp(absentSince) && absentSince <= savedAt + 5000) ||
            !Number.isSafeInteger(absenceObservations) || absenceObservations < 0 ||
            !(absenceObservedAt === null || isStorageTimestamp(absenceObservedAt) && absenceObservedAt <= savedAt + 5000) ||
            absentSince === null && (absenceObservedAt !== null || absenceObservations !== 0) ||
            absentSince !== null && (absenceObservedAt === null || absenceObservedAt < absentSince) ||
            state.absenceMs !== undefined && state.absenceMs !== absenceMs ||
            !(stoppedReason === null || typeof stoppedReason === 'string' && stoppedReason.length <= 100)) {
            throw new Error('Invalid background absence status.');
        }
        return freezeRecordingData({schemaVersion: 1, room, savedAt, archive,
            source: {...metadata, kind: 'background', revision: raw.revision},
            state: {room, active: state.active, status: state.status, message: state.message,
                sampleCount: state.sampleCount, sampleAt: state.sampleAt, nextAt: state.nextAt,
                absentSince, absenceObservedAt, absenceObservations, absenceMs, stoppedReason}});
    }
    function decode(room, raw) {
        const record = JSON.parse(raw);
        if (!record || record.schemaVersion !== 1 || record.room !== room) throw new Error('Unsupported background recording.');
        return clean(room, record, record.savedAt);
    }
    function read(room) {
        room = recordingRoom(room);
        const raw = effects.get(keyFor(room), undefined);
        if (raw === undefined) return null;
        const record = decode(room, raw);
        return effects.now() - record.savedAt > BACKGROUND_RECORDING_TTL_MS ? null : record;
    }
    function readAll() {
        const records = [];
        for (const key of effects.list().filter(value => value.startsWith(BACKGROUND_RECORDING_PREFIX))) {
            try {
                const room = key.slice(BACKGROUND_RECORDING_PREFIX.length);
                if (keyFor(room) !== key) continue;
                const record = read(room); if (record) records.push(record);
            } catch (_) { /* Preserve damaged originals; healthy rooms still recover. */ }
        }
        return records;
    }
    function keepFavorite(record) {
        const room = record.room, state = {saved: false, waiting: false, error: ''};
        try {
            const preference = effects.favorite(room);
            if (!preference.favorite || !preference.autoKeep) {libraryCheckpoints.delete(room); return state;}
            const minimumMinutes = effects.minimumMinutes(), coveredMs = recordedCoverageMs(record.archive.session.history);
            Object.assign(state, {minimumMinutes, coveredMs, waiting: coveredMs < minimumMinutes * 60000});
            if (state.waiting) return state;
            const signature = [record.source.id, record.source.revision, record.state.active, record.state.status,
                record.state.stoppedReason].join(':');
            if (libraryCheckpoints.get(room) === signature) return {...state, saved: true};
            const result = effects.keep(record.archive);
            libraryCheckpoints.set(room, signature);
            return {...state, saved: true, ...result};
        } catch (error) {return {...state, error: error.message || String(error)};}
    }
    function save(room, input) {
        let record;
        try {room = recordingRoom(room); record = clean(room, input, effects.now());}
        catch (error) {return {saved: false, error: error.message || String(error), library: {saved: false, waiting: false, error: ''}};}
        const key = keyFor(room), value = JSON.stringify(record);
        let saved = false, error = '', before, attempted = false;
        try {
            before = effects.get(key, undefined);
            if (before !== undefined) {
                const previous = decode(room, before), prior = previous.archive.session, next = record.archive.session;
                if (prior.sessionStartedAt > next.sessionStartedAt || prior.sessionStartedAt === next.sessionStartedAt &&
                    (previous.source.sampleAt > record.source.sampleAt || previous.source.sampleCount > record.source.sampleCount)) {
                    throw new Error('A newer background recording already exists.');
                }
            }
            if (effects.get(key, undefined) !== before) throw new Error('Background recording changed in another tab.');
            attempted = true; effects.set(key, value);
            if (effects.get(key, undefined) !== value) throw new Error('Background recording save could not be verified.');
            saved = true;
        } catch (failure) {
            error = failure.message || String(failure);
            try {
                if (attempted && effects.get(key, undefined) === value) {
                    if (before === undefined) effects.remove(key); else effects.set(key, before);
                }
            } catch (_) {error += ' Recovery rollback could not be verified.';}
        }
        // A recovery-key failure need not prevent a favorite's independently
        // authorized Library save, and a Library failure cannot erase recovery.
        const library = keepFavorite(record);
        if (library.error) error = (error ? error + ' ' : '') + library.error;
        if (saved && effects.notice) {
            try {effects.notice({version: 1, room, at: record.savedAt, revision: record.source.revision});}
            catch (_) { /* Discovery polling recovers missed notifications. */ }
        }
        return {saved, error, library};
    }
    function retryFavorite(room) {
        try {
            const record = read(room);
            if (!record) return {saved: false, waiting: false, error: 'No recent background recovery recording is available.'};
            // Keeping a favorite is independent of session recovery. Retrying a
            // full Library must not refresh the three-hour recovery lifetime.
            return keepFavorite(record);
        } catch (error) {return {saved: false, waiting: false, error: error.message || String(error)};}
    }
    function cleanupExpired() {
        const result = {cleared: 0, changed: 0, damaged: 0};
        for (const key of effects.list().filter(value => value.startsWith(BACKGROUND_RECORDING_PREFIX))) {
            try {
                const room = key.slice(BACKGROUND_RECORDING_PREFIX.length);
                if (keyFor(room) !== key) throw new Error('Invalid background recording key.');
                const before = effects.get(key, undefined), record = decode(room, before);
                if (effects.now() - record.savedAt <= BACKGROUND_RECORDING_TTL_MS) continue;
                if (effects.get(key, undefined) !== before) {result.changed++; continue;}
                effects.remove(key);
                if (effects.get(key, undefined) === undefined) result.cleared++; else result.changed++;
            } catch (_) {result.damaged++;}
        }
        return result;
    }
    return {read, readAll, save, retryFavorite, cleanupExpired};
}

const libraryReader = createLibraryReader();
const store = createBackgroundRecordingStore({
    now: () => Date.now(), get: (key, fallback) => GM_getValue(key, fallback),
    set: (key, value) => GM_setValue(key, value), remove: key => GM_deleteValue(key), list: () => GM_listValues(),
    notice: notice => GM_setValue(BACKGROUND_RECORDING_NOTICE, {...notice, revision: makeStorageId()}),
    validateArchive: validateSessionFile, favorite: readModelFavorite, minimumMinutes: readAutomaticKeepingMinutes,
    keep: archive => keepSessionInLibrary(archive, '', libraryReader)
});
export function readBackgroundRecording(room) {return store.read(room);}
export function readAllBackgroundRecordings() {return store.readAll();}
export function saveBackgroundRecording(room, value) {return store.save(room, value);}
export function retryFavoriteBackgroundRecording(room) {return store.retryFavorite(room);}
export function cleanupExpiredBackgroundRecordings() {return store.cleanupExpired();}
