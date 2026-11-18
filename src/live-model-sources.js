import { isBrowserOffline } from './connection-status.js';
import { freezeRecordingData } from './immutable-data.js';
import { decodeInMemoryLiveModelSource, decodeLiveModelSource, liveModelSourceStatus, LIVE_MODEL_PREFIX, LIVE_MODEL_NOTICE, LIVE_MODEL_HEARTBEAT_MS } from './live-model-data.js';
import { getStorageKey, makeStorageId } from './record-validation.js';
import { roomFromUrl } from './room-context.js';
import { runtime } from './runtime.js';
import { validateSessionFile } from './session-file-format.js';
import { getSessionSaveState } from './session-health.js';
import { getRoomEpoch } from './storage.js';

// The adapter owns discovery and immutable read caches. It never starts scans,
// writes live owners, adds Library sessions, or directs the panel.
export function createLiveModelExchange(effects) {
    const archives = new Map();
    let discoveryKeys = null, discoveryAt = -Infinity;
    function invalidate() { discoveryKeys = null; }
    function readSources(force = false) {
        if (force) invalidate();
        const sources = [], errors = [];
        const at = effects.now();
        try {
            if (!discoveryKeys || at < discoveryAt || at - discoveryAt >= 10000) {
                discoveryKeys = effects.list().filter(key => key.startsWith(LIVE_MODEL_PREFIX));
                discoveryAt = at;
            }
        }
        catch (_) { return {sources, error: 'Live tab discovery is unavailable. Existing chart snapshots are retained.'}; }
        for (const key of discoveryKeys) {
            try {
                const source = decodeLiveModelSource(effects.get(key, null), key, at);
                if (!source || at - source.lastSeenAt > 3 * 60 * 60 * 1000) continue;
                source.status = liveModelSourceStatus(source, at, effects.epoch(source.room));
                sources.push(Object.freeze(source));
            } catch (_) { errors.push(key); }
        }
        sources.sort((a, b) => a.room.localeCompare(b.room) || a.id.localeCompare(b.id));
        const currentIds = new Set(sources.map(source => source.id));
        for (const id of archives.keys()) if (!currentIds.has(id)) archives.delete(id);
        return {sources, error: errors.length ? 'Some live tabs could not be read. Their previous snapshots are retained.' : ''};
    }
    function readArchive(source) {
        const at = effects.now(), key = LIVE_MODEL_PREFIX + source.publisherId;
        const current = decodeLiveModelSource(effects.get(key, null), key, at);
        if (!current || current.id !== source.id || current.recordKey !== source.recordKey || current.revision !== source.revision ||
            current.roomEpoch !== effects.epoch(current.room) || ['reset', 'unavailable'].includes(current.status) || !current.recordKey) {
            throw new Error('This live source changed or is unavailable. Its previous chart snapshot is retained.');
        }
        const cached = archives.get(current.id);
        if (cached?.revision === current.revision) return cached.archive;
        const raw = effects.get(current.recordKey, null);
        if (typeof raw !== 'string') throw new Error('The live session record is unavailable.');
        const data = JSON.parse(raw), times = data?.history?.timestamps;
        if (data.roomEpoch !== current.roomEpoch || data.sessionStartedAt !== current.sessionStartedAt || data.timestamp !== current.recordSavedAt ||
            !Array.isArray(times) || times.length !== current.sampleCount || times.at(-1) !== current.sampleAt) {
            throw new Error('The live session changed while reading. Waiting for its next announcement.');
        }
        const archive = freezeRecordingData(effects.archive(current.room, data));
        // A Reset between the metadata read and archive validation cannot make
        // an old publisher appear current again.
        if (effects.epoch(current.room) !== current.roomEpoch) throw new Error('This room was reset. Choose its new session.');
        archives.set(current.id, {revision: current.revision, archive});
        return archive;
    }
    function clear() { archives.clear(); invalidate(); }
    function retain(ids) {
        const selected = ids instanceof Set ? ids : new Set(ids);
        for (const id of archives.keys()) if (!selected.has(id)) archives.delete(id);
    }
    function cleanupExpired() {
        if (!effects.remove) return;
        try {
            const at = effects.now();
            for (const key of effects.list().filter(key => key.startsWith(LIVE_MODEL_PREFIX))) {
                const source = decodeLiveModelSource(effects.get(key, null), key, at);
                if (!source || at - source.lastSeenAt <= 3 * 60 * 60 * 1000) continue;
                // Never touch histories, future/corrupt metadata, or a publisher
                // that renewed its lease while cleanup was reading it.
                const current = decodeLiveModelSource(effects.get(key, null), key, at);
                if (current?.id === source.id && current.lastSeenAt === source.lastSeenAt && current.revision === source.revision) effects.remove(key);
            }
            invalidate();
        } catch (_) { /* Metadata cleanup is optional and never blocks tracking. */ }
    }
    return {readSources, readArchive, clear, retain, invalidate, cleanupExpired};
}

