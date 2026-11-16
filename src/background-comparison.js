import { isBrowserOffline } from './connection-status.js';
import { freezeRecordingData } from './immutable-data.js';
import { makeStorageId } from './record-validation.js';
import { createRequestCoordinator, requestCoordinator } from './request-coordination.js';
import { roomFromUrl } from './room-context.js';
import { runtime } from './runtime.js';
import { validateSessionFile } from './session-file-format.js';
import { parseGetChatUserListResponse, validateRoomSnapshot } from './user-list-data.js';

const INTERVAL_MS = 60000, TIMEOUT_MS = 10000;
const SERIES = ['red', 'green', 'purple', 'pink', 'dark-blue', 'light-blue', 'gray', 'female-trans', 'withTokens', 'total', 'anonymous'];

export function normalizeBackgroundRoom(value) {
    if (typeof value !== 'string') throw new Error('Enter a room username.');
    const room = value.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,100}$/.test(room) || !roomFromUrl('https://chaturbate.com/' + room + '/')) {
        throw new Error('Enter a room username, without a URL or spaces.');
    }
    return room;
}

// Owns only this explicitly requested comparison. It never changes the host's
// live session, room restrictions, favorites, ATH or Library records.
export function createBackgroundComparison(effects) {
    let session = null, generation = 0, timer = null, pending = null;
    const listeners = new Set(), interval = effects.interval || INTERVAL_MS;
    const now = effects.now, setTimer = effects.setTimeout, clearTimer = effects.clearTimeout;
    function emit() {for (const changed of listeners) {try {changed();} catch (_) { /* A view cannot interrupt acquisition. */ }}}
    function state() {
        return Object.freeze(session ? {room: session.room, active: session.active, status: session.status, message: session.message,
            sampleCount: session.history.timestamps.length, sampleAt: session.history.timestamps.at(-1) ?? null, nextAt: session.nextAt} :
            {room: null, active: false, status: 'stopped', message: '', sampleCount: 0, sampleAt: null, nextAt: null});
    }
    function clearScheduled() {if (timer !== null) clearTimer(timer); timer = null;}
    function stop(options = {}) {
        generation++; clearScheduled();
        if (session) {
            session.active = false; session.status = 'stopped'; session.message = 'Comparison tracking stopped.'; session.nextAt = null;
            if (session.controller) session.controller.abort();
        }
        pending = null;
        if (options.clear) session = null;
        emit(); return state();
    }
    function current(target, token) {
        return session === target && target.active && generation === token && effects.host() === target.host;
    }
    function schedule(target) {
        clearScheduled();
        if (target === session && target.active) timer = setTimer(() => {timer = null; refresh();}, Math.max(0, target.nextAt - now()));
    }
    function start(value) {
        const room = normalizeBackgroundRoom(value);
        stop({clear: true});
        const at = now(), publisherId = 'background-' + effects.id(), history = {timestamps: [], breaks: []}, highs = {};
        for (const key of SERIES) {history[key] = []; highs[key] = {value: 0, time: null};}
        session = {room, host: effects.host(), publisherId, startedAt: at, active: true, status: 'waiting',
            message: 'Waiting for the first audience sample.', nextAt: at, history, highs, roomHigh: 0, roomHighTime: null,
            revision: 0, archive: null, failures: 0, gap: false, coveredMs: 0, controller: null};
        schedule(session); emit(); return state();
    }
    function readSources() {
        if (!session) return {sources: [], error: ''};
        if (effects.host() !== session.host) {stop({clear: true}); return {sources: [], error: ''};}
        const s = session, sessionId = 'background@' + s.startedAt;
        return {sources: [Object.freeze({version: 1, id: s.publisherId + ':' + s.room + ':' + sessionId,
            publisherId: s.publisherId, room: s.room, roomEpoch: 'background', sessionId, sessionStartedAt: s.startedAt,
            kind: 'background', status: s.status, lastSeenAt: now(), sampleAt: s.history.timestamps.at(-1) ?? null,
            sampleCount: s.history.timestamps.length, revision: String(s.revision), recordKey: null, recordSavedAt: null})], error: ''};
    }
    function readArchive(source) {
        const actual = readSources().sources[0];
        if (!actual || source.id !== actual.id || source.revision !== actual.revision || !actual.sampleCount) {
            throw new Error('This background comparison changed or has no accepted samples yet.');
        }
        if (!session.archive) {
            const history = {}, sessionHighs = {};
            for (const [key, values] of Object.entries(session.history)) history[key] = values.slice();
            for (const key of SERIES) sessionHighs[key] = {...session.highs[key]};
            const lastAt = history.timestamps.at(-1);
            session.archive = freezeRecordingData(effects.archive(session.room, {schemaVersion: effects.schemaVersion(), timestamp: lastAt,
                history, sessionStartedAt: session.startedAt, sessionStartEstimated: false, sessionHighs,
                roomTotalHigh: session.roomHigh, roomTotalHighTime: session.roomHighTime,
                pausedElapsedTime: session.coveredMs, isPaused: true, isStopped: false, stoppedAt: null, stopReason: null}));
        }
        return session.archive;
    }
    function accept(target, snapshot, at) {
        validateRoomSnapshot(snapshot);
        const owners = snapshot.users.filter(user => user.isOwner);
        if (owners.length !== 1 || owners[0].username.toLowerCase() !== target.room) {
            throw Object.assign(new Error('The response does not identify this room’s broadcaster. Waiting for a confirmed room response.'), {roomUnavailable: true});
        }
        const history = target.history, previousAt = history.timestamps.at(-1);
        if (previousAt !== undefined && at <= previousAt) throw new Error('Waiting for the recording clock to advance.');
        const previousTotal = previousAt === undefined ? 0 : history.total.at(-1) + history.anonymous.at(-1);
        const previousUsers = history.total.at(-1) || 0;
        if (previousTotal && (!snapshot.roomTotal || Math.abs(snapshot.roomTotal - previousTotal) / previousTotal <= 0.10 &&
            previousUsers && (previousUsers - snapshot.users.length) / previousUsers > 0.50)) throw new Error('Audience sample was incomplete.');
        const counts = Object.fromEntries(SERIES.map(key => [key, 0]));
        for (const user of snapshot.users) {
            if (user.tier && Object.prototype.hasOwnProperty.call(counts, user.tier)) counts[user.tier]++;
            if (user.gender === 'female' || user.gender === 'trans') counts['female-trans']++;
        }
        counts.total = snapshot.users.length; counts.anonymous = snapshot.anonymousCount;
        counts.withTokens = ['red', 'green', 'purple', 'pink', 'dark-blue', 'light-blue'].reduce((sum, key) => sum + counts[key], 0);
        const gap = previousAt !== undefined && (target.gap || at - previousAt > interval * 2 + TIMEOUT_MS);
        if (previousAt !== undefined && !gap) target.coveredMs += at - previousAt;
        history.timestamps.push(at); history.breaks.push(gap);
        for (const key of SERIES) {
            history[key].push(counts[key]);
            if (counts[key] > target.highs[key].value) target.highs[key] = {value: counts[key], time: at};
        }
        if (snapshot.roomTotal > target.roomHigh) {target.roomHigh = snapshot.roomTotal; target.roomHighTime = at;}
        if (history.timestamps.length > effects.maxHistory()) for (const values of Object.values(history)) values.shift();
        target.revision++; target.archive = null; target.gap = false; target.failures = 0;
    }
    async function run(target, token) {
        let timeout = null;
        try {
            const permission = effects.permission();
            if (permission.offline || permission.blocked || permission.until > now()) {
                target.gap = true; target.status = permission.offline ? 'offline' : 'retry';
                target.message = permission.offline ? 'Offline. Comparison will retry when the connection returns.' : 'Waiting for the shared API restriction to end.';
                target.nextAt = Math.max(now() + interval, permission.until || 0); emit(); return;
            }
            target.status = 'waiting'; target.message = 'Waiting for a background API request slot.'; emit();
            const canRequest = () => {
                if (!current(target, token)) return false;
                const policy = effects.permission();
                return !policy.offline && !policy.blocked && policy.until <= now();
            };
            if (!await effects.waitForSlot(canRequest) || !canRequest()) {
                if (current(target, token)) {target.status = 'retry'; target.message = 'Background request deferred. Normal tracking has priority.'; target.nextAt = now() + interval; emit();}
                return;
            }
            const controller = new AbortController(); target.controller = controller;
            const snapshot = await Promise.race([effects.request(target.room, controller.signal), new Promise((resolve, reject) => {
                timeout = setTimer(() => {controller.abort(); reject(Object.assign(new Error('Background request timed out.'), {connectionFailure: true}));}, TIMEOUT_MS);
            })]);
            if (!current(target, token)) return;
            accept(target, snapshot, now());
            target.status = 'tracking'; target.message = 'Tracking ' + target.room + ' without opening their room. Updates every 60 seconds.';
            target.nextAt = now() + interval; emit();
        } catch (error) {
            if (!current(target, token)) return;
            target.gap = true; target.failures = Math.min(20, target.failures + 1);
            const status = error.status || 0, at = now();
            const wait = status === 429 || status >= 500 ? Math.min(900000, interval * Math.pow(2, target.failures - 1)) : interval;
            target.nextAt = Math.max(at + wait, error.retryAt || 0);
            if (status === 429 || status >= 500 || error.retryAt > at) effects.publish(target.nextAt);
            target.active = ![400, 401, 403, 404].includes(status);
            target.status = target.active ? effects.permission().offline ? 'offline' : error.roomUnavailable ? 'unavailable' : 'retry' : 'unavailable';
            target.message = status ? 'Compare without watching: HTTP ' + status + (target.active ? '. Retrying after the API wait.' : '. Room data unavailable; check the username and try again.') :
                'Compare without watching: ' + error.message + ' Previous samples are retained.';
            if (!target.active) target.nextAt = null;
            emit();
        } finally {
            if (timeout !== null) clearTimer(timeout);
            if (session === target) target.controller = null;
        }
    }
    function refresh() {
        if (!session || !session.active) return Promise.resolve(state());
        if (effects.host() !== session.host) {stop({clear: true}); return Promise.resolve(state());}
        if (pending) return pending;
        const target = session, token = generation;
        clearScheduled();
        const operation = run(target, token).finally(() => {
            if (pending === operation) pending = null;
            if (current(target, token)) schedule(target);
        });
        pending = operation;
        return operation;
    }
    return {start, stop, state, refresh, readSources, readArchive, subscribe(changed) {listeners.add(changed); return () => listeners.delete(changed);}};
}

