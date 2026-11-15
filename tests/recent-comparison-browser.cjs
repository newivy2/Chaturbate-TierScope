const assert = require('node:assert/strict'), path = require('node:path');
const engine = process.env.TIERSCOPE_BROWSER || 'chromium';
const bundle = require('esbuild').buildSync({stdin: {contents: `
import {renderRecentComparison, createRecentComparisonState} from './src/recent-comparison.js';
import {renderMetricStrip} from './src/analysis-metric-view.js';
window.recentFixture = {renderRecentComparison, createRecentComparisonState, renderMetricStrip};`, resolveDir: path.join(__dirname, '..')},
    bundle: true, write: false, format: 'iife', target: 'es2022'}).outputFiles[0].text;

(async () => {
    const browser = await require('playwright')[engine].launch({headless: true, executablePath: process.env.TIERSCOPE_CHROMIUM_PATH,
        args: JSON.parse(process.env.TIERSCOPE_CHROMIUM_ARGS || '[]')});
    try {
        const page = await browser.newPage({viewport: {width: 1050, height: 1100}, timezoneId: 'UTC'}), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(`<style>body{background:#15131e;color:white;font:12px Arial}#view{width:750px;--panel-text:#fff;--panel-muted:#aaa;--panel-divider:#555}canvas{display:block;width:100%;height:200px}.tools-chart-legend{display:flex;flex-wrap:wrap;gap:12px}.tools-series-swatch{display:inline-block;width:15px;border-top:2px solid}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:3px}</style><main id="view" data-theme="dark"></main>`);
        await page.addScriptTag({content: bundle});
        await page.evaluate(() => {
            window.testNow = Date.UTC(2026, 10, 15, 12); Date.now = () => testNow;
            window.readCount = 0; window.failRead = false; window.structuredRead = false; window.partialRead = false; window.fetchCount = 0;
            window.fetch = () => {fetchCount++; throw Error('Comparison must not fetch.');};
            window.activeTimers = new Map(); let timerId = 0;
            window.setInterval = (callback, ms) => {const id = ++timerId; activeTimers.set(id, {callback, ms}); return id;};
            window.clearInterval = id => activeTimers.delete(id);
            const make = (id, room, timestamps, values, startedAt = timestamps[0]) => ({id, lineage: id,
                archive: {room, session: {sessionStartedAt: startedAt, history: {timestamps, breaks: timestamps.map(() => false),
                    total: values, anonymous: values.map(() => 5), red: values.map(value => Math.floor(value / 2))}}}});
            window.savedEntries = Array.from({length: 60}, (_, i) => make('saved_' + i, 'model_' + i,
                [testNow - 7200000 + i * 1000, testNow - 3600000], [i + 10, i + 20]));
            savedEntries.push(make('long', 'long_model', [testNow - 2 * 86400000, testNow - 1800000], [2, 123], testNow - 3 * 86400000));
            savedEntries.push(make('boundary', 'boundary_model', [testNow - 86400000], [77]));
            savedEntries.push(make('old', 'old_model', [testNow - 86400001], [88]));
            savedEntries.push(make('future', 'future_model', [testNow + 3600000], [99]));
            savedEntries.push(make('gap', 'gap_model', [testNow - 86400001, testNow + 3600000], [99, 100]));
            savedEntries.forEach(entry => {entry.records = [{key: 'fixture:' + entry.id, value: JSON.stringify(entry.archive)}];});
            window.sourcesBefore = JSON.stringify(savedEntries);
            window.recentState = recentFixture.createRecentComparisonState(); window.metric = 'room';
            window.renderRecentFixture = state => recentFixture.renderRecentComparison(document.getElementById('view'), {
                state, readEntries() {readCount++; if (failRead) throw Error('test read failure');
                    return structuredRead ? {entries: partialRead ? savedEntries.slice(0, 3) : savedEntries,
                        error: partialRead ? 'test partial read' : ''} : savedEntries;},
                getMetric: () => metric,
                metricControl(parent, changed) {recentFixture.renderMetricStrip(parent,
                    [{key: 'room', label: 'Room audience', color: '#ff69b4'}, {key: 'total', label: 'Registered viewers', color: '#79baff'}],
                    metric, value => {metric = value; changed();}, 'tools-recent-metric');}
            });
            window.recentView = renderRecentFixture(recentState);
            window.tickRecent = ms => {testNow += ms; for (const timer of activeTimers.values()) timer.callback();};
        });
        const report = room => page.locator('#tools-recent-samples [data-recent-room="' + room + '"]');
        const count = room => report(room).locator('td').nth(2).textContent();
        assert.match(await page.locator('#tools-recent-status').textContent(), /62 sessions · 62 models/);
        assert.equal(await page.locator('#tools-recent-samples tbody tr').count(), 25);
        assert.equal(await page.evaluate(() => recentState.entries.length), 62, 'all eligible saved sessions are selected without a cap');
        assert.equal(await page.evaluate(() => JSON.stringify(savedEntries) === sourcesBefore), true);
        assert.equal(await page.evaluate(() => Object.isFrozen(savedEntries[0].archive.session.history.total)), false, 'view never freezes source recordings');
        assert.equal(await page.evaluate(() => Object.isFrozen(recentState.entries[0].archive.session.history.total)), true, 'displayed snapshots are immutable');
        assert.equal(await page.evaluate(() => {
            const before = recentState.entries.slice();
            savedEntries = savedEntries.map(entry => ({...entry, archive: JSON.parse(JSON.stringify(entry.archive))}));
            recentView.refresh(true);
            return recentState.entries.every((entry, index) => entry === before[index]);
        }), true, 'unchanged raw records reuse immutable snapshots after Library reader cache eviction');
        assert.equal(await page.evaluate(() => {
            let entries = recentState.entries; window.entryVisits = 0;
            Object.defineProperty(recentState, 'entries', {get() {entryVisits++; return entries;}, set(value) {entries = value;}});
            for (let i = 0; i < 30; i++) recentView.refresh();
            return entryVisits;
        }), 0, 'unchanged parent status refreshes do not traverse saved samples');
        assert.match(await page.locator('#tools-chart-range').textContent(), /11\/14\/2026.*11\/15\/2026/);
        assert.match(await page.locator('#tools-analysis-chart').getAttribute('aria-label'), /dated|timestamp/);
        assert.equal(await count('model_59'), '84');
        await page.click('#tools-recent-next'); await page.click('#tools-recent-next');
        assert.equal(await page.locator('#tools-recent-samples tbody tr').count(), 12);
        assert.equal(await count('long_model'), '128', 'recording begun days ago contributes its accepted recent sample');
        assert.equal(await report('long_model').locator('td').nth(3).textContent(), '1');
        assert.equal(await report('boundary_model').count(), 1, 'the exact left endpoint is included');
        await page.click('#tools-recent-previous'); await page.click('#tools-recent-previous');

        await page.click('#tools-recent-freeze');
        const frozenWindow = await page.locator('#tools-recent-window').textContent(), reads = await page.evaluate(() => readCount);
        await page.evaluate(() => {
            const source = savedEntries[59];
            source.archive.session.history.total[1] = 900;
            savedEntries[59] = {...source, archive: JSON.parse(JSON.stringify(source.archive))};
            savedEntries[59].records = [{key: 'fixture:' + source.id, value: JSON.stringify(savedEntries[59].archive)}];
            savedEntries.push({id: 'new', archive: {room: 'new_model', session: {history: {timestamps: [testNow + 30000],
                breaks: [false], total: [500], anonymous: [5], red: [100]}}}});
            tickRecent(60000);
        });
        assert.equal(await page.evaluate(() => readCount), reads, 'Freeze stops polling Library data');
        assert.equal(await count('model_59'), '84', 'source changes cannot alter frozen snapshots');
        assert.equal(await page.locator('#tools-recent-window').textContent(), frozenWindow);
        assert(await page.locator('#tools-recent-refresh').isDisabled());
        assert.equal(await page.evaluate(() => {entryVisits = 0; for (let i = 0; i < 30; i++) recentView.refresh(); return entryVisits;}), 0,
            'frozen parent refreshes reuse the cached selection');
        await page.click('#tools-recent-metric-total');
        assert.equal(await count('model_59'), '79', 'metric changes read the same frozen snapshot');
        assert.equal(await page.evaluate(() => readCount), reads);
        await page.click('#tools-recent-freeze');
        assert.match(await page.locator('#tools-recent-status').textContent(), /62 sessions · 62 models/);
        assert.equal(await count('model_59'), '900');
        assert(await page.evaluate(() => recentState.entries.some(entry => entry.archive.room === 'new_model')));
        assert(!(await page.evaluate(() => recentState.entries.some(entry => entry.archive.room === 'boundary_model'))), 'Resume applies the new rolling cutoff');

        await page.evaluate(() => {failRead = true;}); await page.click('#tools-recent-refresh');
        assert.match(await page.locator('#tools-recent-status').textContent(), /previous snapshots are retained.*test read failure/);
        assert.equal(await count('model_59'), '900');
        await page.evaluate(() => {failRead = false;}); await page.click('#tools-recent-refresh');
        assert.doesNotMatch(await page.locator('#tools-recent-status').textContent(), /unavailable/);
        await page.evaluate(() => {structuredRead = true; partialRead = true;}); await page.click('#tools-recent-refresh');
        assert.match(await page.locator('#tools-recent-status').textContent(), /62 sessions.*previous snapshots are retained.*test partial read/);
        assert.equal(await count('model_59'), '900', 'a partial read cannot drop previously displayed sessions');
        await page.evaluate(() => {partialRead = false;}); await page.click('#tools-recent-refresh');
        assert.doesNotMatch(await page.locator('#tools-recent-status').textContent(), /unavailable/);
        const beforeTick = await page.evaluate(() => readCount);
        await page.evaluate(() => tickRecent(10000));
        assert.equal(await page.evaluate(() => readCount), beforeTick + 1, 'open comparison polls saved Library data every ten seconds');
        assert.equal(await page.evaluate(() => fetchCount), 0);
        await page.evaluate(() => recentView.dispose());
        assert.equal(await page.evaluate(() => activeTimers.size), 0, 'Dispose releases polling');
        const afterDispose = await page.evaluate(() => readCount);
        await page.evaluate(() => recentView.refresh(true));
        assert.equal(await page.evaluate(() => readCount), afterDispose);
        await page.evaluate(() => {
            document.getElementById('view').replaceChildren(); partialRead = true;
            recentState = recentFixture.createRecentComparisonState(); recentView = renderRecentFixture(recentState);
        });
        assert.match(await page.locator('#tools-recent-status').textContent(), /3 sessions.*showing healthy recordings only.*test partial read/,
            'an initial partial read displays healthy recordings with a warning');
        await page.evaluate(() => recentView.dispose());
        assert.equal(await page.evaluate(() => activeTimers.size), 0);
        assert.deepEqual(errors, []);
        console.log(engine + ': Last24h includes all saved models and older-start recordings, paginates reports, uses actual dates, freezes immutable data/window, resumes updates, retains snapshots after read errors and releases polling without API calls');
    } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
