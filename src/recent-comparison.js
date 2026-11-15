import { renderAnalysisChart } from './analysis-chart-view.js';
import { freezeRecordingData } from './immutable-data.js';
import { buildLiveModelSeries } from './live-model-chart-data.js';
import { RECENT_COMPARISON_MS, selectRecentComparisonEntries } from './recent-comparison-data.js';
import { ANALYSIS_METRICS } from './session-analysis.js';
import { compareLibrarySessions } from './session-library.js';
import { toolNode as node, toolButton as button } from './tools-view-helpers.js';

const READ_INTERVAL_MS = 10000, WINDOW_INTERVAL_MS = 30000, REPORT_PAGE_SIZE = 25;

export function createRecentComparisonState() {
    return {frozen: false, frozenAt: 0, displayAt: 0, entries: [], snapshots: new Map(), inputSources: new Map(),
        loaded: false, attemptedAt: null, revision: 0, notice: '', page: 0, chartState: null, chartIds: [],
        chartSources: [], hiddenSources: new Set(), hiddenSourceEntries: new Map(), windowMs: RECENT_COMPARISON_MS, chartWindowMs: RECENT_COMPARISON_MS};
}

function captureEntry(entry) {
    const archive = entry.archive, session = archive.session;
    return freezeRecordingData({id: entry.id, lineage: entry.lineage,
        archive: {...archive, session: {...session,
            history: Object.fromEntries(Object.entries(session.history).map(([key, values]) => [key, values.slice()])),
            sessionHighs: Object.fromEntries(Object.entries(session.sessionHighs || {}).map(([key, high]) => [key, {...high}]))}}});
}

function sourceToken(entry) {
    // Reader caches can evict large archives. Their unchanged raw records still
    // identify the same data, so a revalidation need not copy every array again.
    return Array.isArray(entry.records) && entry.records.length ?
        entry.records.map(record => ({key: record.key, value: record.value})) : entry.archive;
}
function sameSource(left, right) {
    return left === right || Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
        left.every((record, index) => record.key === right[index].key && record.value === right[index].value);
}

