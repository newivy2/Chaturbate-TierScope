import { getBackgroundComparisonStates, readBackgroundComparisonArchive, readBackgroundComparisonSources,
    refreshBackgroundComparison, restoreBackgroundComparison, setBackgroundComparisonOwnership,
    startBackgroundComparison, stopBackgroundComparison, subscribeBackgroundComparison } from './background-comparison.js';
import { BACKGROUND_RECORDING_NOTICE, cleanupExpiredBackgroundRecordings, readAllBackgroundRecordings, readBackgroundRecording, retryFavoriteBackgroundRecording, saveBackgroundRecording } from './background-recording-storage.js';
import { BACKGROUND_TRACKING_NOTICE, readBackgroundTrackingPreference, readBackgroundTrackingPreferences,
    setBackgroundTrackingPreference } from './background-tracking-preferences.js';
import { registerLiveModelSourceProvider } from './live-model-sources.js';
import { makeStorageId } from './record-validation.js';

const LEASE_PREFIX = 'tierscope:background-owner:v1:', LEASE_MS = 90000, PULSE_MS = 20000;

// Only the short claim/read-back is locked. A tab never holds the request queue
// lock while waiting for a network response or while its timers are suspended.
export function createBackgroundTrackingLeases(effects) {
    function read(room) {
        const raw = effects.get(LEASE_PREFIX + room);
        if (raw === null) return null;
        const value = JSON.parse(raw);
        if (!value || value.version !== 1 || value.room !== room ||
            ![value.owner, value.token, value.revision].every(id => typeof id === 'string' && /^[a-z0-9-]{1,160}$/i.test(id)) ||
            !Number.isSafeInteger(value.until) || value.until < 0 || value.until > 8640000000000000) throw new Error('Invalid tracking lease.');
        return value;
    }
    function owns(room, token) {
        try {const value = read(room); return !!value && value.owner === effects.owner && value.token === token && value.until > effects.now();}
        catch (_) {return false;}
    }
    async function claim(room, revision, previousToken) {
        const operation = () => {
            try {
                const before = read(room), at = effects.now();
                if (before && before.until > at && !(before.owner === effects.owner && before.token === previousToken && before.revision === revision)) return null;
                const token = before && before.owner === effects.owner && before.token === previousToken && before.revision === revision ? previousToken : effects.id();
                const value = {version: 1, room, owner: effects.owner, revision, token, until: at + LEASE_MS};
                effects.set(LEASE_PREFIX + room, JSON.stringify(value));
                const written = read(room);
                return written?.token === token && written.owner === effects.owner && written.revision === revision ? token : null;
            } catch (_) {return null;}
        };
        try {return await effects.lock(LEASE_PREFIX + room, operation);} catch (_) {return null;}
    }
    function release(room, token) {
        try {const value = read(room); if (value?.owner === effects.owner && value.token === token) effects.remove(LEASE_PREFIX + room);}
        catch (_) { /* An abandoned lease expires; it never permits this owner to keep polling. */ }
    }
    return {claim, owns, release};
}