const exchange = createLiveModelExchange({
    get: (key, fallback) => GM_getValue(key, fallback), list: () => GM_listValues(), remove: key => GM_deleteValue(key), now: () => Date.now(),
    epoch: room => getRoomEpoch(getStorageKey(room)),
    archive: (room, session) => validateSessionFile({format: runtime.SESSION_FILE_FORMAT, formatVersion: runtime.SESSION_FILE_VERSION,
        producerVersion: session.producerVersion || runtime.TIERSCOPE_VERSION, room, session})
});
let publisherId = null, heartbeat = null, announced = false, started = false, cleanupInitialized = false, savedBinding = null;
const sourceProviders = new Set(), sourceSubscribers = new Set();

// Providers supply read surfaces only. Registration never starts acquisition;
// the Library controller separately owns starting and stopping its comparison.
export function registerLiveModelSourceProvider(provider) {
    if (!provider || !['readSources', 'readArchive', 'subscribe'].every(key => typeof provider[key] === 'function')) {
        throw new Error('Invalid comparison source provider.');
    }
    const entry = {provider, detach: null};
    const changed = () => {for (const notify of sourceSubscribers) notify();};
    entry.detach = provider.subscribe(changed);
    sourceProviders.add(entry); changed();
    return () => {
        if (!sourceProviders.delete(entry)) return;
        if (typeof entry.detach === 'function') entry.detach();
        changed();
    };
}

function providerSources(provider) {
    const result = provider.readSources(), sources = [];
    let error = result?.error || '';
    for (const value of result?.sources || []) {
        const source = decodeInMemoryLiveModelSource(value, Date.now());
        if (source) sources.push(Object.freeze(source));
        else error = 'Some comparison-only sources could not be read.';
    }
    return {sources, error};
}

