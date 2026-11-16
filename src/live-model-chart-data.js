import { analysisSampleIndex } from './analysis-chart-data.js';
import { analysisSeries } from './session-analysis.js';

/** @typedef {import('./session-analysis.js').AnalysisArchive} AnalysisArchive */
/** @typedef {import('./analysis-chart-data.js').InspectionSeries} InspectionSeries */

// Reserve the slots of models that remain selected before assigning newcomers.
// Unselected models release their slots; selections have no fixed palette cap.
/** @param {string[]} rooms @param {Map<string,number>} previous @param {string} primaryRoom */
export function allocateLiveModelColors(rooms, previous = new Map(), primaryRoom = '') {
    const selected = [...new Set(rooms)];
    if (selected.some(room => typeof room !== 'string' || !room.length)) {
        throw new Error('Choose named models for live comparison colors.');
    }
    const colors = new Map(), used = new Set(), primaryName = typeof primaryRoom === 'string' ? primaryRoom.toLowerCase() : '';
    const primary = primaryName ? selected.find(room => room.toLowerCase() === primaryName) : undefined;
    // An explicitly selected current room owns pink; only its former occupant
    // needs a new slot. No reservation is made when that room is not selected.
    if (primary !== undefined) {colors.set(primary, 0); used.add(0);}
    for (const room of selected) {
        if (colors.has(room)) continue;
        const index = previous.get(room);
        if (Number.isSafeInteger(index) && index >= 0 && !used.has(index)) {
            colors.set(room, index); used.add(index);
        }
    }
    let index = 0;
    for (const room of selected) {
        if (colors.has(room)) continue;
        while (used.has(index)) index++;
        colors.set(room, index); used.add(index);
    }
    return colors;
}

// Live comparisons share actual timestamps. Local midnight and timezone changes
// affect labels only; they never fold different dates onto the same x position.
/** @param {AnalysisArchive[]} archives @param {string} metric
 * @param {{now?:number,windowMs?:number,originAt?:number}} options */
export function buildLiveModelSeries(archives, metric = 'room', options = {}) {
    let latest = 0;
    for (const archive of archives) for (const time of archive.session.history.timestamps) {
        if (!Number.isSafeInteger(time) || time < 0 || time > 8640000000000000) continue;
        latest = Math.max(latest, time);
    }
    const now = options.now === undefined ? latest : options.now;
    const windowMs = options.windowMs === undefined ? 3600000 : options.windowMs;
    if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000 ||
        !(windowMs === Infinity || Number.isSafeInteger(windowMs) && windowMs > 0)) throw new Error('Invalid live comparison window.');
    let excludedSamples = 0, earliest = Infinity, acceptedLatest = 0;
    const accepted = archives.map(archive => {
        const input = analysisSeries(archive, metric), timestamps = archive.session.history.timestamps;
        /** @type {InspectionSeries} */
        const output = {times: [], values: [], breaks: [], timestamps: []};
        let previous = -1, interrupted = false;
        timestamps.forEach((time, index) => {
            const value = input.values[index];
            if (!Number.isSafeInteger(time) || time < 0 || time > now || time < previous ||
                !Number.isSafeInteger(value) || value < 0) {
                excludedSamples++; interrupted = true; return;
            }
            output.times.push(time); output.values.push(value);
            output.breaks.push(interrupted || !!input.breaks[index]); output.timestamps.push(time);
            earliest = Math.min(earliest, time); acceptedLatest = Math.max(acceptedLatest, time);
            previous = time; interrupted = false;
        });
        return output;
    });
    // Full sessions use accepted sample endpoints, rather than an idle tail to
    // the current clock. Finite presets retain their explicit now-based window.
    const originAt = options.originAt === undefined ? Math.max(0, windowMs === Infinity ?
        (earliest === Infinity ? now : earliest) : now - windowMs) : options.originAt;
    if (!Number.isSafeInteger(originAt) || originAt < 0 || originAt > now) throw new Error('Invalid live comparison origin.');
    const axisEnd = windowMs === Infinity && earliest !== Infinity ? acceptedLatest : now;
    const series = accepted.map(output => {
        output.times = output.times.map(time => time - originAt);
        // Retain at most one predecessor so a covered interval crossing the
        // left edge remains inspectable. Never extend beyond the last sample.
        const first = Math.max(0, analysisSampleIndex(output.times, 0));
        for (const key of ['times', 'values', 'breaks', 'timestamps']) output[key] = output[key].slice(first);
        return output;
    });
    return {series, labels: archives.map(archive => archive.room), originAt, axisMs: Math.max(1000, axisEnd - originAt), excludedSamples};
}
