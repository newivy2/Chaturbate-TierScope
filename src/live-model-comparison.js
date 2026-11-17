import { renderAnalysisChart } from './analysis-chart-view.js';
import { CHART_RANGES } from './chart-ranges.js';
import { allocateLiveModelColors, buildLiveModelSeries } from './live-model-chart-data.js';
import { readLiveModelArchive, readLiveModelSources, retainLiveModelArchives, subscribeLiveModelSources } from './live-model-sources.js';
import { ANALYSIS_METRICS } from './session-analysis.js';
import { dismissComparisonSources, isComparisonDismissed, subscribeComparisonDismissals } from './comparison-dismissals.js';
import { toolNode as node, toolButton as button } from './tools-view-helpers.js';

const MODEL_PAGE_SIZE = 50;
const statusNames = {tracking: 'Tracking', paused: 'Paused', stopped: 'Stopped', waiting: 'Waiting for first sample',
    offline: 'No connection', retry: 'Waiting to retry', reset: 'Session reset in another tab', unavailable: 'Unavailable', stale: 'Stale / suspended'};

export function createLiveComparisonState() {
    return {selected: new Set(), choices: new Map(), known: new Map(), snapshots: new Map(), colors: new Map(),
        autoPicked: false, frozen: false, frozenAt: 0, windowMs: 3600000, pickerOpen: false, query: '', rowLimit: MODEL_PAGE_SIZE,
        reportPage: 0, chartState: null, chartIds: [], hiddenSources: new Set()};
}

