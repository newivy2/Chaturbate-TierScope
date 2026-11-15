import { setThemeVariables, themeColor } from './theme-values.js';

// Owns temporary docking and Library-only presentation. Geometry changes never
// resize Scope or write tracking state. Persistence is supplied by the caller.
export function attachLibraryDock(panel, library, onTheme, appearance = {}) {
    const original = {left: panel.style.left, top: panel.style.top, right: panel.style.right};
    let lastPosition = {...original}, movedByUser = false, borrowed = false, frame = 0, closed = false;
    let previousTheme = '', previousLayout = '', drag = null;
    const profiles = {full: {scale: appearance.scale || 1, opacity: appearance.opacity || 95},
        compact: {scale: appearance.compactScale || 1, opacity: appearance.compactOpacity || 95}};
    let compact = false, scale = profiles.full.scale, opacity = profiles.full.opacity;
    const baseHeight = Math.max(420, panel.offsetHeight);
    const grip = library.querySelector('#tools-resize-handle'), reset = library.querySelector('#tools-standard-size');
    const slider = library.querySelector('#tools-opacity-slider'), value = library.querySelector('#tools-opacity-value');
    const notice = library.querySelector('#tools-appearance-status');
    const position = () => ({left: panel.style.left, top: panel.style.top, right: panel.style.right});
    function persist() {
        profiles[compact ? 'compact' : 'full'] = {scale, opacity};
        try {if (appearance.save) appearance.save({...profiles.full, compactScale: profiles.compact.scale, compactOpacity: profiles.compact.opacity}); notice.textContent = '';}
        catch (_) {notice.textContent = 'Appearance applies while Library is open; saving failed. Adjust again to retry.';}
    }
    function arrange() {
        frame = 0;
        if (closed || !panel.isConnected || !library.isConnected) return;
        const now = position();
        if (Object.keys(now).some(key => now[key] !== lastPosition[key])) movedByUser = true;
        let rect = panel.getBoundingClientRect();
        const margin = 8, availableWidth = Math.max(1, window.innerWidth - margin * 2), availableHeight = Math.max(1, window.innerHeight - margin * 2);
        // Preserve the preferred scale; temporarily fit small viewports without
        // overwriting it. Fonts, charts and controls share one transform.
        const effective = Math.min(scale, availableWidth / 260, availableHeight / 220);
        const width = Math.min(370 * effective, availableWidth), height = Math.min((compact ? 400 : baseHeight) * effective, availableHeight);
        const docked = window.innerWidth >= rect.width + width + margin * 2;
        if (docked) {
            const left = Math.max(width + margin - 1, Math.min(rect.left, window.innerWidth - rect.width - margin));
            if (Math.abs(left - rect.left) > 0.5) {
                panel.style.left = left + 'px'; panel.style.right = 'auto'; borrowed = true;
                rect = panel.getBoundingClientRect();
            }
        }
        lastPosition = position();
        const top = Math.max(margin, Math.min(rect.top, window.innerHeight - height - margin));
        const styles = {left: (docked ? rect.left - width + 1 : margin) + 'px', top: top + 'px',
            width: width / effective + 'px', height: height / effective + 'px', fontSize: '11px',
            transform: 'scale(' + effective + ')', transformOrigin: 'top left'};
        for (const [key, val] of Object.entries(styles)) if (library.style[key] !== val) library.style[key] = val;
        library.dataset.scale = String(scale); library.dataset.renderScale = String(effective);
        const mode = docked ? 'docked' : 'sheet';
        if (panel.dataset.libraryOpen !== mode) panel.dataset.libraryOpen = mode;
        if (library.dataset.layout !== mode) library.dataset.layout = mode;
        library.style.backgroundColor = 'rgba(' + themeColor('rgb') + ',' + opacity / 100 + ')';
        slider.value = String(opacity); slider.setAttribute('aria-valuetext', opacity + '% background opacity'); value.textContent = opacity + '%';
        reset.textContent = Math.round(effective * 100) + '%';
        reset.title = 'Restore ' + (compact ? 'comparison' : 'Library') + ' to 100% (preferred scale ' + Math.round(scale * 100) + '%)';
        const theme = panel.getAttribute('data-theme') || 'dark';
        if (theme !== previousTheme) {
            previousTheme = theme; library.dataset.theme = theme; setThemeVariables(library);
        }
        const layout = [theme, compact, effective, styles.width, styles.height].join('|');
        if (layout !== previousLayout) {previousLayout = layout; if (onTheme && !drag) onTheme();}
    }
    function schedule() {if (!closed && !frame) frame = window.requestAnimationFrame(arrange);}
    function stopDrag(save) {
        if (!drag) return;
        const id = drag.id; drag = null;
        if (grip.hasPointerCapture(id)) grip.releasePointerCapture(id);
        // Transform the existing bitmap during a drag; redraw it sharply once
        // released instead of rebuilding long comparison charts on every move.
        if (save) {persist(); previousLayout = ''; schedule();}
    }
    grip.onpointerdown = event => {
        if (event.button !== 0 || drag) return;
        drag = {id: event.pointerId, x: event.clientX, scale};
        grip.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation();
    };
    grip.onpointermove = event => {
        if (!drag || drag.id !== event.pointerId) return;
        scale = Math.max(0.5, Math.min(3, drag.scale + (drag.x - event.clientX) / 370)); schedule();
    };
    grip.onpointerup = event => {if (drag?.id === event.pointerId) stopDrag(true);};
    grip.onpointercancel = () => stopDrag(true);
    grip.onlostpointercapture = () => stopDrag(true);
    grip.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        scale = event.key === 'Home' ? 1 : Math.max(0.5, Math.min(3, scale + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? 0.05 : -0.05)));
        schedule(); persist();
    };
    reset.onclick = () => {scale = 1; schedule(); persist();};
    slider.oninput = () => {opacity = Math.max(30, Math.min(100, Number(slider.value))); schedule(); persist();};
    const resize = window.ResizeObserver ? new window.ResizeObserver(schedule) : null;
    if (resize) resize.observe(panel);
    const mutation = new window.MutationObserver(schedule);
    mutation.observe(panel, {attributes: true, attributeFilter: ['style', 'data-scale', 'data-theme']});
    window.addEventListener('resize', schedule);
    arrange();
    const detach = () => {
        closed = true; stopDrag(false);
        if (frame) window.cancelAnimationFrame(frame);
        if (resize) resize.disconnect(); mutation.disconnect();
        window.removeEventListener('resize', schedule);
        grip.onpointerdown = grip.onpointermove = grip.onpointerup = grip.onpointercancel = grip.onlostpointercapture = grip.onkeydown = null;
        reset.onclick = slider.oninput = null;
        delete panel.dataset.libraryOpen;
        if (borrowed && !movedByUser) for (const [key, val] of Object.entries(original)) panel.style[key] = val;
    };
    detach.setChartOnly = enabled => {
        if (closed || compact === enabled) return;
        stopDrag(true);
        profiles[compact ? 'compact' : 'full'] = {scale, opacity};
        compact = enabled;
        ({scale, opacity} = profiles[compact ? 'compact' : 'full']);
        previousLayout = ''; schedule();
    };
    detach.redraw = () => {previousLayout = ''; schedule();};
    return detach;
}
