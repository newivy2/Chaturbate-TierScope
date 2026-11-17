export const RECENT_COMPARISON_MS = 24 * 60 * 60 * 1000;

/** @param {number} value */
function timestamp(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }

const ongoingSourceStatuses = new Set(['tracking', 'paused', 'retry', 'offline']);

// Only the selected ongoing session of a model is live. An older recording of
// that same model must not inherit the current tab's style. Discovery supplies
// validated metadata and already converts expired leases/epochs to stale/reset;
// this projection does no history reads, scans or clock-dependent work.
export function buildRecentComparisonStyles(entries, sources, currentRoom = '') {
    if (!Array.isArray(entries)) throw new Error('Invalid recent comparison style input.');
    const winners = new Map(), primaryRoom = typeof currentRoom === 'string' ? currentRoom.toLowerCase() : '';
    for (const source of Array.isArray(sources) ? sources : []) {
        if (!source || typeof source.room !== 'string' || !source.room.length ||
            typeof source.id !== 'string' || !source.id.length || typeof source.roomEpoch !== 'string' || !source.roomEpoch.length ||
            !ongoingSourceStatuses.has(source.status) || !timestamp(source.sessionStartedAt) || !timestamp(source.sampleAt) ||
            !Number.isSafeInteger(source.sampleCount) || source.sampleCount <= 0) continue;
        const room = source.room.toLowerCase(), previous = winners.get(room);
        if (!previous || source.sampleCount > previous.sampleCount || source.sampleCount === previous.sampleCount &&
            (source.sampleAt > previous.sampleAt || source.sampleAt === previous.sampleAt && source.id.localeCompare(previous.id) < 0)) winners.set(room, source);
    }
    return entries.map(entry => {
        const archive = entry?.archive, session = archive?.session;
        const room = typeof archive?.room === 'string' ? archive.room.toLowerCase() : '';
        const source = winners.get(room);
        const live = !!source && timestamp(session?.sessionStartedAt) && session.sessionStartedAt === source.sessionStartedAt &&
            (!Object.prototype.hasOwnProperty.call(session, 'roomEpoch') || session.roomEpoch === source.roomEpoch);
        return {live, primary: live && room === primaryRoom};
    });
}

// Eligibility depends on accepted samples, not the recording's start, export
// date, or an interval that merely crosses the window without a real sample.
// The caller supplies the complete validated Library, independent of filters.
export function selectRecentComparisonEntries(entries, now, windowMs = RECENT_COMPARISON_MS) {
    if (!Array.isArray(entries) || !timestamp(now)) throw new Error('Invalid recent comparison input.');
    const rangeMs = windowMs === Infinity || Number.isSafeInteger(windowMs) && windowMs > 0 && windowMs <= RECENT_COMPARISON_MS ? windowMs : RECENT_COMPARISON_MS;
    const cutoffAt = Math.max(0, now - rangeMs), selected = [];
    for (const [index, entry] of entries.entries()) {
        const archive = entry?.archive, session = archive?.session, times = session?.history?.timestamps;
        if (!Array.isArray(times) || typeof archive.room !== 'string') continue;
        let sampleCount = 0, latestAt = -1, latestIndex = -1;
        times.forEach((time, sampleIndex) => {
            if (!timestamp(time) || time < cutoffAt || time > now) return;
            sampleCount++;
            if (time >= latestAt) {latestAt = time; latestIndex = sampleIndex;}
        });
        if (!sampleCount) continue;
        const firstAt = times.find(timestamp);
        const startAt = timestamp(session.sessionStartedAt) ? session.sessionStartedAt : firstAt;
        selected.push({entry, sourceId: String(entry.id || entry.lineage || archive.room + ':' + firstAt + ':' + index),
            room: archive.room, startAt, latestAt, latestIndex, sampleCount});
    }
    selected.sort((a, b) => b.startAt - a.startAt || b.latestAt - a.latestAt || a.room.localeCompare(b.room) || a.sourceId.localeCompare(b.sourceId));
    return {entries: selected.map(item => item.entry), metadata: selected.map(({entry, ...item}) => item), cutoffAt, now,
        roomCount: new Set(selected.map(item => item.room.toLowerCase())).size,
        sampleCount: selected.reduce((total, item) => total + item.sampleCount, 0)};
}