// Reads saved aggregate recordings only. Every eligible Library session is
// included; neither Library filters nor a model/session count cap apply here.
export function renderRecentComparison(parent, {readEntries, getMetric, metricControl, state = createRecentComparisonState()}) {
    const root = node(parent, 'section'); root.id = 'tools-recent-comparison';
    node(root, 'h3', 'Last 24 hours · all models');
    node(root, 'p', 'All saved models with samples in the selected range. Library filters do not apply.', 'tools-muted');
    const controls = node(root, 'div', undefined, 'tools-actions');
    const freeze = button(controls, '', () => {
        state.frozen = !state.frozen;
        state.frozenAt = state.frozen ? state.displayAt : 0;
        if (state.frozen) paint(true); else refresh(true);
    }, 'tools-recent-freeze'); freeze.className = 'tools-primary';
    const refreshButton = button(controls, 'Refresh', () => refresh(true), 'tools-recent-refresh');
    const rangeLabel = node(controls, 'label', 'Range '), range = node(rangeLabel, 'select'); range.id = 'tools-recent-range';
    for (const [value, label] of [[3600000, 'Last hour'], [14400000, 'Last 4 hours'], [43200000, 'Last 12 hours'], [RECENT_COMPARISON_MS, 'Last 24 hours']]) {
        const option = node(range, 'option', label); option.value = String(value);
    }
    range.value = String(state.windowMs);
    range.onchange = () => {state.windowMs = Number(range.value); state.page = 0; paint(true);};
    const status = node(root, 'p', '', 'tools-muted'); status.id = 'tools-recent-status'; status.setAttribute('role', 'status');
    const windowLabel = node(root, 'p', '', 'tools-muted'); windowLabel.id = 'tools-recent-window';
    metricControl(root, () => paint(true));
    const chartHost = node(root, 'div');
    const empty = node(root, 'p', '', 'tools-muted'); empty.id = 'tools-recent-empty';
    const reports = node(root, 'div', undefined, 'tools-scroll'), table = node(reports, 'table'); table.id = 'tools-recent-samples';
    node(table, 'caption', 'Latest accepted sample within the displayed date window');
    const heading = node(node(table, 'thead'), 'tr');
    ['Model', 'Session start', 'Latest sample', 'Count', 'Samples in window'].forEach(text => {node(heading, 'th', text).scope = 'col';});
    const body = node(table, 'tbody'), pagination = node(root, 'div', undefined, 'tools-actions'); pagination.id = 'tools-recent-pages';
    const previous = button(pagination, 'Previous', () => {state.page--; paintReports();}, 'tools-recent-previous');
    const pageLabel = node(pagination, 'span', '', 'tools-muted'); pageLabel.setAttribute('aria-live', 'polite');
    const next = button(pagination, 'Next', () => {state.page++; paintReports();}, 'tools-recent-next');
    node(root, 'p', 'Actual dates and clock times share one timeline. Recording gaps stay blank and each line ends at its last accepted sample. The newest 12 sessions use progressively lighter colors; older sessions remain visible in faint gray. Sessions from the same model remain separate.', 'tools-muted');
    let disposed = false, refreshing = false, view = null, observer = null, plotSignature = '', paintSignature = '', selectionSignature = '', selection = null;

    function rememberChart() {
        if (!view) return;
        state.chartState = view.capture();
        const hidden = new Set(state.chartState.hidden);
        state.chartSources.forEach((source, index) => {
            if (hidden.has(index)) {
                state.hiddenSources.add(source.id); state.hiddenSourceEntries.set(source.id, source.entry);
            } else {
                state.hiddenSources.delete(source.id); state.hiddenSourceEntries.delete(source.id);
            }
        });
    }
    function retainedChartState(ids) {
        const previous = state.chartState;
        if (!previous) return null;
        const present = new Set(ids), previousIds = new Set(state.chartSources.map(source => source.id)), byLineage = new Map();
        selection.entries.forEach((entry, index) => {
            if (!entry.lineage || previousIds.has(ids[index])) return;
            if (!byLineage.has(entry.lineage)) byLineage.set(entry.lineage, []);
            byLineage.get(entry.lineage).push({id: ids[index], entry});
        });
        for (const [id, entry] of state.hiddenSourceEntries) {
            if (present.has(id) || !entry.lineage) continue;
            // Auto keeping replaces a record ID while retaining its lineage.
            // Only an unambiguous compatible replacement inherits the choice;
            // conflicting recordings sharing a lineage stay independent. Keep
            // the choice even while a shorter preset omits this recording.
            const compatible = (byLineage.get(entry.lineage) || []).filter(candidate => {
                try { return compareLibrarySessions(entry.archive, candidate.entry.archive) !== null; }
                catch (_) { return false; }
            });
            if (compatible.length === 1) {
                state.hiddenSources.delete(id); state.hiddenSourceEntries.delete(id);
                state.hiddenSources.add(compatible[0].id);
                state.hiddenSourceEntries.set(compatible[0].id, compatible[0].entry);
            }
        }
        return {...previous, sourceIds: ids, hidden: ids.flatMap((id, index) => state.hiddenSources.has(id) ? [index] : [])};
    }
    function clearChart() {
        if (view) {rememberChart(); view.dispose(); view = null;}
        if (observer) {observer.disconnect(); observer = null;}
        chartHost.replaceChildren();
    }
    function paintReports() {
        if (disposed || !selection) return;
        const pages = Math.max(1, Math.ceil(selection.entries.length / REPORT_PAGE_SIZE));
        state.page = Math.max(0, Math.min(pages - 1, state.page));
        body.replaceChildren();
        selection.entries.slice(state.page * REPORT_PAGE_SIZE, (state.page + 1) * REPORT_PAGE_SIZE).forEach((entry, pageIndex) => {
            const item = selection.metadata[state.page * REPORT_PAGE_SIZE + pageIndex], row = node(body, 'tr');
            row.dataset.recentReport = item.sourceId; row.dataset.recentRoom = item.room;
            node(row, 'th', item.room).scope = 'row';
            node(row, 'td', new Date(item.startAt).toLocaleString());
            node(row, 'td', new Date(item.latestAt).toLocaleString());
            const history = entry.archive.session.history, metric = getMetric(), index = item.latestIndex;
            const count = metric === 'room' ? history.total[index] + history.anonymous[index] : history[metric][index];
            node(row, 'td', count.toLocaleString());
            node(row, 'td', item.sampleCount.toLocaleString());
        });
        table.hidden = !selection.entries.length;
        pagination.hidden = selection.entries.length <= REPORT_PAGE_SIZE;
        pageLabel.textContent = 'Page ' + (state.page + 1) + ' of ' + pages + ' · ' + selection.entries.length.toLocaleString() + ' sessions';
        previous.disabled = state.page === 0; next.disabled = state.page >= pages - 1;
    }
    function paint(force = false) {
        if (disposed) return;
        const at = (state.frozen ? state.frozenAt : state.displayAt) || Date.now(), metric = getMetric();
        const nextPaintSignature = [state.revision, at, metric, state.windowMs, state.frozen, state.loaded, state.notice].join('|');
        if (!force && nextPaintSignature === paintSignature) return;
        rememberChart();
        if (state.chartWindowMs !== state.windowMs) {
            clearChart();
            // An explicit preset opens its full range, even when it is empty.
            // Ordinary updates retain the user's absolute zoom and cursor.
            const axisMs = Math.max(1000, Math.min(at, state.windowMs));
            if (state.chartState) state.chartState = {...state.chartState,
                start: 0, end: axisMs, axisMs, originAt: Math.max(0, at - state.windowMs), cursor: 0, pinned: false};
            state.chartWindowMs = state.windowMs;
        }
        const nextSelectionSignature = state.revision + ':' + at + ':' + state.windowMs;
        if (selectionSignature !== nextSelectionSignature) {
            selection = selectRecentComparisonEntries(state.entries, at, state.windowMs); selectionSignature = nextSelectionSignature;
        }
        const ids = selection.metadata.map(item => item.sourceId);
        const signature = [metric, state.revision, at, state.windowMs, ...ids].join('|');
        const same = state.chartIds.length === ids.length && ids.every((id, index) => state.chartIds[index] === id);
        if ((signature !== plotSignature || force) && ids.length) {
            const data = buildLiveModelSeries(selection.entries.map(entry => entry.archive), metric, {now: selection.now, windowMs: state.windowMs});
            const config = {originAt: data.originAt, sourceIds: ids, rankTimes: selection.metadata.map(item => item.startAt), allowAllHidden: true};
            if (!same) {
                clearChart(); state.chartState = retainedChartState(ids);
            }
            if (view) view.update(data.series, data.axisMs, ANALYSIS_METRICS[metric], 'timeline', config);
            else {
                const labels = selection.metadata.map(item => item.room + ' · ' + new Date(item.startAt).toLocaleString());
                view = renderAnalysisChart(chartHost, data.series, labels, data.axisMs, ANALYSIS_METRICS[metric], state.chartState, 'timeline', config);
                if (window.ResizeObserver) {observer = new window.ResizeObserver(view.draw); observer.observe(view.canvas);}
            }
            state.chartSources = selection.entries.map((entry, index) => ({id: ids[index], entry}));
        } else if (!ids.length) clearChart();
        state.chartIds = ids; plotSignature = signature;
        freeze.textContent = state.frozen ? 'Resume comparison' : 'Freeze comparison';
        freeze.setAttribute('aria-pressed', String(state.frozen)); freeze.disabled = !state.loaded;
        refreshButton.disabled = state.frozen;
        refreshButton.title = state.frozen ? 'Resume comparison to read the latest saved Library sessions.' : 'Read all saved Library sessions again.';
        status.textContent = (state.frozen ? 'Frozen' : 'Following saved Library updates') + ' · ' + ids.length.toLocaleString() + ' sessions · ' +
            selection.roomCount.toLocaleString() + ' models · ' + selection.sampleCount.toLocaleString() + ' accepted samples in window.' +
            (state.notice ? ' ' + state.notice : '');
        windowLabel.textContent = 'Window: ' + new Date(selection.cutoffAt).toLocaleString() + ' — ' + new Date(selection.now).toLocaleString();
        windowLabel.title = 'Both endpoints are included. A recording qualifies by actual samples, including sessions that started earlier. Future samples, empty recordings and gaps without a sample in this window are excluded. No additional API requests or automatic saves.';
        empty.hidden = !!ids.length;
        empty.textContent = state.loaded ? 'No saved Library session has an accepted sample in this date window.' : 'Saved Library sessions could not be read.';
        paintReports();
        paintSignature = nextPaintSignature;
    }
    function refresh(force = false) {
        if (disposed || refreshing) return;
        if (state.frozen) {paint(force); return;}
        refreshing = true;
        try {
            const at = Date.now(), due = state.attemptedAt === null || at - state.attemptedAt >= READ_INTERVAL_MS || force;
            let windowChanged = !state.displayAt || at - state.displayAt >= WINDOW_INTERVAL_MS || force;
            if (due) {
                state.attemptedAt = at;
                try {
                    const response = readEntries(), incoming = Array.isArray(response) ? response : response?.entries;
                    if (!Array.isArray(incoming)) throw new Error('The saved Library is unavailable.');
                    const readError = Array.isArray(response) ? '' : response.error;
                    if (readError && state.loaded) throw new Error(readError.message || String(readError));
                    const inputSources = new Map(incoming.map((entry, index) => [String(entry.id || entry.lineage || index), sourceToken(entry)]));
                    const changed = !state.loaded || inputSources.size !== state.inputSources.size ||
                        [...inputSources].some(([id, source]) => !sameSource(state.inputSources.get(id), source));
                    if (changed || windowChanged) {
                        // Retain the whole day's snapshots so a frozen view can
                        // switch to a wider preset without reading storage.
                        const result = selectRecentComparisonEntries(incoming, at), snapshots = new Map();
                        state.entries = result.entries.map((entry, index) => {
                            const id = result.metadata[index].sourceId, previous = state.snapshots.get(id);
                            const source = inputSources.get(id) || sourceToken(entry);
                            const cached = sameSource(previous?.source, source) ? previous : {source, entry: captureEntry(entry)};
                            snapshots.set(id, cached); return cached.entry;
                        });
                        state.snapshots = snapshots; state.revision++; state.displayAt = at; windowChanged = false;
                    }
                    state.inputSources = inputSources; state.loaded = true;
                    state.notice = readError ? 'Some saved Library records are unavailable; showing healthy recordings only. ' +
                        (readError.message || String(readError)) : '';
                } catch (error) {
                    state.notice = 'Library update unavailable; previous snapshots are retained. ' + (error.message || String(error));
                }
            }
            if (windowChanged) state.displayAt = at;
            paint(force);
        } finally {refreshing = false;}
    }
    refresh(!state.frozen);
    const timer = setInterval(() => refresh(), READ_INTERVAL_MS);
    return {refresh, draw() {if (view) view.draw();}, dispose() {
        if (disposed) return; disposed = true; clearInterval(timer);
        if (view) {rememberChart(); view.dispose();}
        if (observer) observer.disconnect();
        freeze.onclick = null; refreshButton.onclick = null; range.onchange = null; previous.onclick = null; next.onclick = null;
    }};
}