// A Library controller: it reads published aggregate snapshots and gives only
// analysis values to the chart. It never scans, saves a recording or changes a
// live session, and subscriptions exist only while this view is open.
export function renderLiveModelsComparison(parent, {state, getMetric, metricControl, currentRoom = ''}) {
    if (!state.hiddenSources) {
        const hidden = new Set(state.chartState?.hidden || []);
        state.hiddenSources = new Set(state.chartIds.filter((id, index) => hidden.has(index)));
    }
    const root = node(parent, 'section'); root.id = 'tools-live-models';
    node(root, 'h3', 'Live models comparison');
    const sourceExplanation = node(root, 'p', 'Uses scans from your other TierScope tabs. No additional API requests.', 'tools-muted');
    sourceExplanation.id = 'tools-live-source-explanation';
    const controls = node(root, 'div', undefined, 'tools-actions');
    const freeze = button(controls, '', () => {
        state.frozen = !state.frozen;
        state.frozenAt = state.frozen ? state.displayAt || Date.now() : 0;
        plotSignature = ''; refresh();
    }, 'tools-live-freeze');
    freeze.className = 'tools-primary';
    button(controls, 'Refresh sources', () => refresh(true), 'tools-live-refresh');
    const clearInactive = button(controls, 'Clear stopped/stale', () => {
        try {
            dismissComparisonSources(clearableSources); state.autoPicked = true; plotSignature = ''; refresh();
        } catch (error) {status.textContent = 'Some entries could not be cleared: ' + error.message;}
    }, 'tools-live-clear-inactive');
    clearInactive.title = 'Hide stopped, stale and closed comparison entries. Saved recordings and active tracking are preserved.';
    const rangeLabel = node(controls, 'label', 'Show '), windowSelect = node(rangeLabel, 'select'); windowSelect.id = 'tools-live-window';
    for (const {ms, label} of CHART_RANGES) {
        const option = node(windowSelect, 'option', label); option.value = String(ms);
    }
    windowSelect.value = String(state.windowMs);
    windowSelect.onchange = () => {state.windowMs = Number(windowSelect.value); resetRange = true; plotSignature = ''; refresh();};
    const status = node(root, 'p', '', 'tools-muted'); status.id = 'tools-live-status'; status.setAttribute('role', 'status');
    const chooser = node(root, 'details'); chooser.id = 'tools-live-chooser'; chooser.open = state.pickerOpen;
    chooser.ontoggle = () => {if (!disposed) state.pickerOpen = chooser.open;};
    const chooserTitle = node(chooser, 'summary', 'Models being tracked');
    node(chooser, 'p', 'Choose the models to compare. When a model is open in several tabs, the session with the most samples is used. Ties keep the current source. Tracking status and sample age are shown separately.', 'tools-muted');
    const selectionControls = node(chooser, 'div', undefined, 'tools-actions');
    const selectAll = button(selectionControls, 'Select all', () => {
        state.autoPicked = true;
        for (const room of currentGroups.keys()) {
            const source = state.known.get(state.choices.get(room));
            if (eligible(source)) state.selected.add(source.id);
        }
        plotSignature = ''; refresh();
    }, 'tools-live-select-all');
    const clearSelection = button(selectionControls, 'Clear', () => {
        state.autoPicked = true; state.selected.clear(); plotSignature = ''; refresh();
    }, 'tools-live-clear');
    const searchLabel = node(selectionControls, 'label', 'Find model '), search = node(searchLabel, 'input');
    search.type = 'search'; search.id = 'tools-live-search'; search.value = state.query; search.setAttribute('aria-label', 'Find live models');
    search.oninput = () => {state.query = search.value; state.rowLimit = MODEL_PAGE_SIZE; updateRows(currentGroups, Date.now());};
    const matches = node(chooser, 'p', '', 'tools-muted'); matches.id = 'tools-live-matches';
    const rowsElement = node(chooser, 'div', undefined, 'tools-live-sources');
    const moreModels = button(chooser, 'Show more models', () => {
        state.rowLimit += MODEL_PAGE_SIZE; updateRows(currentGroups, Date.now());
    }, 'tools-live-show-more');
    const empty = node(chooser, 'p', '', 'tools-muted'); empty.id = 'tools-live-empty';
    metricControl(root, () => {plotSignature = ''; refresh();});
    const chartHost = node(root, 'div');
    const reports = node(root, 'div', undefined, 'tools-scroll');
    const reportControls = node(reports, 'div', undefined, 'tools-actions'); reportControls.id = 'tools-live-sample-pages';
    const reportPrevious = button(reportControls, '‹ Previous', () => {state.reportPage--; renderReports();}, 'tools-live-samples-previous');
    reportPrevious.setAttribute('aria-label', 'Previous live sample summaries');
    const reportRange = node(reportControls, 'span', '', 'tools-muted');
    const reportNext = button(reportControls, 'Next ›', () => {state.reportPage++; renderReports();}, 'tools-live-samples-next');
    reportNext.setAttribute('aria-label', 'Next live sample summaries');
    const table = node(reports, 'table'); table.id = 'tools-live-samples';
    node(table, 'caption', 'Latest accepted sample in each displayed snapshot');
    const heading = node(node(table, 'thead'), 'tr');
    ['Model', 'Count', 'Sample time', 'Samples', 'Source status'].forEach(text => {node(heading, 'th', text).scope = 'col';});
    const reportBody = node(table, 'tbody');
    node(root, 'p', 'The chart uses actual dates and clock times, including midnight crossings. Gaps stay gaps and lines end at their last accepted sample. A stale source may be suspended or closed; its old counts are never treated as a fresh scan. Keeping sessions in Library remains a separate choice.', 'tools-muted');
    let disposed = false, refreshing = false, view = null, observer = null, detach = null, detachDismissals = null, resetRange = false;
    let clearableSources = [];
    let rows = new Map(), currentGroups = new Map(), reportData = [], topology = '', plotSignature = '', notice = '', userNotice = '';
    function age(time, at) {
        if (!Number.isFinite(time)) return 'No sample';
        const seconds = Math.max(0, Math.floor((at - time) / 1000));
        return seconds < 60 ? seconds + 's ago' : seconds < 3600 ? Math.floor(seconds / 60) + 'm ago' : Math.floor(seconds / 3600) + 'h ago';
    }
    function describe(source) { return statusNames[source.status] || 'Unavailable'; }
    function eligible(source) { return source && source.sampleCount > 0 && !['reset', 'unavailable', 'stale'].includes(source.status); }
    function rememberChart() {
        if (!view) return;
        state.chartState = view.capture();
        const hidden = new Set(state.chartState.hidden);
        state.chartIds.forEach((id, index) => {
            if (hidden.has(index)) state.hiddenSources.add(id); else state.hiddenSources.delete(id);
        });
    }
    function clearChart() {
        if (view) {rememberChart(); view.dispose(); view = null;}
        if (observer) {observer.disconnect(); observer = null;}
        chartHost.replaceChildren();
    }
    function choose(source, checked) {
        state.autoPicked = true;
        if (!source) return;
        if (checked) state.selected.add(source.id); else state.selected.delete(source.id);
        plotSignature = ''; userNotice = ''; refresh();
    }
    function sourceText(source, index, at) {
        return (source.kind === 'background' ? 'Compare without watching' : 'Tab ' + (index + 1)) + ' · ' + describe(source) + ' · ' + (source.sampleAt ? new Date(source.sampleAt).toLocaleTimeString() : 'no sample');
    }
    function updateRows(groups, at) {
        const query = state.query.trim().toLowerCase(), filtered = [...groups].filter(([room]) => room.includes(query));
        const visible = filtered.slice(0, state.rowLimit);
        const nextTopology = visible.map(([room, sources]) => room + ':' + sources.map(source => source.id).join('|')).join('\n');
        if (nextTopology !== topology) {
            topology = nextTopology; rowsElement.replaceChildren(); rows = new Map();
            for (const [room, sources] of visible) {
                const row = node(rowsElement, 'div', undefined, 'tools-live-source'); row.dataset.liveRoom = room;
                const label = node(row, 'label', undefined, 'tools-live-model');
                const check = node(label, 'input'); check.type = 'checkbox'; node(label, 'strong', room);
                const select = node(row, 'select'); select.dataset.liveTab = room; select.setAttribute('aria-label', 'Tracking source for ' + room);
                for (const source of sources) {const option = node(select, 'option'); option.value = source.id;}
                const tabNote = node(row, 'span', '', 'tools-muted'); tabNote.dataset.liveTabNote = '';
                const detail = node(row, 'span', '', 'tools-muted'); detail.dataset.liveStatus = '';
                const snapshot = node(row, 'span', '', 'tools-muted'); snapshot.dataset.liveSample = '';
                rows.set(room, {row, check, select, tabNote, detail, snapshot});
                check.onchange = () => choose(state.known.get(state.choices.get(room)), check.checked);
                select.onchange = () => {
                    rememberChart();
                    const old = state.choices.get(room), checked = state.selected.delete(old);
                    state.choices.set(room, select.value);
                    if (state.hiddenSources.has(old)) state.hiddenSources.add(select.value); else state.hiddenSources.delete(select.value);
                    if (checked) state.selected.add(select.value);
                    state.autoPicked = true; plotSignature = ''; userNotice = ''; refresh();
                };
            }
        }
        for (const [room, sources] of visible) {
            const row = rows.get(room), source = state.known.get(state.choices.get(room));
            row.check.dataset.liveSource = source.id;
            row.check.checked = state.selected.has(source.id);
            row.check.disabled = state.frozen || !row.check.checked && (!source.sampleCount || source.status === 'reset' || source.status === 'unavailable');
            const changedSession = sources.some(other => other.publisherId === source.publisherId && other.id !== source.id);
            row.select.value = source.id;
            row.select.hidden = !changedSession || !['unavailable', 'reset'].includes(source.status);
            row.select.disabled = state.frozen;
            [...row.select.options].forEach((option, index) => {option.textContent = sourceText(sources[index], index, at);});
            const publishers = new Set(sources.filter(item => item.status !== 'unavailable' && item.status !== 'reset').map(item => item.publisherId));
            row.tabNote.hidden = publishers.size < 2;
            row.tabNote.textContent = publishers.size + (sources.some(item => item.kind === 'background') ? ' sources' : ' tabs') + ' · using the session with the most samples';
            row.detail.textContent = (source.kind === 'background' ? 'Compare without watching · ' : '') + describe(source);
            row.snapshot.textContent = source.sampleCount ? source.sampleCount.toLocaleString() + ' samples · latest ' + age(source.sampleAt, at) : 'Waiting for a first accepted sample';
            row.row.dataset.liveState = source.status;
            row.row.dataset.liveSampleCount = String(source.sampleCount);
        }
        selectAll.disabled = state.frozen || ![...groups.keys()].some(room => {
            const source = state.known.get(state.choices.get(room)); return eligible(source) && !state.selected.has(source.id);
        });
        clearSelection.disabled = state.frozen || !state.selected.size;
        matches.textContent = (query ? filtered.length + ' matching models' : groups.size + ' models') +
            ' · ' + state.selected.size + ' selected' + (filtered.length > visible.length ? ' · showing ' + visible.length : '');
        moreModels.hidden = visible.length >= filtered.length;
        moreModels.textContent = 'Show ' + Math.min(MODEL_PAGE_SIZE, filtered.length - visible.length) + ' more models';
    }
    function updateChart(sources, at, force) {
        if (!state.frozen) {
            for (const source of sources) {
                if (!source.sampleCount || ['reset', 'unavailable'].includes(source.status)) continue;
                const previous = state.snapshots.get(source.id);
                if (!force && previous?.revision === source.revision && previous.recordKey === source.recordKey) continue;
                try {
                    const archive = readLiveModelArchive(source);
                    if (archive) state.snapshots.set(source.id, {archive, revision: source.revision, recordKey: source.recordKey});
                } catch (error) { notice = 'Some source data is unavailable. Previous displayed snapshots are retained.'; }
            }
        }
        const selected = sources.filter(source => state.snapshots.has(source.id));
        const ids = selected.map(source => source.id), archives = selected.map(source => state.snapshots.get(source.id).archive);
        const signature = [getMetric(), state.windowMs, state.frozen, Math.floor((state.frozen ? state.frozenAt : at) / 30000),
            ...selected.map(source => source.id + ':' + source.status + ':' + state.snapshots.get(source.id).revision)].join('|');
        if (signature === plotSignature && !force) return;
        plotSignature = signature;
        if (!selected.length) {clearChart(); state.chartIds = []; reportData = []; renderReports(); return;}
        const data = buildLiveModelSeries(archives, getMetric(), {now: state.frozen ? state.frozenAt : at, windowMs: state.windowMs});
        const same = state.chartIds.length === ids.length && ids.every((id, index) => state.chartIds[index] === id);
        if (!same) {
            clearChart();
            // Visibility belongs to the source, not its current legend index.
            // Keep choices for removed sources so reselecting one restores it.
            state.chartState = {...state.chartState, start: 0, end: data.axisMs, cursor: 0, pinned: false,
                axisMs: data.axisMs, axisMode: 'live', originAt: data.originAt, sourceIds: ids,
                hidden: ids.flatMap((id, index) => state.hiddenSources.has(id) ? [index] : [])};
            state.reportPage = 0; resetRange = true;
        }
        state.colors = allocateLiveModelColors(selected.map(source => source.room), state.colors, currentRoom);
        const config = {originAt: data.originAt, sourceIds: ids, fitVisibleRange: state.windowMs === Infinity, allowAllHidden: true,
            colorIndices: selected.map(source => state.colors.get(source.room))};
        if (view) view.update(data.series, data.axisMs, ANALYSIS_METRICS[getMetric()], 'live', config);
        else {
            view = renderAnalysisChart(chartHost, data.series, selected.map(source => source.room), data.axisMs,
                ANALYSIS_METRICS[getMetric()], state.chartState, 'live', config);
            if (window.ResizeObserver) {observer = new window.ResizeObserver(view.draw); observer.observe(view.canvas);}
        }
        if (resetRange) {view.resetRange(); resetRange = false;}
        state.chartIds = ids.slice();
        state.displayAt = state.frozen ? state.frozenAt : at;
        const metric = getMetric();
        reportData = selected.map(source => {
            const archive = state.snapshots.get(source.id).archive, history = archive.session.history;
            return {room: source.room, value: metric === 'room' ? history.total.at(-1) + history.anonymous.at(-1) : history[metric].at(-1),
                time: history.timestamps.at(-1), samples: history.timestamps.length, status: describe(source) + (state.frozen ? ' · chart frozen' : '')};
        });
        renderReports();
    }
    function renderReports() {
        const pages = Math.ceil(reportData.length / MODEL_PAGE_SIZE);
        state.reportPage = Math.max(0, Math.min(state.reportPage, pages - 1));
        const offset = state.reportPage * MODEL_PAGE_SIZE;
        reportControls.hidden = reportData.length <= MODEL_PAGE_SIZE;
        reportPrevious.disabled = state.reportPage === 0; reportNext.disabled = state.reportPage + 1 >= pages;
        reportRange.textContent = (reportData.length ? offset + 1 : 0) + '–' + Math.min(reportData.length, offset + MODEL_PAGE_SIZE) + ' of ' + reportData.length + ' models';
        reportBody.replaceChildren(); table.hidden = !reportData.length;
        for (const data of reportData.slice(offset, offset + MODEL_PAGE_SIZE)) {
            const row = node(reportBody, 'tr'); row.dataset.liveReport = data.room;
            node(row, 'th', data.room).scope = 'row'; node(row, 'td', data.value.toLocaleString());
            node(row, 'td', new Date(data.time).toLocaleString()); node(row, 'td', data.samples.toLocaleString()); node(row, 'td', data.status);
        }
    }
    function refresh(force = false) {
        if (disposed || refreshing) return;
        refreshing = true;
        try {
            notice = '';
            const at = Date.now(), result = readLiveModelSources(force), sources = (result.sources || []).filter(source => !isComparisonDismissed(source)), available = new Map(sources.map(source => [source.id, source]));
            sourceExplanation.textContent = sources.some(source => source.kind === 'background') ?
                'Uses scans from TierScope tabs and Compare without watching. Rooms tracked without watching make additional API requests while running.' :
                'Uses scans from your other TierScope tabs. No additional API requests.';
            if (result.error) notice = 'Live sharing is unavailable: ' + result.error + '. Previous snapshots are retained.';
            for (const id of state.selected) {
                if (available.has(id)) continue;
                const previous = state.known.get(id);
                if (previous && isComparisonDismissed(previous)) {
                    state.selected.delete(id); state.snapshots.delete(id); state.known.delete(id);
                    if (state.choices.get(previous.room) === id) state.choices.delete(previous.room);
                    continue;
                }
                if (previous) sources.push({...previous, status: 'unavailable'});
            }
            clearableSources = sources.filter(source => ['stopped', 'stale'].includes(source.status) ||
                source.status === 'unavailable' && !available.has(source.id));
            clearInactive.disabled = !clearableSources.length;
            const groups = new Map();
            sources.sort((a, b) => a.room.localeCompare(b.room) || a.id.localeCompare(b.id));
            for (const source of sources) {
                state.known.set(source.id, source);
                if (!groups.has(source.room)) groups.set(source.room, []);
                groups.get(source.room).push(source);
            }
            for (const room of state.choices.keys()) if (!groups.has(room)) state.choices.delete(room);
            for (const [room, entries] of groups) {
                const choice = state.choices.get(room), previous = state.known.get(choice);
                const candidates = entries.filter(source => available.has(source.id) && !['reset', 'unavailable', 'stale'].includes(source.status));
                const preferred = candidates.sort((a, b) => b.sampleCount - a.sampleCount ||
                    Number(b.id === choice) - Number(a.id === choice) || (b.sampleAt || 0) - (a.sampleAt || 0) || a.id.localeCompare(b.id))[0];
                // Duplicate-tab preference is explicit. A Reset/new session in
                // the same tab still needs a deliberate source choice instead
                // of replacing the old session behind the user's back.
                const changedSession = previous && entries.some(source => available.has(source.id) &&
                    source.publisherId === previous.publisherId && source.id !== choice);
                if (!state.frozen && preferred && !result.error && (!choice || !state.selected.has(choice) ||
                    previous?.status !== 'reset' && !changedSession &&
                    (!available.has(choice) || previous?.status === 'stale' || preferred.sampleCount > previous.sampleCount))) {
                    if (choice && choice !== preferred.id) {
                        rememberChart();
                        if (state.hiddenSources.has(choice)) state.hiddenSources.add(preferred.id); else state.hiddenSources.delete(preferred.id);
                    }
                    if (state.selected.delete(choice)) state.selected.add(preferred.id);
                    state.choices.set(room, preferred.id);
                } else if (!choice) state.choices.set(room, entries[0].id);
            }
            if (!state.autoPicked) {
                const initial = [...groups].map(([room]) => state.known.get(state.choices.get(room)))
                    .filter(eligible);
                if (initial.length) {initial.forEach(source => state.selected.add(source.id)); state.autoPicked = true;}
            }
            currentGroups = groups;
            updateRows(groups, at);
            const selected = [...state.selected].map(id => state.known.get(id)).filter(value => !!value);
            updateChart(selected, at, force);
            freeze.textContent = state.frozen ? 'Resume comparison' : 'Freeze comparison';
            freeze.setAttribute('aria-pressed', String(state.frozen)); freeze.disabled = !state.snapshots.size;
            chooserTitle.textContent = 'Models being tracked · ' + groups.size + ' · ' + state.selected.size + ' selected';
            empty.hidden = groups.size > 0;
            empty.textContent = 'Open broadcast rooms in other tabs with TierScope enabled, or use Compare without watching in Current Live Session. Models appear after tracking starts; no favorite or saved Library session is required.';
            const unavailable = selected.filter(source => ['unavailable', 'reset', 'stale'].includes(source.status)).length;
            status.textContent = (state.frozen ? 'Frozen at ' + new Date(state.frozenAt).toLocaleTimeString() + ' · source status still updates.' : 'Following new scans · ' + state.selected.size + ' models selected.') +
                (unavailable ? ' ' + unavailable + ' source(s) unavailable or stale; open Models being tracked for details.' : '') +
                (notice ? ' ' + notice : '') + (userNotice ? ' ' + userNotice : '');
            if (!groups.size) {chooser.open = true; status.textContent = 'Open a room in another TierScope tab or use Compare without watching in Current Live Session.';}
            for (const id of [...state.snapshots.keys()]) if (!state.selected.has(id)) state.snapshots.delete(id);
            retainLiveModelArchives(state.selected);
            const chosenIds = new Set(state.choices.values());
            for (const id of [...state.known.keys()]) if (!available.has(id) && !state.selected.has(id) && !chosenIds.has(id)) state.known.delete(id);
        } catch (error) {status.textContent = 'Live comparison unavailable: ' + error.message + '. Existing session data is unchanged.';}
        finally {refreshing = false;}
    }
    refresh();
    detach = subscribeLiveModelSources(() => refresh());
    detachDismissals = subscribeComparisonDismissals(() => refresh());
    return {
        refresh, draw() {if (view) view.draw();},
        dispose() {
            if (disposed) return; disposed = true;
            if (detach) detach();
            if (detachDismissals) detachDismissals();
            if (view) {rememberChart(); view.dispose();}
            if (observer) observer.disconnect();
        }
    };
}
