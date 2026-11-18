import { buildClockPlot, inspectClockSample } from './analysis-clock-data.js';
import { ANALYSIS_LINE_PAGE_SIZE, COMPARISON_BACKGROUND_OPACITY, COMPARISON_FOREGROUND_COUNT, comparisonLabel, comparisonLineColor, comparisonOpacity, comparisonSeriesOrder, analysisSampleIndex, buildAnalysisPlot, inspectAnalysisSample, visibleAnalysisWindow, zoomAnalysisWindow } from './analysis-chart-data.js';
import { toolNode as node, toolButton as button } from './tools-view-helpers.js';

// Receives snapshots of analysis values, not live/playback owners or archives.
// Cache the chart bitmap between cursor moves; long recordings are only drawn
// again for zoom, visibility, size or theme changes.
export function renderAnalysisChart(parent, series, labels, axisMs, metricLabel, savedState = null, axisMode = 'elapsed', config = {}) {
    const element = node(parent, 'div'); element.id = 'tools-chart-view'; parent = element;
    let start = 0, end = axisMs, cursor = 0, pinned = false, drag = null, disposed = false;
    let followingFull = savedState?.followingFull ?? true;
    function datedAxis(mode = axisMode) { return mode === 'live' || mode === 'timeline'; }
    const hidden = new Set(), controls = node(parent, 'div', undefined, 'tools-actions');
    if (savedState && (savedState.axisMode || 'elapsed') === axisMode) {
        ({start, end, cursor, pinned} = savedState);
        savedState.hidden.forEach(index => { if (index >= 0 && index < series.length) hidden.add(index); });
        if (hidden.size === series.length && !config.allowAllHidden) hidden.delete(0);
        fitWindow(savedState.axisMs, datedAxis() ? (savedState.originAt || 0) - (config.originAt || 0) : 0);
    }
    let plotCache = null;
    const number = value => value.toLocaleString(undefined, {maximumFractionDigits: 2});
    const elapsed = ms => number(ms / 60000) + 'm';
    const clock = ms => {
        const seconds = Math.floor(ms / 1000), pad = n => String(n).padStart(2, '0');
        return pad(Math.floor(seconds / 3600)) + ':' + pad(Math.floor(seconds / 60) % 60) +
            (end - start < 60000 ? ':' + pad(seconds % 60) : '');
    };
    const liveDate = ms => new Date((config.originAt || 0) + ms);
    const liveClock = ms => liveDate(ms).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit',
        ...(end - start < 60000 ? {second: '2-digit'} : {})});
    const axisLabel = ms => datedAxis() ? liveClock(ms) : axisMode === 'clock' ? clock(ms) : elapsed(ms);
    const chartLabel = () => metricLabel + (axisMode === 'live' ? ' for live models, aligned by actual dated sample timestamps.' :
        axisMode === 'timeline' ? ' across sessions, aligned by actual dated sample timestamps.' :
        axisMode === 'clock' ? ' by local time of day, 00:00 to 24:00.' : ' by real elapsed time.') +
        ' Arrow keys inspect samples; plus and minus zoom; Home and End jump to visible endpoints.';

    const zoomIn = button(controls, 'Zoom +', () => zoom(0.5), 'tools-chart-zoom-in');
    const zoomOut = button(controls, 'Zoom −', () => zoom(2), 'tools-chart-zoom-out');
    const panLeft = button(controls, '‹', () => pan(-1), 'tools-chart-pan-left'); panLeft.setAttribute('aria-label', 'Pan earlier');
    const panRight = button(controls, '›', () => pan(1), 'tools-chart-pan-right'); panRight.setAttribute('aria-label', 'Pan later');
    button(controls, 'Full range', resetRange, 'tools-chart-reset');
    const pin = button(controls, 'Pin cursor', () => { pinned = !pinned; inspect(); }, 'tools-chart-pin');
    const legend = node(parent, 'div', undefined, 'tools-chart-legend');
    // Original session dates own saved-session styling even when a rolling
    // window clips earlier samples. Live models use their stable color slots.
    let newestFirst, colorIndices, opacities, newest, primarySeries, trackedSeries, backgroundSeries;
    function refreshSeriesStyling() {
        const order = comparisonSeriesOrder(series, config.rankTimes);
        newestFirst = order.newestFirst;
        const {ranks} = order;
        primarySeries = series.map((_, index) => config.seriesStyles?.[index]?.primary === true);
        const useLiveDefaults = axisMode === 'live' && !config.seriesStyles;
        trackedSeries = series.map((_, index) => useLiveDefaults || primarySeries[index] || config.seriesStyles?.[index]?.live === true);
        backgroundSeries = ranks.map((rank, index) => !trackedSeries[index] && rank >= COMPARISON_FOREGROUND_COUNT);
        newest = newestFirst[0];
        const reservePink = primarySeries.includes(true) || axisMode === 'timeline' && !!config.seriesStyles;
        colorIndices = ranks.map((rank, index) => {
            if (primarySeries[index]) return 0;
            if (axisMode === 'live') return config.colorIndices?.[index] ?? index;
            return rank + Number(reservePink);
        });
        opacities = ranks.map((rank, index) => trackedSeries[index] ? 1 : comparisonOpacity(rank));
    }
    refreshSeriesStyling();
    const legendLabels = new Map(), rows = new Map();
    // A retained search must remain clearable if the rolling selection shrinks
    // below the usual paging threshold while the chart is being rebuilt.
    const paged = series.length > ANALYSIS_LINE_PAGE_SIZE || !!savedState?.lineQuery;
    let linePage = savedState?.linePage || 0, lineQuery = savedState?.lineQuery || '';
    let matchingLines = series.map((_, index) => index), pageIndices = [], legendDark = true, legendBackground = '';
    const canvas = node(parent, 'canvas'); canvas.id = 'tools-analysis-chart'; canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    parent.insertBefore(canvas, legend);
    canvas.setAttribute('aria-label', chartLabel());
    const range = node(parent, 'p', '', 'tools-muted'); range.id = 'tools-chart-range';
    parent.insertBefore(range, legend);
    const settings = node(parent, 'div');
    const hint = node(parent, 'p', '', 'tools-muted');
    const scroll = node(parent, 'div', undefined, 'tools-scroll tools-chart-inspection-scroll'), table = node(scroll, 'table'); table.id = 'tools-chart-inspection';
    const caption = node(table, 'caption');
    const header = node(node(table, 'thead'), 'tr'); [axisMode === 'live' ? 'Model' : 'Session','Count','Sample timestamp / status'].forEach(text => { node(header, 'th', text).scope = 'col'; });
    const body = node(table, 'tbody');
    const lineControls = node(parent, 'div', undefined, 'tools-actions'); lineControls.id = 'tools-chart-lines'; lineControls.hidden = !paged;
    // Library's flex action-row rule otherwise overrides the browser's hidden rule.
    if (!paged) lineControls.style.display = 'none';
    parent.insertBefore(lineControls, legend);
    const searchLabel = node(lineControls, 'label', 'Find line '), lineSearch = node(searchLabel, 'input');
    lineSearch.type = 'search'; lineSearch.id = 'tools-chart-line-search'; lineSearch.setAttribute('aria-label', 'Find comparison line');
    lineSearch.placeholder = 'Model, session or line label'; lineSearch.value = lineQuery;
    const linePrevious = button(lineControls, 'Previous', () => {linePage--; renderLinePage(); inspect();}, 'tools-chart-lines-previous');
    linePrevious.setAttribute('aria-label', 'Previous comparison lines');
    const lineNext = button(lineControls, 'Next', () => {linePage++; renderLinePage(); inspect();}, 'tools-chart-lines-next');
    lineNext.setAttribute('aria-label', 'Next comparison lines');
    const lineStatus = node(lineControls, 'span', '', 'tools-muted'); lineStatus.id = 'tools-chart-lines-status'; lineStatus.setAttribute('role', 'status');
    lineSearch.oninput = () => {lineQuery = lineSearch.value; linePage = 0; filterLines(); renderLinePage(); inspect();};
    function filterLines() {
        const query = lineQuery.trim().toLocaleLowerCase();
        matchingLines = series.map((_, index) => index).filter(index => !query ||
            (comparisonLabel(index) + ' ' + labels[index]).toLocaleLowerCase().includes(query));
    }
    function paintLegend() {
        for (const [i, item] of legendLabels) {
            const label = labels[i], background = backgroundSeries[i];
            item.control.style.color = background ? legendBackground : comparisonLineColor(colorIndices[i], legendDark);
            item.check.checked = !hidden.has(i); item.check.disabled = !config.allowAllHidden && hidden.size === series.length - 1 && !hidden.has(i);
            item.swatch.style.borderTopStyle = trackedSeries[i] ? 'solid' : 'dashed';
            item.swatch.style.opacity = String(opacities[i]);
            const marker = primarySeries[i] ? ' · Current' : trackedSeries[i] ? ' · Tracked' :
                (axisMode !== 'timeline' && series.length > 1 && i === newest ? ' · Latest' : '');
            item.text.textContent = axisMode === 'live' ? label : comparisonLabel(i) + marker + ' · ' + label;
            item.control.title = (primarySeries[i] ? 'Current tracked session — solid pink: ' : trackedSeries[i] ?
                'Currently tracked session — solid, 100% opacity: ' : (background ? 'Background session' : 'Historical session') +
                ' — dashed, ' + Math.round(opacities[i] * 100) + '% opacity: ') + label;
        }
    }
    function renderLinePage() {
        const pageSize = paged ? ANALYSIS_LINE_PAGE_SIZE : series.length || 1;
        linePage = Math.max(0, Math.min(linePage, Math.max(0, Math.ceil(matchingLines.length / pageSize) - 1)));
        const first = linePage * pageSize;
        pageIndices = matchingLines.slice(first, first + pageSize);
        legend.replaceChildren(); body.replaceChildren(); legendLabels.clear(); rows.clear();
        for (const i of pageIndices) {
            const control = node(legend, 'label'), check = node(control, 'input'); check.type = 'checkbox'; check.dataset.analysisSeries = String(i);
            const swatch = node(control, 'span', '', 'tools-series-swatch'); swatch.setAttribute('aria-hidden', 'true');
            const text = node(control, 'span'); legendLabels.set(i, {control, check, swatch, text});
            check.onchange = () => {
                if (!check.checked && !config.allowAllHidden && hidden.size === series.length - 1) {check.checked = true; return;}
                if (check.checked) hidden.delete(i); else hidden.add(i);
                if (config.fitVisibleRange) resetRange(); else draw();
            };
            const row = node(body, 'tr'); row.dataset.analysisInspection = String(i);
            const heading = node(row, 'th', axisMode === 'live' ? labels[i] : comparisonLabel(i)); heading.scope = 'row'; heading.title = labels[i];
            heading.setAttribute('aria-label', axisMode === 'live' ? labels[i] : comparisonLabel(i) + ' · ' + labels[i]);
            rows.set(i, {row, value: node(row, 'td'), detail: node(row, 'td')});
        }
        linePrevious.disabled = linePage === 0; lineNext.disabled = first + pageSize >= matchingLines.length;
        lineStatus.textContent = matchingLines.length ? 'Lines ' + (first + 1) + '–' + (first + pageIndices.length) + ' of ' + matchingLines.length +
            (lineQuery.trim() ? ' matching / ' + series.length + ' total' : '') + ' · All enabled lines remain drawn.' : 'No matching lines · ' + series.length + ' total.';
        paintLegend();
    }
    const bitmap = document.createElement('canvas'), backgroundBitmap = document.createElement('canvas');
    let width = 260, height = 200, ratio = 1, left = 52, right = 248, top = 15, bottom = 164;
    const timeAt = event => {
        const bounds = canvas.getBoundingClientRect(), x = (event.clientX - bounds.left) * width / bounds.width;
        return start + Math.max(0, Math.min(1, (x - left) / (right - left))) * (end - start);
    };
    function zoom(factor) { followingFull = false; [start, end] = zoomAnalysisWindow(axisMs, start, end, factor, cursor); cursor = Math.max(start, Math.min(end, cursor)); draw(); }
    function pan(direction) {
        followingFull = false;
        const span = end - start, next = Math.max(0, Math.min(axisMs - span, start + direction * span / 2));
        start = next; end = next + span; cursor = Math.max(start, Math.min(end, cursor)); draw();
    }
    function inspect() {
        if (disposed) return;
        caption.textContent = 'Cursor ' + (datedAxis() ? liveDate(cursor).toLocaleString() : axisLabel(cursor)) + (pinned ? ' · pinned' : '');
        pin.textContent = pinned ? 'Unpin' : 'Pin'; pin.setAttribute('aria-label', pinned ? 'Unpin inspection cursor' : 'Pin inspection cursor'); pin.setAttribute('aria-pressed', String(pinned));
        for (const [i, row] of rows) {
            const s = series[i]; row.row.hidden = hidden.has(i);
            if (axisMode === 'clock') {
                const sample = inspectClockSample(s.clock, cursor);
                row.value.textContent = sample.matches.length ? sample.matches.map(match => number(match.value)).join(' / ') : '—';
                row.detail.textContent = sample.matches.length ? sample.matches.map(match =>
                    new Date(match.timestamp).toLocaleString(undefined, {timeZoneName: 'shortOffset'}) + ' · sample ' + (match.index + 1) +
                    (match.kind === 'held' ? ' (held until next sample)' : '')).join(' ; ') :
                    sample.kind === 'gap' ? 'Session gap — no sample' : 'Outside session at this clock time';
            } else {
                const sample = inspectAnalysisSample(s, cursor);
                row.value.textContent = sample.value === null ? '—' : number(sample.value);
                row.detail.textContent = sample.kind === 'gap' ? 'Session gap — no sample' : sample.kind === 'outside' ?
                    (datedAxis() ? 'No accepted sample at this time' : 'Outside session') :
                    new Date(sample.timestamp).toLocaleString() + ' · sample ' + (sample.index + 1) + (sample.kind === 'held' ? ' (held until next sample)' : '');
            }
        }
        const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height); ctx.drawImage(bitmap, 0, 0, width, height);
        const style = window.getComputedStyle(parent);
        const x = left + (cursor - start) / (end - start || 1) * (right - left);
        ctx.strokeStyle = style.getPropertyValue('--panel-text').trim(); ctx.setLineDash([3,3]); ctx.lineWidth = 1;
        if (cursor >= start && cursor <= end) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
        ctx.setLineDash([]);
        if (drag) {
            ctx.fillStyle = '#ff69b433'; const from = left + (drag.from - start) / (end - start || 1) * (right - left);
            ctx.fillRect(Math.min(from, x), top, Math.abs(x - from), bottom - top);
        }
    }
    function draw() {
        if (disposed) return;
        width = Math.max(260, canvas.clientWidth); right = width - 14; ratio = (window.devicePixelRatio || 1) * (Number(canvas.closest('#tierscope-session-tools')?.dataset.renderScale) || 1);
        height = Math.max(100, canvas.clientHeight || 200); bottom = height - 36;
        canvas.width = bitmap.width = width * ratio; canvas.height = bitmap.height = height * ratio;
        const ctx = bitmap.getContext('2d'); ctx.scale(ratio, ratio);
        const style = window.getComputedStyle(parent), isDark = parent.closest('[data-theme]')?.dataset.theme !== 'bright';
        legendDark = isDark; legendBackground = style.getPropertyValue('--panel-muted').trim();
        if (!plotCache || plotCache.series !== series || plotCache.start !== start || plotCache.end !== end || plotCache.width !== right - left) {
            plotCache = {series, start, end, width: right - left, plots: new Array(series.length)};
        }
        const plots = series.map((s, j) => hidden.has(j) ? null :
            (plotCache.plots[j] ||= axisMode === 'clock' ? buildClockPlot(s.clock, start, end, right - left) : buildAnalysisPlot(s, start, end, right - left)));
        let maximum = 1;
        for (const plot of plots) if (plot) maximum = Math.max(maximum, plot.maximum);
        ctx.strokeStyle = style.getPropertyValue('--panel-divider').trim(); ctx.fillStyle = style.getPropertyValue('--panel-muted').trim(); ctx.font = '10px Arial';
        for (let step = 0; step <= 2; step++) {
            const y = bottom - step / 2 * (bottom - top); ctx.beginPath(); ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
            ctx.textAlign = 'right';ctx.fillText(number(maximum * step / 2),left-5,y+3);
        }
        if (axisMode === 'clock' || datedAxis()) {
            const steps = datedAxis() ? 2 : 4;
            for (let step = 0; step <= steps; step++) {
                ctx.textAlign = step === 0 ? 'left' : step === steps ? 'right' : 'center';
                ctx.fillText(axisLabel(start + (end - start) * step / steps), left + (right - left) * step / steps, bottom + 20);
            }
        } else {
            ctx.textAlign = 'left';ctx.fillText(elapsed(start),left,bottom+20);ctx.textAlign = 'right';ctx.fillText(elapsed(end),right,bottom+20);
        }
        const backgroundColor = style.getPropertyValue('--panel-muted').trim();
        function paintSeries(target, j, color) {
            target.strokeStyle = target.fillStyle = color; target.lineWidth = backgroundSeries[j] ? 1.2 : 1.8; target.lineCap = 'butt';
            target.setLineDash(trackedSeries[j] ? [] : [6,4]); target.beginPath();
            let previousY = 0;
            const dots = [], points = plots[j].points;
            points.forEach((point, i) => {
                const x = left + (point.time-start)/(end-start||1)*(right-left), y = bottom - point.value/maximum*(bottom-top);
                if (point.move) target.moveTo(x,y); else {target.lineTo(x,previousY);target.lineTo(x,y);}
                if (point.move && (i+1===points.length || points[i+1].move)) dots.push([x,y]);
                previousY=y;
            });
            target.stroke(); target.setLineDash([]); dots.forEach(([x,y])=>{target.beginPath();target.arc(x,y,2.5,0,Math.PI*2);target.fill();});
        }
        const backgroundIndices = newestFirst.filter(j => backgroundSeries[j] && !hidden.has(j));
        // Composite the background once: overlapping old traces never build
        // up opacity and overwhelm the recent sessions.
        backgroundBitmap.width = backgroundIndices.length ? width * ratio : 0;
        backgroundBitmap.height = backgroundIndices.length ? height * ratio : 0;
        if (backgroundIndices.length) {
            const backgroundCtx = backgroundBitmap.getContext('2d'); backgroundCtx.scale(ratio, ratio);
            for (const j of backgroundIndices) paintSeries(backgroundCtx, j, backgroundColor);
            ctx.globalAlpha = COMPARISON_BACKGROUND_OPACITY; ctx.drawImage(backgroundBitmap, 0, 0, width, height); ctx.globalAlpha = 1;
        }
        function paintForeground(j) {
            if (hidden.has(j) || backgroundSeries[j]) return;
            const color = comparisonLineColor(colorIndices[j], isDark);
            ctx.globalAlpha = opacities[j]; paintSeries(ctx, j, color);
        }
        // Paint older history first, followed by tracked sessions and the current room.
        for (let layer = 0; layer < 3; layer++) for (let position = newestFirst.length - 1; position >= 0; position--) {
            const j = newestFirst[position], seriesLayer = primarySeries[j] ? 2 : trackedSeries[j] ? 1 : 0;
            if (seriesLayer === layer) paintForeground(j);
        }
        ctx.globalAlpha = 1;
        range.textContent = 'Chart window ' + (datedAxis() ? liveDate(start).toLocaleString() + ' – ' + liveDate(end).toLocaleString() :
            axisLabel(start) + ' – ' + axisLabel(end) + (axisMode === 'clock' ? ' · 24h local clock' : ' · full comparison/session range ' + elapsed(axisMs)));
        hint.textContent = (axisMode === 'live' ?
            'Models are aligned by actual dated sample timestamps. Each line ends at its last accepted scan; it is not extended to the current time.' : axisMode === 'timeline' ?
            'Sessions are aligned by actual dated sample timestamps. Lines end at the last accepted sample, with no assumed coverage to the current time.' : axisMode === 'clock' ?
            'Aligned by local time of day. Midnight crossings continue at the start of the chart. Clock changes are separate segments; repeated clock times can show multiple dated values. Statistics use full sessions.' :
            'Aligned from each session’s first retained sample, using real elapsed time. Hidden lines and zoom do not change summary totals or the shared comparison length.') +
            ' Move to inspect; click to pin, drag to zoom, or use the buttons and arrow keys. Gaps have no assumed samples.' +
            (series.length > 1 || datedAxis() ? ' Ongoing sessions use solid lines. Dashed lines fade with age and turn gray after the newest ' +
                COMPARISON_FOREGROUND_COUNT + ' sessions.' : '');
        zoomIn.disabled = end-start <= Math.min(1000,axisMs); zoomOut.disabled = end-start >= axisMs;
        panLeft.disabled = start <= 0; panRight.disabled = end >= axisMs; paintLegend(); inspect();
    }
    canvas.onpointermove = event => { if (!pinned || drag) { cursor = timeAt(event); inspect(); } };
    canvas.onpointerdown = event => { if (event.button !== 0) return; canvas.focus(); drag = {from: timeAt(event), x: event.clientX, pinned}; canvas.setPointerCapture(event.pointerId); cursor = drag.from; inspect(); };
    canvas.onpointerup = event => {
        if (!drag) return;
        const origin = drag; cursor = timeAt(event); drag = null;
        if (Math.abs(event.clientX-origin.x)>5 && Math.abs(cursor-origin.from)>=Math.min(1000,axisMs)) {
            followingFull = false; start = Math.min(cursor,origin.from);end = Math.max(cursor,origin.from);pinned = origin.pinned;draw();
        } else {pinned=!origin.pinned;inspect();}
        if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    };
    canvas.onpointercancel = () => { drag = null; inspect(); };
    canvas.onkeydown = event => {
        if (!['ArrowLeft','ArrowRight','Home','End','+','=','-','Escape'].includes(event.key)) return;
        event.preventDefault();
        if (event.key==='+'||event.key==='=') {zoom(0.5);return;} if(event.key==='-'){zoom(2);return;}
        if(event.key==='Escape'){pinned=false;inspect();return;}
        if(event.key==='Home')cursor=start;else if(event.key==='End')cursor=end;
        else {
            let target=event.key==='ArrowRight'?end:start;
            for(let j=0;j<series.length;j++)if(!hidden.has(j)){
                const times=axisMode === 'clock' ? series[j].clock.navigation : series[j].times, index=analysisSampleIndex(times,cursor);
                if(event.key==='ArrowRight'&&index+1<times.length)target=Math.min(target,times[index+1]);
                if(event.key==='ArrowLeft'){
                    let i=index;while(i>=0&&times[i]>=cursor)i--;if(i>=0)target=Math.max(target,times[i]);
                }
            }
            cursor=Math.max(start,Math.min(end,target));
        }
        pinned=true;inspect();
    };
    function fitWindow(previousAxis, originShift = 0) {
        if (start === 0 && end === previousAxis) { start = 0; end = axisMs; }
        else {
            const span = Math.min(Math.max(0, end - start), axisMs);
            start = Math.max(0, Math.min(start + originShift, axisMs - span)); end = start + span;
        }
        cursor = Math.max(start, Math.min(end, cursor + originShift));
    }
    function fitFullRange() {
        [start, end] = config.fitVisibleRange ? visibleAnalysisWindow(series, hidden, axisMs) : [0, axisMs];
        cursor = Math.max(start, Math.min(end, cursor));
    }
    function resetRange() {followingFull = true; fitFullRange(); draw();}
    if (config.fitVisibleRange && followingFull) fitFullRange();
    filterLines(); renderLinePage(); draw();
    return {element, canvas, settings, draw, resetRange,
        capture: () => ({start, end, cursor, pinned, axisMs, axisMode, hidden: [...hidden],
            ...(datedAxis() ? {originAt: config.originAt, sourceIds: config.sourceIds} : {}),
            ...(config.fitVisibleRange ? {followingFull} : {}),
            ...(paged ? {linePage, lineQuery} : {})}),
        update(nextSeries, nextAxis, nextMetricLabel, nextMode = 'elapsed', nextConfig = config) {
            if (disposed) return;
            const originShift = datedAxis() && datedAxis(nextMode) ? (config.originAt || 0) - (nextConfig.originAt || 0) : 0;
            const previousAxis = axisMs; series = nextSeries; axisMs = nextAxis; metricLabel = nextMetricLabel;
            config = nextConfig;
            if (axisMode !== nextMode) {
                axisMode = nextMode; start = 0; end = axisMs; cursor = 0; pinned = false; followingFull = true;
            } else fitWindow(previousAxis, originShift);
            if (config.fitVisibleRange && followingFull) fitFullRange();
            drag = null; refreshSeriesStyling();
            canvas.setAttribute('aria-label', chartLabel());
            draw();
        },
        dispose() { disposed = true; drag = null; plotCache = null; bitmap.width = bitmap.height = backgroundBitmap.width = backgroundBitmap.height = 0; }
    };
}