function notifyLiveModels() {
    exchange.invalidate();
    GM_setValue(LIVE_MODEL_NOTICE, {version: 1, at: Date.now(), token: makeStorageId()});
}
function retirePublisher() {
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
    const wasAnnounced = announced;
    announced = false; savedBinding = null;
    if (!publisherId || !wasAnnounced) return;
    try { GM_deleteValue(LIVE_MODEL_PREFIX + publisherId); notifyLiveModels(); } catch (_) { /* A failed release expires as stale. */ }
}
export function publishLiveModelSource(savedTimestamp = null) {
    if (!started || !publisherId) return;
    const room = roomFromUrl(location.href)?.toLowerCase();
    if (!room || runtime.lastUrl !== location.href || runtime.activeSessionStorageKey !== getStorageKey(room)) { retirePublisher(); return; }
    if (heartbeat === null) heartbeat = setInterval(publishLiveModelSource, LIVE_MODEL_HEARTBEAT_MS);
    try {
        const at = Date.now(), epoch = getRoomEpoch(getStorageKey(room));
        const sessionStartedAt = runtime.sessionStartedAt, roomEpoch = runtime.activeRoomEpoch;
        if (typeof roomEpoch !== 'string') { retirePublisher(); return; }
        const history = runtime.history, sampleCount = history.timestamps.length, sampleAt = history.timestamps.at(-1) ?? null;
        const record = runtime.tabRecords.get(getStorageKey(room));
        const sessionId = roomEpoch + '@' + (sessionStartedAt === null ? 'pending' : sessionStartedAt);
        const candidateKey = record ? runtime.TAB_RECORD_PREFIX + room + ':' + record.id : null;
        // The writer's completion time can be later than the serialized session
        // timestamp. Bind to the successful save's actual timestamp, not a clock
        // read after serializing/writing a large history.
        if (record && Number.isSafeInteger(savedTimestamp) && savedTimestamp >= 0) {
            savedBinding = {recordKey: candidateKey, sessionId, timestamp: savedTimestamp, writtenAt: record.savedAt, sampleCount, sampleAt};
        }
        const saved = !getSessionSaveState(room).error && record && sampleCount > 0 && savedBinding &&
            savedBinding.recordKey === candidateKey && savedBinding.sessionId === sessionId && savedBinding.writtenAt === record.savedAt &&
            savedBinding.sampleCount === sampleCount && savedBinding.sampleAt === sampleAt;
        const recordKey = saved ? candidateKey : null;
        const revision = saved ? [record.id, savedBinding.timestamp, record.savedAt, sampleCount, sampleAt].join(':') : '';
        let status = runtime.isStopped ? 'stopped' : runtime.isPaused || !runtime.isAutoRefreshOn ? 'paused' :
            isBrowserOffline() ? 'offline' : runtime.requestPolicyCache.blocked || runtime.requestPolicyCache.until > at ? 'retry' :
            sampleCount === 0 ? 'waiting' : saved ? 'tracking' : 'unavailable';
        if (epoch !== roomEpoch) status = 'reset';
        const source = {version: 1, id: publisherId + ':' + room + ':' + sessionId, publisherId, room, roomEpoch,
            sessionId, sessionStartedAt, status, lastSeenAt: at, sampleAt, sampleCount,
            revision, recordKey, recordSavedAt: saved ? savedBinding.timestamp : null};
        GM_setValue(LIVE_MODEL_PREFIX + publisherId, source);
        announced = true;
        notifyLiveModels();
    } catch (_) { /* Sharing failure cannot interrupt acquisition or saved live data. */ }
}
export function initializeLiveModelSources() {
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null; started = true;
    if (!publisherId) publisherId = makeStorageId();
    if (!cleanupInitialized) { cleanupInitialized = true; exchange.cleanupExpired(); }
    publishLiveModelSource();
}
export function stopLiveModelSources() {
    started = false;
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null; retirePublisher(); exchange.clear();
}
export function readLiveModelSources(force = false) {
    const result = exchange.readSources(force), sources = result.sources.slice();
    const ids = new Set(sources.map(source => source.id)), errors = result.error ? [result.error] : [];
    for (const {provider} of sourceProviders) {
        try {
            const extra = providerSources(provider);
            if (extra.error) errors.push(extra.error);
            for (const source of extra.sources) {
                if (ids.has(source.id)) {errors.push('A comparison-only source identity is duplicated.'); continue;}
                sources.push(source); ids.add(source.id);
            }
        } catch (_) {errors.push('Comparison-only sources are unavailable. Their previous snapshots are retained.');}
    }
    sources.sort((a, b) => a.room.localeCompare(b.room) || a.id.localeCompare(b.id));
    return {sources, error: errors.join(' ')};
}
export function readLiveModelArchive(source) {
    if (source.kind !== 'background') return exchange.readArchive(source);
    for (const {provider} of sourceProviders) {
        const current = providerSources(provider).sources.find(value => value.id === source.id);
        if (!current) continue;
        if (current.revision !== source.revision || current.room !== source.room || current.sessionId !== source.sessionId ||
            current.sampleCount !== source.sampleCount || current.sampleAt !== source.sampleAt ||
            !current.sampleCount || ['reset', 'unavailable', 'stale'].includes(current.status)) break;
        const archive = freezeRecordingData(validateSessionFile(provider.readArchive(current))), session = archive.session;
        if (archive.room.toLowerCase() !== current.room || session.sessionStartedAt !== current.sessionStartedAt ||
            session.history.timestamps.length !== current.sampleCount || session.history.timestamps.at(-1) !== current.sampleAt) break;
        const latest = providerSources(provider).sources.find(value => value.id === current.id);
        if (!latest || latest.revision !== current.revision) break;
        return archive;
    }
    throw new Error('This comparison-only source changed or is unavailable. Its previous chart snapshot is retained.');
}
export function retainLiveModelArchives(ids) { exchange.retain(ids); }

export function subscribeLiveModelSources(changed) {
    let disposed = false, pending = null, listener = null;
    function schedule() {
        if (disposed || pending !== null) return;
        pending = setTimeout(() => { pending = null; if (!disposed) changed(); }, 80);
    }
    sourceSubscribers.add(schedule);
    try {
        if (typeof GM_addValueChangeListener === 'function') listener = GM_addValueChangeListener(LIVE_MODEL_NOTICE, () => { exchange.invalidate(); schedule(); });
    } catch (_) { /* Polling also handles discovery, missed notifications and suspended tabs. */ }
    const timer = setInterval(schedule, 5000);
    return () => {
        disposed = true; clearInterval(timer);
        sourceSubscribers.delete(schedule);
        if (pending !== null) clearTimeout(pending);
        if (listener !== null) {
            try { if (typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(listener); } catch (_) { /* Already removed. */ }
        }
        exchange.clear();
    };
}
