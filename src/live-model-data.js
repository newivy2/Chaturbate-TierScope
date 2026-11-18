export const LIVE_MODEL_PREFIX = 'tierscope:live:v1:source:';
export const LIVE_MODEL_NOTICE = 'tierscope:live:v1:changed';
export const LIVE_MODEL_HEARTBEAT_MS = 30000;
export const LIVE_MODEL_STALE_MS = 180000;
const statuses = new Set(['tracking', 'paused', 'stopped', 'waiting', 'offline', 'retry', 'reset', 'unavailable']);
const ongoingStatuses = new Set(['tracking', 'paused', 'retry', 'offline']);
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;

export function isOngoingLiveModelStatus(status) { return ongoingStatuses.has(status); }

// Metadata is an announcement, never proof that its referenced history is valid.
// Discovery only reads these small records; selected histories are checked later.
export function decodeLiveModelSource(value, key, at) {
    if (!value || value.version !== 1 || typeof value.publisherId !== 'string' || !/^[a-z0-9-]{1,160}$/i.test(value.publisherId) ||
        key !== LIVE_MODEL_PREFIX + value.publisherId || typeof value.room !== 'string' || !/^[a-z0-9_-]{1,100}$/.test(value.room) ||
        typeof value.roomEpoch !== 'string' || !/^[a-z0-9-]{1,160}$/i.test(value.roomEpoch) ||
        !(value.sessionStartedAt === null || timestamp(value.sessionStartedAt)) ||
        value.sessionId !== value.roomEpoch + '@' + (value.sessionStartedAt === null ? 'pending' : value.sessionStartedAt) ||
        value.id !== value.publisherId + ':' + value.room + ':' + value.sessionId ||
        !statuses.has(value.status) || !timestamp(value.lastSeenAt) || value.lastSeenAt > at + 5000 ||
        !Number.isSafeInteger(value.sampleCount) || value.sampleCount < 0 || value.sampleCount > 1000000 ||
        !(value.sampleCount === 0 ? value.sampleAt === null : timestamp(value.sampleAt) && value.sampleAt <= value.lastSeenAt) ||
        !(value.sessionStartedAt === null || value.sessionStartedAt <= value.lastSeenAt) ||
        typeof value.revision !== 'string' || value.revision.length > 512) return null;
    if (value.recordKey === null) {
        if (value.recordSavedAt !== null || value.revision !== '') return null;
    } else if (typeof value.recordKey !== 'string' || !value.recordKey.startsWith('tierscope:tab:v2:' + value.room + ':') ||
        !/^[a-z0-9-]{1,160}$/i.test(value.recordKey.slice(('tierscope:tab:v2:' + value.room + ':').length)) ||
        !timestamp(value.recordSavedAt) || value.recordSavedAt > value.lastSeenAt || !value.revision) return null;
    return {version: 1, id: value.id, publisherId: value.publisherId, room: value.room, roomEpoch: value.roomEpoch,
        sessionId: value.sessionId, sessionStartedAt: value.sessionStartedAt, status: value.status, lastSeenAt: value.lastSeenAt,
        sampleAt: value.sampleAt, sampleCount: value.sampleCount, revision: value.revision,
        recordKey: value.recordKey, recordSavedAt: value.recordSavedAt};
}

export function liveModelSourceStatus(source, at, epoch) {
    if (source.roomEpoch !== epoch) return 'reset';
    if (at - source.lastSeenAt > LIVE_MODEL_STALE_MS) return 'stale';
    return source.status;
}

// Comparison-only providers own their histories in memory. Reuse the same
// identity/timestamp checks without implying that a GM record exists.
export function decodeInMemoryLiveModelSource(value, at) {
    if (!value || value.kind !== 'background' || value.recordKey !== null || value.recordSavedAt !== null ||
        typeof value.revision !== 'string' || value.revision.length > 512) return null;
    const source = decodeLiveModelSource({...value, revision: ''}, LIVE_MODEL_PREFIX + value.publisherId, at);
    if (!source) return null;
    return {...source, kind: 'background', revision: value.revision,
        status: at - source.lastSeenAt > LIVE_MODEL_STALE_MS ? 'stale' : source.status};
}
