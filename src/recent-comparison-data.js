export const RECENT_COMPARISON_MS = 24 * 60 * 60 * 1000;

/** @param {number} value */
function timestamp(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }

// Eligibility depends on accepted samples, not the recording's start, export
// date, or an interval that merely crosses the window without a real sample.
// The caller supplies the complete validated Library, independent of filters.
export function selectRecentComparisonEntries(entries, now) {
    if (!Array.isArray(entries) || !timestamp(now)) throw new Error('Invalid recent comparison input.');
    const cutoffAt = Math.max(0, now - RECENT_COMPARISON_MS), selected = [];
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