export function createBackgroundTrackingLifecycle(effects) {
    const owned = new Map(), records = new Map(), failures = new Map(), libraryFailures = new Map(), listeners = new Set();
    let choices = new Map(), running = false, timer = null, pulse = null, generation = 0;
    let unsubscribeManager = null, unsubscribeChoices = null, notice = '';
    let cleanupAt = null;
    function emit() {for (const changed of listeners) {try {changed();} catch (_) { /* A view cannot interrupt tracking. */ }}}
    function managerStates() {return effects.manager.states();}
    function tokenFor(room) {
        const claim = owned.get(room);
        if (!running || !claim || !effects.leases.owns(room, claim.token)) return null;
        try {const choice = effects.preferences.read(room); return choice?.active && choice.revision === claim.revision ? claim.token : null;}
        catch (_) {return null;}
    }
    function checkpoint(room) {
        const claim = owned.get(room);
        if (!claim || !effects.leases.owns(room, claim.token)) return;
        const source = effects.manager.sources().sources.find(value => value.room === room);
        const state = managerStates().find(value => value.room === room);
        if (!source?.sampleCount || !state) return;
        const signature = [source.id, source.revision, state.active, state.status, state.message, state.nextAt, state.stoppedReason,
            state.absentSince, state.absenceObservedAt, state.absenceObservations, state.absenceMs].join('|');
        if (claim.savedSignature === signature) return;
        try {
            const archive = effects.manager.archive(source), result = effects.recordings.save(room, {archive, source, state});
            if (!result.saved) throw new Error(result.error || 'Recovery checkpoint could not be saved.');
            claim.savedSignature = signature;
            records.set(room, {room, archive, source, state, savedAt: effects.now()});
            const libraryError = result.library?.error;
            if (libraryError) libraryFailures.set(room, 'Favorite Library keep pending: ' + libraryError);
            else libraryFailures.delete(room);
            failures.delete(room);
        } catch (error) {failures.set(room, 'Recovery save pending: ' + error.message);}
    }
    function changed() {
        if (!running) return;
        for (const state of managerStates()) {
            if (!owned.has(state.room)) continue;
            checkpoint(state.room);
            if (state.stoppedReason === 'absence' && !state.active) {
                const claim = owned.get(state.room);
                try {
                    const result = effects.preferences.set(state.room, false, claim.revision);
                    if (result.choice) choices.set(state.room, result.choice);
                } catch (error) {failures.set(state.room, 'Could not save automatic tracking stop: ' + error.message);}
            }
        }
        emit();
    }
    function drop(room, save = false) {
        const claim = owned.get(room);
        if (!claim) return;
        // stop first, so a pending response loses its generation before release.
        if (managerStates().find(state => state.room === room)?.active) effects.manager.stop(room);
        if (save) checkpoint(room);
        effects.manager.stop(room, {clear: true}); owned.delete(room);
        effects.leases.release(room, claim.token);
    }
    function readStored() {
        const at = effects.now();
        if (effects.recordings.cleanup && (cleanupAt === null || at < cleanupAt || at - cleanupAt >= 300000)) {
            cleanupAt = at;
            try {effects.recordings.cleanup();} catch (_) { /* Retention maintenance must not prevent valid live tracking. */ }
        }
        const result = effects.preferences.list(); choices = result.choices; notice = result.error || '';
        const stored = effects.recordings.list(); records.clear();
        for (const record of stored) records.set(record.room, record);
    }
    async function reconcile() {
        if (!running) return;
        if (pulse) return pulse;
        const token = generation;
        // Install the in-flight marker before any storage reads, manager stops
        // or checkpoint notices can synchronously re-enter this function.
        const operation = Promise.resolve().then(async () => {
            if (!running || generation !== token) return;
            try {
                readStored();
                for (const [room, claim] of owned) {
                    const choice = choices.get(room);
                    if (!choice?.active || choice.revision !== claim.revision || !effects.leases.owns(room, claim.token)) drop(room, true);
                }
                for (const [room, choice] of choices) {
                    if (!choice.active) continue;
                    let lease = null;
                    try {
                        const previous = owned.get(room);
                        lease = await effects.leases.claim(room, choice.revision, previous?.token);
                        if (!running || generation !== token) {if (lease) effects.leases.release(room, lease); break;}
                        const latest = effects.preferences.read(room);
                        if (!latest?.active || latest.revision !== choice.revision) {if (lease) effects.leases.release(room, lease); continue;}
                        if (!lease) {if (previous) drop(room, false); continue;}
                        if (!previous || previous.token !== lease) {
                            if (previous) drop(room, false);
                            owned.set(room, {token: lease, revision: choice.revision, savedSignature: ''});
                            let record = null;
                            try {record = effects.recordings.read(room);}
                            catch (error) {failures.set(room, 'Previous recovery recording is unavailable: ' + error.message);}
                            if (record) effects.manager.restore(room, record); else effects.manager.start(room);
                        }
                    } catch (error) {
                        if (owned.has(room)) drop(room, false); else if (lease) effects.leases.release(room, lease);
                        failures.set(room, 'This background room could not resume: ' + error.message);
                    }
                }
                for (const room of owned.keys()) checkpoint(room);
                // A stopped or recovered favorite can still have a pending
                // Library write. Retrying that write must not renew recovery TTL.
                if (effects.recordings.retryFavorite) for (const room of records.keys()) {
                    try {
                        const result = effects.recordings.retryFavorite(room);
                        if (result.error) libraryFailures.set(room, 'Favorite Library keep pending: ' + result.error);
                        else libraryFailures.delete(room);
                    } catch (error) {libraryFailures.set(room, 'Favorite Library keep pending: ' + error.message);}
                }
            } catch (error) {
                notice = 'Background tracking settings are unavailable: ' + error.message;
                for (const room of [...owned.keys()]) drop(room, false);
            } finally {emit();}
        });
        pulse = operation;
        try {await operation;} finally {if (pulse === operation) pulse = null;}
    }
    function initialize() {
        if (running) return;
        running = true; generation++; cleanupAt = null;
        effects.manager.ownership(tokenFor);
        unsubscribeManager = effects.manager.subscribe(changed);
        unsubscribeChoices = effects.subscribe(() => {reconcile();});
        timer = effects.setInterval(() => {reconcile();}, PULSE_MS);
        reconcile();
    }
    async function start(room) {
        initialize();
        // Initialization may still be reading the old list. Finish that read
        // before committing a new choice so this start cannot miss its pulse.
        if (pulse) await pulse;
        const result = effects.preferences.set(room, true);
        if (result.choice) choices.set(result.choice.room, result.choice);
        await reconcile();
        return states().find(value => value.room === result.choice?.room) || null;
    }
    function stop(room, options = {}) {
        if (!room) {
            for (const state of states()) if (state.active) stop(state.room, options);
            return states();
        }
        const result = effects.preferences.set(room, false);
        if (result.choice) choices.set(result.choice.room, result.choice);
        const normalized = result.choice?.room || room;
        drop(normalized, true); emit();
        return states().find(value => value.room === normalized) || null;
    }
    function states() {
        const local = new Map(managerStates().map(state => [state.room, state])), result = [];
        const rooms = new Set([...choices.keys(), ...records.keys(), ...local.keys()]);
        for (const room of rooms) {
            const choice = choices.get(room), record = records.get(room), state = local.get(room) || record?.state;
            if (!choice?.active && !state && !record) continue;
            const active = !!choice?.active;
            const value = state ? {...state, active} : {room, active, status: 'waiting', message: 'Waiting for an available tracking tab.', sampleCount: 0, sampleAt: null, nextAt: null};
            if (!active && state?.active) {
                value.status = 'stopped'; value.message = 'Comparison tracking stopped.'; value.nextAt = null;
            }
            const warning = [failures.get(room), libraryFailures.get(room), notice].filter(value => !!value).join(' ');
            if (warning) {value.persistenceError = warning; value.message += ' ' + warning;}
            result.push(Object.freeze(value));
        }
        return result.sort((a, b) => a.room.localeCompare(b.room));
    }
    function sources() {
        const local = new Map(effects.manager.sources().sources.map(source => [source.room, source])), result = [];
        for (const state of states()) {
            let source = local.get(state.room) || records.get(state.room)?.source;
            if (!source) continue;
            source = {...source};
            if (!state.active) source.status = 'stopped';
            result.push(Object.freeze(source));
        }
        return {sources: result, error: notice};
    }
    function archive(source) {
        const local = effects.manager.sources().sources.find(value => value.id === source.id);
        if (local && local.revision === source.revision) return effects.manager.archive(local);
        const record = records.get(source.room);
        if (!record || record.source.id !== source.id || record.source.revision !== source.revision) throw new Error('This background recording changed. Refresh the comparison.');
        return record.archive;
    }
    async function refresh(room) {await reconcile(); await effects.manager.refresh(room); return states();}
    function shutdown() {
        if (!running) return;
        for (const room of [...owned.keys()]) drop(room, true);
        running = false; generation++;
        if (timer !== null) effects.clearInterval(timer); timer = null;
        if (unsubscribeManager) unsubscribeManager(); unsubscribeManager = null;
        if (unsubscribeChoices) unsubscribeChoices(); unsubscribeChoices = null;
        emit();
    }
    return {initialize, shutdown, start, stop, states, sources, archive, refresh, reconcile,
        subscribe(changed) {listeners.add(changed); return () => listeners.delete(changed);}};
}

