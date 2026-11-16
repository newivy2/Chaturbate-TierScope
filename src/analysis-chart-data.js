/** @typedef {{times:number[], values:number[], breaks:boolean[], timestamps:number[]}} InspectionSeries */
/** @param {number[]} times @param {number} time */
export function analysisSampleIndex(times, time) {
    let left = 0, right = times.length;
    while (left < right) { const mid = (left + right) >>> 1; if (times[mid] <= time) left = mid + 1; else right = mid; }
    return left - 1;
}

/** @param {InspectionSeries} series @param {number} time */
export function inspectAnalysisSample(series, time) {
    const index = analysisSampleIndex(series.times, time);
    if (index < 0 || time > series.times.at(-1)) return {kind: 'outside', index: -1, value: null, timestamp: null};
    if (series.times[index] !== time && series.breaks[index + 1]) return {kind: 'gap', index, value: null, timestamp: null};
    return {kind: series.times[index] === time ? 'sample' : 'held', index, value: series.values[index], timestamp: series.timestamps[index]};
}

// Reduce only drawing, keeping each pixel column's first/last and extrema in
// sample order. Flush at gaps so even subpixel pauses stay separate segments.
/** @param {InspectionSeries} series @param {number} start @param {number} end @param {number} width */
export function buildAnalysisPlot(series, start, end, width) {
    const {times, values, breaks} = series;
    /** @type {Array<{time:number,value:number,index:number,move:boolean}>} */
    const points = [];
    let bucket = null, move = true, maximum = 1, last = -1;
    function flush() {
        if (!bucket) return;
        const indices = [bucket.first, bucket.low, bucket.high, bucket.last].sort((a, b) => a - b);
        indices.forEach((index, i) => {
            if (i && index === indices[i - 1]) return;
            points.push({time: Math.max(start, times[index]), value: values[index], index, move}); move = false;
        });
        bucket = null;
    }
    let first = Math.max(0, analysisSampleIndex(times, start));
    while (first > 0 && times[first - 1] === start) first--;
    for (let i = first; i < times.length && times[i] <= end; i++) {
        if (times[i] < start && (i + 1 === times.length || breaks[i + 1])) continue;
        const column = end > start ? Math.floor((Math.max(start, times[i]) - start) / (end - start) * width) : 0;
        if (breaks[i]) { flush(); move = true; }
        if (!bucket || bucket.column !== column) {
            flush(); bucket = {column, first: i, last: i, low: i, high: i};
        } else {
            bucket.last = i;
            if (values[i] < values[bucket.low]) bucket.low = i;
            if (values[i] > values[bucket.high]) bucket.high = i;
        }
        maximum = Math.max(maximum, values[i]); last = i;
    }
    flush();
    if (last >= 0 && last + 1 < times.length && !breaks[last + 1] && times[last + 1] > end && times[last] < end) {
        points.push({time: end, value: values[last], index: last, move: false});
    }
    return {points, maximum};
}

/** @param {number} span @param {number} start @param {number} end @param {number} factor @param {number} anchor */
export function zoomAnalysisWindow(span, start, end, factor, anchor) {
    if (!Number.isFinite(span) || span < 0 || !Number.isFinite(factor) || factor <= 0) throw new Error('Invalid chart range.');
    if (!span) return [0, 0];
    const width = Math.min(span, Math.max(Math.min(1000, span), (end - start) * factor));
    const center = Math.max(start, Math.min(end, anchor));
    const ratio = end > start ? (center - start) / (end - start) : 0.5;
    const left = Math.max(0, Math.min(span - width, center - width * ratio));
    return [left, left + width];
}

// Fit only enabled lines. Hidden recordings must not reserve empty horizontal
// space, while a single accepted point still receives an inspectable window.
/** @param {InspectionSeries[]} series @param {ReadonlySet<number>} hidden
 * @param {number} axisMs @returns {[number, number]} */
export function visibleAnalysisWindow(series, hidden, axisMs) {
    if (!Number.isFinite(axisMs) || axisMs < 0) throw new Error('Invalid chart range.');
    let first = Infinity, last = -Infinity;
    series.forEach((source, index) => {
        if (hidden.has(index)) return;
        source.times.forEach((time, sample) => {
            const value = source.values[sample];
            if (!Number.isFinite(time) || time < 0 || time > axisMs || !Number.isSafeInteger(value) || value < 0) return;
            first = Math.min(first, time); last = Math.max(last, time);
        });
    });
    if (first === Infinity) return [0, axisMs];
    const width = Math.min(axisMs, Math.max(1000, last - first));
    const start = Math.max(0, Math.min(axisMs - width, first - (width - (last - first)) / 2));
    return [start, start + width];
}

// The most recent twelve remain individually readable; older sessions are a
// faint background. Apply background opacity once to their composited layer.
export const COMPARISON_FOREGROUND_COUNT = 12;
export const COMPARISON_BACKGROUND_OPACITY = 0.12;
export const ANALYSIS_LINE_PAGE_SIZE = 30;
/** @param {number} rank */
export function comparisonOpacity(rank) {
    return rank < COMPARISON_FOREGROUND_COUNT ? (100 - rank * 5) / 100 : COMPARISON_BACKGROUND_OPACITY;
}

/** @param {InspectionSeries[]} series @param {number[]} [rankTimes] */
export function comparisonSeriesOrder(series, rankTimes) {
    const at = index => Number.isFinite(rankTimes?.[index]) ? rankTimes[index] : series[index].timestamps[0] ?? -Infinity;
    const newestFirst = series.map((_, index) => index).sort((a, b) => at(b) - at(a) || a - b);
    const ranks = new Array(series.length);
    newestFirst.forEach((index, rank) => { ranks[index] = rank; });
    return {newestFirst, ranks};
}

const darkComparisonColors = ['#ff69b4','#79baff','#68d391','#ffd166','#c4a3ff','#ff987d','#47c9cf','#eaa1e8','#b5cf63','#e99c55','#92a3e8','#b4b4bd'];
const brightComparisonColors = ['#b42370','#175db0','#176f36','#835900','#7140a6','#a23c20','#08767c','#96558d','#557315','#98530d','#414b9d','#626269'];

// Twelve familiar colors remain unchanged. Further live models receive stable
// generated hues and alternating lightness, rather than wrapping onto color 1.
// Arbitrarily many traces cannot all be perceptually distinct; labels, search
// and independent visibility remain available for inspecting crowded charts.
/** @param {number} index @param {boolean} [dark] */
export function comparisonLineColor(index, dark = true) {
    index = Number.isSafeInteger(index) && index >= 0 ? index : 0;
    const curated = dark ? darkComparisonColors : brightComparisonColors;
    if (index < curated.length) return curated[index];
    const generated = index - curated.length, hue = (23 + generated * 137.50776405003785) % 360;
    const saturation = [68, 82, 58][Math.floor(generated / 36) % 3];
    const lightness = (dark ? [68, 57, 78] : [35, 44, 27])[Math.floor(generated / 12) % 3];
    return 'hsl(' + hue.toFixed(3) + ' ' + saturation + '% ' + lightness + '%)';
}

// Preserve A–Z labels and valid source IDs when comparisons reach AA–AD.
/** @param {number} index */
export function comparisonLabel(index) {
    let label = '';
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
        label = String.fromCharCode(65 + (value - 1) % 26) + label;
    }
    return label;
}
