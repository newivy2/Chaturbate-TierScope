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

// Owns only explicitly requested comparisons. Each room has separate timing,
// absence evidence and cancellation; requests share one serial background lane.
export function createBackgroundComparison(effects) {
    const sessions = new Map(), listeners = new Set(), interval = effects.interval || INTERVAL_MS;
    const now = effects.now, setTimer = effects.setTimeout, clearTimer = effects.clearTimeout;
    const absenceStopMs = 15 * 60000, absenceGapMs = interval * 2 + TIMEOUT_MS;
    let latestRoom = null, timer = null, work = Promise.resolve();
    function emit() {for (const changed of listeners) {try {changed();} catch (_) { /* Views cannot interrupt acquisition. */ }}}
    function targetFor(room) {return sessions.get(room || latestRoom) || null;}
    function view(target) {
        return Object.freeze(target ? {room: target.room, active: target.active, status: target.status, message: target.message,
            sampleCount: target.history.timestamps.length, sampleAt: target.history.timestamps.at(-1) ?? null, nextAt: target.nextAt,
            absentSince: target.absentSince, absenceObservedAt: target.absenceObservedAt, absenceObservations: target.absenceObservations,
            absenceMs: target.absentSince === null ? 0 : Math.max(0, target.absenceObservedAt - target.absentSince),
            stoppedReason: target.stoppedReason} :
            {room: null, active: false, status: 'stopped', message: '', sampleCount: 0, sampleAt: null, nextAt: null,
                absentSince: null, absenceObservedAt: null, absenceObservations: 0, absenceMs: 0, stoppedReason: null});
    }
    function state(room) {return view(targetFor(room));}
    function states() {return Object.freeze([...sessions.values()].map(view));}
    function clearScheduled() {if (timer !== null) clearTimer(timer); timer = null;}
    function schedule() {
        clearScheduled();
        const due = [...sessions.values()].filter(target => target.active && !target.pending);
        if (!due.length) return;
        const nextAt = Math.min(...due.map(target => target.nextAt));
        timer = setTimer(() => {
            timer = null;
            for (const target of sessions.values()) if (target.active && !target.pending && target.nextAt <= now()) refresh(target.room);
            schedule();
        }, Math.max(0, nextAt - now()));
    }
    function resetAbsence(target) {target.absentSince = null; target.absenceObservedAt = null; target.absenceObservations = 0;}
    function stop(value = {}, options = {}) {
        const room = typeof value === 'string' ? normalizeBackgroundRoom(value) : null;
        const settings = room ? options : value || {};
        const targets = room ? [sessions.get(room)].filter(target => !!target) : [...sessions.values()];
        for (const target of targets) {
            target.generation++; target.active = false; target.status = 'stopped'; target.stoppedReason = 'manual';
            target.message = 'Comparison tracking stopped.'; target.nextAt = null;
            if (target.controller) target.controller.abort();
            if (settings.clear) sessions.delete(target.room);
        }
        if (!sessions.has(latestRoom)) latestRoom = [...sessions.keys()].at(-1) || null;
        schedule(); emit(); return room ? state(room) : state();
    }
    function current(target, token) {
        return sessions.get(target.room) === target && target.active && target.generation === token &&
            effects.host() === target.host && (!effects.ownership || target.ownership !== null && effects.ownership(target.room) === target.ownership);
    }
    function fresh(room, at, publisherId) {
        const history = {timestamps: [], breaks: []}, highs = {};
        for (const key of SERIES) {history[key] = []; highs[key] = {value: 0, time: null};}
        return {room, host: effects.host(), ownership: effects.ownership ? effects.ownership(room) : 'standalone',
            publisherId, startedAt: at, active: true, status: 'waiting', message: 'Waiting for the first audience sample.', nextAt: now(),
            history, highs, roomHigh: 0, roomHighTime: null, revision: 0, archive: null, failures: 0, gap: false,
            coveredMs: 0, controller: null, generation: 0, pending: null, stoppedReason: null,
            absentSince: null, absenceObservedAt: null, absenceObservations: 0};
    }
    function start(value) {
        const room = normalizeBackgroundRoom(value), existing = sessions.get(room);
        latestRoom = room;
        if (existing?.active) return state(room);
        if (existing) stop(room, {clear: true});
        const target = fresh(room, now(), 'background-' + effects.id());
        sessions.set(room, target); schedule(); emit(); return state(room);
    }
    function restore(value, checkpoint) {
        const room = normalizeBackgroundRoom(value);
        if (sessions.get(room)?.active) {latestRoom = room; return state(room);}
        if (typeof checkpoint?.archive?.room !== 'string' || checkpoint.archive.room.toLowerCase() !== room) throw new Error('Invalid saved background comparison.');
        const archive = effects.archive(room, checkpoint.archive.session), source = checkpoint?.source;
        const session = archive.session, startAt = session.sessionStartedAt;
        if (archive.room.toLowerCase() !== room || !source || source.room !== room || source.kind !== 'background' ||
            !/^background-[a-z0-9-]{1,140}$/i.test(source.publisherId) || !Number.isSafeInteger(startAt) || startAt < 0 ||
            source.sessionStartedAt !== startAt || source.sessionId !== 'background@' + startAt ||
            source.id !== source.publisherId + ':' + room + ':background@' + startAt ||
            !session.history.timestamps.length || session.history.timestamps.length > effects.maxHistory()) {
            throw new Error('Invalid saved background comparison.');
        }
        const target = fresh(room, startAt, source.publisherId);
        for (const [key, values] of Object.entries(session.history)) target.history[key] = values.slice();
        for (const key of SERIES) target.highs[key] = {...session.sessionHighs[key]};
        target.roomHigh = session.roomTotalHigh; target.roomHighTime = session.roomTotalHighTime;
        target.coveredMs = session.pausedElapsedTime;
        target.revision = /^\d+$/.test(source.revision) && Number.isSafeInteger(Number(source.revision)) && Number(source.revision) < Number.MAX_SAFE_INTEGER ? Number(source.revision) + 1 : 1;
        target.gap = true; target.message = 'Resuming this comparison. The interruption remains a recording gap.';
        if (sessions.has(room)) stop(room, {clear: true});
        sessions.set(room, target); latestRoom = room; schedule(); emit(); return state(room);
    }
    function sourceFor(target) {
        const sessionId = 'background@' + target.startedAt;
        return Object.freeze({version: 1, id: target.publisherId + ':' + target.room + ':' + sessionId,
            publisherId: target.publisherId, room: target.room, roomEpoch: 'background', sessionId, sessionStartedAt: target.startedAt,
            kind: 'background', status: target.status, lastSeenAt: now(), sampleAt: target.history.timestamps.at(-1) ?? null,
            sampleCount: target.history.timestamps.length, revision: String(target.revision), recordKey: null, recordSavedAt: null});
    }
    function readSources() {
        const outdated = [...sessions.values()].filter(target => effects.host() !== target.host);
        for (const target of outdated) stop(target.room, {clear: true});
        return {sources: [...sessions.values()].map(sourceFor), error: ''};
    }
    function readArchive(source) {
        const target = sessions.get(source.room), actual = target ? sourceFor(target) : null;
        if (!actual || source.id !== actual.id || source.revision !== actual.revision || !actual.sampleCount) {
            throw new Error('This background comparison changed or has no accepted samples yet.');
        }
        if (!target.archive) {
            const history = {}, sessionHighs = {};
            for (const [key, values] of Object.entries(target.history)) history[key] = values.slice();
            for (const key of SERIES) sessionHighs[key] = {...target.highs[key]};
            target.archive = freezeRecordingData(effects.archive(target.room, {schemaVersion: effects.schemaVersion(), timestamp: history.timestamps.at(-1),
                history, sessionStartedAt: target.startedAt, sessionStartEstimated: false, sessionHighs,
                roomTotalHigh: target.roomHigh, roomTotalHighTime: target.roomHighTime,
                pausedElapsedTime: target.coveredMs, isPaused: true, isStopped: false, stoppedAt: null, stopReason: null}));
        }
        return target.archive;
    }
    function observeAbsence(target, at) {
        if (target.absenceObservedAt === null || at <= target.absenceObservedAt || at - target.absenceObservedAt > absenceGapMs) {
            target.absentSince = at; target.absenceObservations = 0;
        }
        target.absenceObservedAt = at; target.absenceObservations++;
        target.gap = true; target.failures = 0;
        if (target.absenceObservations >= 2 && at - target.absentSince > absenceStopMs) {
            target.active = false; target.status = 'stopped'; target.stoppedReason = 'absence'; target.nextAt = null;
            target.message = 'Stopped after confirming the broadcaster absent for more than 15 minutes.';
        } else {
            target.status = 'waiting'; target.nextAt = at + interval;
            target.message = 'Broadcaster absent in the latest room list. Confirming absence before stopping after 15 minutes.';
        }
    }
    function accept(target, snapshot, at) {
        validateRoomSnapshot(snapshot);
        const owners = snapshot.users.filter(user => user.isOwner);
        if (!owners.length) {observeAbsence(target, at); return false;}
        if (owners.length !== 1 || owners[0].username.toLowerCase() !== target.room) {
            throw Object.assign(new Error('The response does not identify this room’s broadcaster. Waiting for a confirmed room response.'), {roomUnavailable: true});
        }
        resetAbsence(target);
        const history = target.history, previousAt = history.timestamps.at(-1);
        if (previousAt !== undefined && at <= previousAt) throw new Error('Waiting for the recording clock to advance.');
        const previousTotal = previousAt === undefined ? 0 : history.total.at(-1) + history.anonymous.at(-1), previousUsers = history.total.at(-1) || 0;
        if (previousTotal && (!snapshot.roomTotal || Math.abs(snapshot.roomTotal - previousTotal) / previousTotal <= 0.10 &&
            previousUsers && (previousUsers - snapshot.users.length) / previousUsers > 0.50)) throw new Error('Audience sample was incomplete.');
        const counts = Object.fromEntries(SERIES.map(key => [key, 0]));
        for (const user of snapshot.users) {
            if (user.tier && Object.prototype.hasOwnProperty.call(counts, user.tier)) counts[user.tier]++;
            if (user.gender === 'female' || user.gender === 'trans') counts['female-trans']++;
        }
        counts.total = snapshot.users.length; counts.anonymous = snapshot.anonymousCount;
        counts.withTokens = ['red', 'green', 'purple', 'pink', 'dark-blue', 'light-blue'].reduce((sum, key) => sum + counts[key], 0);
        const gap = previousAt !== undefined && (target.gap || at - previousAt > absenceGapMs);
        if (previousAt !== undefined && !gap) target.coveredMs += at - previousAt;
        history.timestamps.push(at); history.breaks.push(gap);
        for (const key of SERIES) {history[key].push(counts[key]); if (counts[key] > target.highs[key].value) target.highs[key] = {value: counts[key], time: at};}
        if (snapshot.roomTotal > target.roomHigh) {target.roomHigh = snapshot.roomTotal; target.roomHighTime = at;}
        if (history.timestamps.length > effects.maxHistory()) for (const values of Object.values(history)) values.shift();
        target.revision++; target.archive = null; target.gap = false; target.failures = 0;
        return true;
    }
    async function run(target, token) {
        let timeout = null, abortListener = null;
        try {
            if (!current(target, token)) {target.nextAt = now() + interval; return;}
            const permission = effects.permission();
            if (permission.offline || permission.blocked || permission.until > now()) {
                resetAbsence(target); target.gap = true; target.status = permission.offline ? 'offline' : 'retry';
                target.message = permission.offline ? 'Offline. Comparison will retry when the connection returns.' : 'Waiting for the shared API restriction to end.';
                target.nextAt = Math.max(now() + interval, permission.until || 0); emit(); return;
            }
            target.status = 'waiting'; target.message = 'Waiting for a background API request slot.'; emit();
            const canRequest = () => {const policy = effects.permission(); return current(target, token) && !policy.offline && !policy.blocked && policy.until <= now();};
            if (!await effects.waitForSlot(canRequest) || !canRequest()) {
                if (current(target, token)) {resetAbsence(target); target.gap = true; target.status = 'retry'; target.message = 'Background request deferred. Normal tracking has priority.'; target.nextAt = now() + interval; emit();}
                return;
            }
            const controller = new AbortController(); target.controller = controller;
            const snapshot = await Promise.race([effects.request(target.room, controller.signal), new Promise((resolve, reject) => {
                timeout = setTimer(() => {controller.abort(); reject(Object.assign(new Error('Background request timed out.'), {connectionFailure: true}));}, TIMEOUT_MS);
                abortListener = () => reject(new Error('Background request canceled.'));
                controller.signal.addEventListener('abort', abortListener, {once: true});
            })]);
            if (!current(target, token)) return;
            if (accept(target, snapshot, now())) {
                target.status = 'tracking'; target.message = 'Tracking ' + target.room + ' without opening their room. Updates about once a minute.';
                target.nextAt = now() + interval;
            }
            emit();
        } catch (error) {
            if (!current(target, token)) return;
            resetAbsence(target); target.gap = true; target.failures = Math.min(20, target.failures + 1);
            const status = error.status || 0, at = now();
            const wait = status === 429 || status >= 500 ? Math.min(900000, interval * Math.pow(2, target.failures - 1)) : interval;
            target.nextAt = Math.max(at + wait, error.retryAt || 0);
            if (status === 429 || status >= 500 || error.retryAt > at) effects.publish(target.nextAt);
            target.status = effects.permission().offline ? 'offline' : error.roomUnavailable || [400,401,403,404].includes(status) ? 'unavailable' : 'retry';
            target.message = status ? 'Compare without watching: HTTP ' + status + '. Room data unavailable; tracking will retry.' :
                'Compare without watching: ' + error.message + ' Previous samples are retained.';
            emit();
        } finally {
            if (timeout !== null) clearTimer(timeout);
            if (target.controller && abortListener) target.controller.signal.removeEventListener('abort', abortListener);
            target.controller = null;
            if (sessions.get(target.room) === target && target.active && !current(target, token)) {
                resetAbsence(target); target.gap = true; target.nextAt = now() + interval;
            }
        }
    }
    function refresh(room) {
        if (room === undefined) {
            return Promise.all([...sessions.values()].filter(target => target.active).map(target => refresh(target.room))).then(() => state());
        }
        const target = sessions.get(normalizeBackgroundRoom(room));
        if (!target || !target.active) return Promise.resolve(state(room));
        if (effects.host() !== target.host) {stop(target.room, {clear: true}); return Promise.resolve(state(room));}
        if (target.pending) return target.pending;
        const token = target.generation;
        const operation = work.then(() => run(target, token)).finally(() => {
            if (target.pending === operation) target.pending = null;
            schedule();
        });
        target.pending = operation; work = operation.catch(() => {}); schedule();
        return operation.then(() => state(room));
    }
    return {start, restore, stop, state, states, refresh, readSources, readArchive,
        subscribe(changed) {listeners.add(changed); return () => listeners.delete(changed);}};
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
let ownershipProvider = () => 'standalone';
export function setBackgroundComparisonOwnership(provider) {
    ownershipProvider = typeof provider === 'function' ? provider : () => 'standalone';
}
const comparison = createBackgroundComparison({
    now: () => Date.now(), host: () => location.origin, id: makeStorageId, ownership: room => ownershipProvider(room),
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
export function startBackgroundComparison(room) {return comparison.start(room);}
export function restoreBackgroundComparison(room, record) {return comparison.restore(room, record);}
export function stopBackgroundComparison(roomOrOptions = {}, options = {}) {return comparison.stop(roomOrOptions, options);}
export function getBackgroundComparisonState(room) {return comparison.state(room);}
export function getBackgroundComparisonStates() {return comparison.states();}
export function refreshBackgroundComparison(room) {return comparison.refresh(room);}
export function readBackgroundComparisonSources() {return comparison.readSources();}
export function readBackgroundComparisonArchive(source) {return comparison.readArchive(source);}
export function subscribeBackgroundComparison(changed) {return comparison.subscribe(changed);}