const owner = makeStorageId();
const leases = createBackgroundTrackingLeases({
    owner, now: () => Date.now(), id: makeStorageId,
    get: key => window.localStorage.getItem(key), set: (key, value) => window.localStorage.setItem(key, value), remove: key => window.localStorage.removeItem(key),
    lock: (key, action) => window.navigator?.locks?.request ? window.navigator.locks.request(key, action) : Promise.resolve(action())
});
const tracking = createBackgroundTrackingLifecycle({
    now: () => Date.now(), leases,
    preferences: {read: readBackgroundTrackingPreference, list: readBackgroundTrackingPreferences, set: setBackgroundTrackingPreference},
    recordings: {read: readBackgroundRecording, list: readAllBackgroundRecordings, save: saveBackgroundRecording,
        retryFavorite: retryFavoriteBackgroundRecording, cleanup: cleanupExpiredBackgroundRecordings},
    manager: {states: getBackgroundComparisonStates, sources: readBackgroundComparisonSources, archive: readBackgroundComparisonArchive,
        start: startBackgroundComparison, stop: stopBackgroundComparison, restore: restoreBackgroundComparison,
        refresh: refreshBackgroundComparison, subscribe: subscribeBackgroundComparison, ownership: setBackgroundComparisonOwnership},
    setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id),
    subscribe: changed => {
        const listeners = [];
        try {if (typeof GM_addValueChangeListener === 'function') for (const key of [BACKGROUND_TRACKING_NOTICE, BACKGROUND_RECORDING_NOTICE]) listeners.push(GM_addValueChangeListener(key, changed));} catch (_) { /* Periodic reads still recover. */ }
        return () => {try {if (typeof GM_removeValueChangeListener === 'function') for (const listener of listeners) GM_removeValueChangeListener(listener);} catch (_) { /* Already removed. */ }};
    }
});
let providerCleanup = null, lifecycleInitialized = false;
export function initializeBackgroundTracking() {
    if (!lifecycleInitialized) {
        lifecycleInitialized = true;
        providerCleanup = registerLiveModelSourceProvider({readSources: () => tracking.sources(), readArchive: source => tracking.archive(source), subscribe: changed => tracking.subscribe(changed)});
        window.addEventListener('pagehide', shutdownBackgroundTracking);
    }
    tracking.initialize();
}
export function shutdownBackgroundTracking() {tracking.shutdown(); if (providerCleanup) {providerCleanup(); providerCleanup = null;} lifecycleInitialized = false; window.removeEventListener('pagehide', shutdownBackgroundTracking);}
export function tickBackgroundTracking() {initializeBackgroundTracking(); return tracking.reconcile();}
export async function startPersistentBackgroundComparison(room) {initializeBackgroundTracking(); return tracking.start(room);}
export function stopPersistentBackgroundComparison(room, options) {return tracking.stop(room, options);}
export function getPersistentBackgroundComparisonStates() {return tracking.states();}
export function getPersistentBackgroundComparisonState(room) {return tracking.states().find(state => !room || state.room === room) || {room: null, active: false, status: 'stopped', message: '', sampleCount: 0, sampleAt: null, nextAt: null};}
export function readPersistentBackgroundComparisonSources() {return tracking.sources();}
export function readPersistentBackgroundComparisonArchive(source) {return tracking.archive(source);}
export function refreshPersistentBackgroundComparison(room) {initializeBackgroundTracking(); return tracking.refresh(room);}
export function subscribePersistentBackgroundComparison(changed) {return tracking.subscribe(changed);}