// Read-only adapter: foreground storage/publication failures can leave a newer
// restriction in that owner's memory than either shared store can report.
export function createBackgroundPermissionReader(effects) {
    return () => {
        const at = effects.now(), sharedUntil = effects.deadline();
        try {
            const raw = effects.read(), cached = effects.foregroundPolicy();
            const policies = raw === null ? [] : [JSON.parse(raw)];
            if (cached) policies.push(cached);
            let until = sharedUntil, blocked = false;
            for (const policy of policies) {
                if (!policy || !Number.isFinite(policy.until) || policy.until < 0 || policy.until > 8640000000000000 ||
                    ![0, 401, 403].includes(policy.blocked) || policy.serverUntil !== undefined &&
                    (!Number.isSafeInteger(policy.serverUntil) || policy.serverUntil < 0 || policy.serverUntil > 8640000000000000)) throw new Error('Invalid shared restriction.');
                blocked = blocked || policy.blocked !== 0;
                until = Math.max(until, policy.until, policy.serverUntil || 0);
            }
            return {offline: effects.offline(), blocked, until};
        } catch (_) {
            // An unreadable restriction fails closed locally, without mutating
            // the foreground owner's cache or its failure counters.
            return {offline: effects.offline(), blocked: true, until: Math.max(sharedUntil, at + INTERVAL_MS)};
        }
    };
}
const coordinator = createRequestCoordinator('tierscope', true);
const backgroundPermission = createBackgroundPermissionReader({
    now: () => Date.now(), offline: isBrowserOffline,
    read: () => GM_getValue(runtime.REQUEST_POLICY_KEY, null), foregroundPolicy: () => runtime.requestPolicyCache,
    deadline: () => Math.max(coordinator.deadline(), requestCoordinator.deadline())
});
const comparison = createBackgroundComparison({
    now: () => Date.now(), host: () => location.href, id: makeStorageId,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
    maxHistory: () => runtime.MAX_HISTORY_LENGTH, schemaVersion: () => runtime.STORAGE_SCHEMA_VERSION,
    archive: (room, session) => validateSessionFile({format: runtime.SESSION_FILE_FORMAT, formatVersion: runtime.SESSION_FILE_VERSION,
        producerVersion: runtime.TIERSCOPE_VERSION, room, session}),
    permission: backgroundPermission,
    waitForSlot: current => coordinator.waitForSlot(current), publish: until => coordinator.publish(until),
    request: async (room, signal) => {
        const url = new URL('/api/getchatuserlist/', location.origin);
        for (const [key, value] of Object.entries({roomname: room, private: 'false', sort_by: 'a', exclude_staff: 'false'})) url.searchParams.set(key, value);
        let response;
        try {response = await fetch(url.href, {method: 'GET', credentials: 'same-origin', mode: 'same-origin',
            headers: {'X-Requested-With': 'XMLHttpRequest'}, cache: 'no-store', redirect: 'error', signal});}
        catch (error) {throw Object.assign(new Error(error.message || 'Connection unavailable.'), {connectionFailure: true});}
        if (!response.ok) {
            const raw = response.headers.get('Retry-After'), at = Date.now();
            const retryAt = raw && /^\d+$/.test(raw.trim()) ? at + Number(raw.trim()) * 1000 : raw ? Date.parse(raw) : 0;
            throw Object.assign(new Error('API HTTP ' + response.status), {status: response.status,
                retryAt: Number.isSafeInteger(retryAt) && retryAt > at && retryAt <= 8640000000000000 ? retryAt : 0});
        }
        const snapshot = parseGetChatUserListResponse(await response.text());
        return {...snapshot, roomTotal: snapshot.totalUsers, source: 'API'};
    }
});
function discardBackgroundComparison() {comparison.stop({clear: true});}
export function startBackgroundComparison(room) {const state = comparison.start(room); window.addEventListener('pagehide', discardBackgroundComparison); return state;}
export function stopBackgroundComparison(options = {}) {const state = comparison.stop(options); if (options.clear) window.removeEventListener('pagehide', discardBackgroundComparison); return state;}
export function getBackgroundComparisonState() {return comparison.state();}
export function refreshBackgroundComparison() {return comparison.refresh();}
export function readBackgroundComparisonSources() {return comparison.readSources();}
export function readBackgroundComparisonArchive(source) {return comparison.readArchive(source);}
export function subscribeBackgroundComparison(changed) {return comparison.subscribe(changed);}
