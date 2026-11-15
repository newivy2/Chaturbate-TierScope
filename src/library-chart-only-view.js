// Hides presentation around the existing comparison. Keeping the same nodes
// lets its controller continue updating without resetting chart interaction.
export function attachChartOnlyView(library, {getChart, describe, modeChanged, redraw}) {
    const content = library.querySelector('#tools-content'), toggle = library.querySelector('#tools-chart-only');
    const subtitle = library.querySelector('#tools-compact-subtitle'), status = library.querySelector('#tools-compact-status');
    let compact = false, markedChart = null, path = [], controls = [], controlPath = [], previousScroll = 0, closed = false;
    let frame = 0, aimAtChart = false, restoringScroll = false, userScroll = 0, activeMode = '';
    function scheduleLayout() {
        if (!closed && compact && !frame) frame = window.requestAnimationFrame(layout);
    }
    function layout() {
        frame = 0;
        if (closed || !compact || !markedChart?.isConnected) return;
        const style = window.getComputedStyle(content), top = parseFloat(style.paddingTop) || 0, bottom = parseFloat(style.paddingBottom) || 0;
        // Size the plot from the scroll viewport, never its growing contents.
        const height = Math.max(200, Math.floor(content.clientHeight - top - bottom));
        const value = height + 'px';
        if (library.style.getPropertyValue('--compact-chart-height') !== value) library.style.setProperty('--compact-chart-height', value);
        if (aimAtChart) {
            const scale = Number(library.dataset.renderScale) || 1;
            content.scrollTop += (markedChart.getBoundingClientRect().top - content.getBoundingClientRect().top) / scale - top;
            // A mode shortcut can be scrolled offscreen after its activation.
            if (content.contains(document.activeElement)) markedChart.focus({preventScroll: true});
        } else content.scrollTop = userScroll;
        userScroll = content.scrollTop; aimAtChart = false; restoringScroll = false;
        redraw();
    }
    function rememberScroll() {if (compact && !restoringScroll) userScroll = content.scrollTop;}
    function resized() {if (compact) {restoringScroll = true; scheduleLayout();}}
    function chooseMode(event) {
        if (compact && event.target.closest('.tools-comparison-mode button')) {
            aimAtChart = true; restoringScroll = true; scheduleLayout();
        }
    }
    function clearPath() {
        path.forEach(node => {delete node.dataset.compactPath;}); path = []; markedChart = null;
        controls.forEach(node => {delete node.dataset.compactControl;}); controls = [];
        controlPath.forEach(node => {delete node.dataset.compactControlPath;}); controlPath = [];
    }
    function chartControls(chart) {
        const nodes = [...content.querySelectorAll('.tools-comparison-mode, .tools-metric-strip, #tools-comparison-range')];
        for (const id of ['tools-live-window', 'tools-recent-range', 'tools-compare-axis']) {
            const select = content.querySelector('#' + id);
            if (select) nodes.push(select.closest('label') || select);
        }
        const zoom = chart.parentElement.querySelector(':scope > .tools-actions');
        if (zoom) nodes.push(zoom);
        return nodes;
    }
    function setMode(enabled) {
        if (closed || compact === enabled || enabled && !getChart()) return;
        if (enabled) previousScroll = content.scrollTop;
        compact = enabled; library.dataset.chartOnly = String(compact);
        toggle.textContent = compact ? 'Expand' : 'Chart only';
        toggle.title = compact ? 'Restore the full Library' : 'Keep only the current comparison chart visible';
        toggle.setAttribute('aria-pressed', String(compact));
        toggle.setAttribute('aria-label', compact ? 'Expand Library' : 'Show comparison chart only');
        if (!compact) {
            clearPath(); activeMode = ''; aimAtChart = false; restoringScroll = false;
            if (frame) window.cancelAnimationFrame(frame); frame = 0;
            content.scrollTop = previousScroll;
        } else {aimAtChart = true; restoringScroll = true; userScroll = 0;}
        modeChanged(compact); sync();
        (toggle.disabled ? library.querySelector('#tools-close') : toggle).focus({preventScroll: true});
    }
    function sync() {
        if (closed) return;
        const chart = getChart();
        if (compact && !chart) {setMode(false); return;}
        toggle.disabled = !compact && !chart;
        if (!compact) {toggle.title = chart ? 'Keep only the current comparison chart visible' : 'Open a comparison to use chart-only view'; return;}
        const mode = content.querySelector('.tools-comparison-mode [aria-pressed=true]')?.id || '';
        if (activeMode && mode !== activeMode) aimAtChart = true;
        activeMode = mode;
        const nextControls = chartControls(chart);
        if (markedChart !== chart || nextControls.length !== controls.length || nextControls.some((node, index) => node !== controls[index])) {
            clearPath(); markedChart = chart;
            for (let node = chart; node && node !== content; node = node.parentElement) {
                node.dataset.compactPath = ''; path.push(node);
            }
            controls = nextControls;
            controls.forEach(control => {
                control.dataset.compactControl = '';
                for (let node = control.parentElement; node && node !== content; node = node.parentElement) {
                    node.dataset.compactControlPath = ''; controlPath.push(node);
                }
            });
            restoringScroll = true; scheduleLayout();
        }
        const info = describe();
        if (subtitle.textContent !== info.label) subtitle.textContent = info.label;
        subtitle.title = info.label;
        const text = (info.warning ? 'Notice: ' : '') + info.status;
        if (status.textContent !== text) status.textContent = text;
        status.title = text; status.dataset.warning = String(!!info.warning);
    }
    toggle.onclick = () => setMode(!compact);
    // Notifications arrive after a synchronous clear/rebuild has completed.
    // Attribute-only path markers cannot trigger this observer again.
    const observer = new window.MutationObserver(sync);
    observer.observe(content, {childList: true, subtree: true});
    observer.observe(library.querySelector('#tools-message'), {childList: true, subtree: true});
    const resize = window.ResizeObserver ? new window.ResizeObserver(resized) : null;
    if (resize) resize.observe(content);
    window.addEventListener('resize', resized);
    content.addEventListener('scroll', rememberScroll, {passive: true});
    content.addEventListener('click', chooseMode, true);
    library.dataset.chartOnly = 'false'; sync();
    return {sync, dispose() {
        closed = true; observer.disconnect(); toggle.onclick = null; clearPath();
        if (frame) window.cancelAnimationFrame(frame);
        if (resize) resize.disconnect();
        window.removeEventListener('resize', resized); content.removeEventListener('scroll', rememberScroll);
        content.removeEventListener('click', chooseMode, true);
        library.style.removeProperty('--compact-chart-height');
    }};
}
