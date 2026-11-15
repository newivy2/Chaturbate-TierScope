// Hides presentation around the existing comparison. Keeping the same nodes
// lets its controller continue updating without resetting chart interaction.
export function attachChartOnlyView(library, {getChart, describe, modeChanged, redraw}) {
    const content = library.querySelector('#tools-content'), toggle = library.querySelector('#tools-chart-only');
    const subtitle = library.querySelector('#tools-compact-subtitle'), status = library.querySelector('#tools-compact-status');
    let compact = false, markedChart = null, path = [], previousScroll = 0, closed = false;
    function clearPath() {
        path.forEach(node => {delete node.dataset.compactPath;}); path = []; markedChart = null;
    }
    function setMode(enabled) {
        if (closed || compact === enabled || enabled && !getChart()) return;
        if (enabled) previousScroll = content.scrollTop;
        compact = enabled; library.dataset.chartOnly = String(compact);
        toggle.textContent = compact ? 'Expand' : 'Chart only';
        toggle.title = compact ? 'Restore the full Library' : 'Keep only the current comparison chart visible';
        toggle.setAttribute('aria-pressed', String(compact));
        toggle.setAttribute('aria-label', compact ? 'Expand Library' : 'Show comparison chart only');
        if (!compact) {clearPath(); content.scrollTop = previousScroll;}
        else content.scrollTop = 0;
        modeChanged(compact); sync();
        (toggle.disabled ? library.querySelector('#tools-close') : toggle).focus({preventScroll: true});
    }
    function sync() {
        if (closed) return;
        const chart = getChart();
        if (compact && !chart) {setMode(false); return;}
        toggle.disabled = !compact && !chart;
        if (!compact) {toggle.title = chart ? 'Keep only the current comparison chart visible' : 'Open a comparison to use chart-only view'; return;}
        if (markedChart !== chart) {
            clearPath(); markedChart = chart;
            for (let node = chart; node && node !== content; node = node.parentElement) {
                node.dataset.compactPath = ''; path.push(node);
            }
            redraw();
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
    library.dataset.chartOnly = 'false'; sync();
    return {sync, dispose() {
        closed = true; observer.disconnect(); toggle.onclick = null; clearPath();
    }};
}
