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
                archive: {room, session: {sessionStartedAt: startedAt, sessionStartEstimated: false, timestamp: testNow,
                    roomTotalHigh: Math.max(...values) + 5, sessionHighs: {total: {value: Math.max(...values)}, anonymous: {value: 5}, red: {value: Math.max(...values.map(value => Math.floor(value / 2))) }},
                    history: {timestamps, breaks: timestamps.map(() => false),
                    total: values, anonymous: values.map(() => 5), red: values.map(value => Math.floor(value / 2))}}}});
            window.makeRecentEntry = make;
            window.tokenRecentEntry = entry => {entry.records = [{key: 'fixture:' + entry.id, value: JSON.stringify(entry.archive)}]; return entry;};
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

        // Visibility and the selected date range belong to the recording, not
        // its current legend index or an automatically replaced storage key.
        await page.evaluate(() => {
            document.getElementById('view').replaceChildren(); failRead = partialRead = structuredRead = false; metric = 'room';
            savedEntries = Array.from({length: 62}, (_, index) => {
                const entry = makeRecentEntry('visibility_' + index, 'visibility_model_' + String(index).padStart(2, '0'),
                    index ? [testNow - 7200000 + index * 1000, testNow - 3600000] : [testNow - 86400000 + 5000],
                    index ? [index + 10, index + 20] : [50]);
                entry.lineage = 'visibility_lineage_' + index; return tokenRecentEntry(entry);
            });
            recentState = recentFixture.createRecentComparisonState(); recentView = renderRecentFixture(recentState);
        });
        async function line(id) {
            const index = await page.evaluate(id => recentState.chartIds.indexOf(id), id); assert(index >= 0, 'record remains eligible: ' + id);
            if (await page.locator('#tools-chart-line-search').isVisible()) {
                await page.fill('#tools-chart-line-search', '');
                while (await page.locator('#tools-chart-lines-previous').isEnabled()) await page.click('#tools-chart-lines-previous');
                for (let at = 0; at < Math.floor(index / 30); at++) await page.click('#tools-chart-lines-next');
            }
            return page.locator('.tools-chart-legend input[data-analysis-series="' + index + '"]');
        }
        const target = 'visibility_7';
        assert(await page.evaluate(id => recentState.chartIds.indexOf(id) >= 30, target), 'hidden target starts after the first legend page');
        await (await line(target)).uncheck();
        const canvas = page.locator('#tools-analysis-chart'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
        await page.mouse.move(box.x + 52 + (box.width - 66) * .8, box.y + 60); await page.mouse.down();
        await page.mouse.move(box.x + 52 + (box.width - 66) * .98, box.y + 60, {steps: 4}); await page.mouse.up();
        await canvas.focus(); await page.keyboard.press('End');
        const selectedRange = await page.locator('#tools-chart-range').textContent(), selectedCursor = await page.locator('#tools-chart-inspection caption').textContent();
        async function retainsSelection(id, reason) {
            assert.equal(await (await line(id)).isChecked(), false, reason + ': the unchecked recording stays hidden');
            assert.equal(await page.locator('#tools-chart-range').textContent(), selectedRange, reason + ': selected absolute date range stays fixed');
            assert.equal(await page.locator('#tools-chart-inspection caption').textContent(), selectedCursor, reason + ': pinned absolute cursor stays fixed');
        }
        await page.evaluate(() => {
            savedEntries.push(tokenRecentEntry(makeRecentEntry('visibility_new', 'visibility_new_model', [testNow - 30000, testNow], [100, 120])));
            recentView.refresh(true);
        });
        await retainsSelection(target, 'new eligible recording');
        assert(await (await line('visibility_8')).isChecked(), 'a neighboring line does not inherit the old index’s hidden state');
        await page.evaluate(() => tickRecent(70000));
        assert(!(await page.evaluate(() => recentState.chartIds.includes('visibility_0'))), 'the only boundary recording expires');
        await retainsSelection(target, 'rolling-window expiry');
        await page.evaluate(() => {
            const index = savedEntries.findIndex(entry => entry.id === 'visibility_20'), previous = savedEntries[index];
            const replacement = makeRecentEntry(previous.id, previous.archive.room, [testNow - 30000, testNow], [30, 40]);
            replacement.lineage = previous.lineage; savedEntries[index] = tokenRecentEntry(replacement); recentView.refresh(true);
        });
        await retainsSelection(target, 'recording reorder');
        await page.evaluate(() => {
            const index = savedEntries.findIndex(entry => entry.id === 'visibility_7'), previous = savedEntries[index];
            const times = [...previous.archive.session.history.timestamps, testNow], values = [...previous.archive.session.history.total, 80];
            const replacement = makeRecentEntry('visibility_auto_7', previous.archive.room, times, values, previous.archive.session.sessionStartedAt);
            replacement.lineage = previous.lineage; savedEntries[index] = tokenRecentEntry(replacement); recentView.refresh(true);
        });
        await retainsSelection('visibility_auto_7', 'compatible automatic keep with a new storage ID');
        await page.click('#tools-recent-metric-total'); await retainsSelection('visibility_auto_7', 'metric change');
        await page.click('#tools-recent-freeze');
        await page.evaluate(() => {
            savedEntries.push(tokenRecentEntry(makeRecentEntry('visibility_frozen', 'visibility_frozen_model', [testNow + 30000], [200])));
            tickRecent(60000);
        });
        await retainsSelection('visibility_auto_7', 'frozen update');
        await page.click('#tools-recent-freeze'); await retainsSelection('visibility_auto_7', 'Resume membership update');
        await page.evaluate(() => {recentView.dispose(); document.getElementById('view').replaceChildren(); recentView = renderRecentFixture(recentState);});
        await retainsSelection('visibility_auto_7', 'view disposal and recreation');
        await page.evaluate(() => {
            const previous = savedEntries.find(entry => entry.id === 'visibility_auto_7'), session = previous.archive.session;
            const values = session.history.total.slice(); values[0] += 1000;
            const conflict = makeRecentEntry('visibility_conflict_7', previous.archive.room, session.history.timestamps.slice(), values, session.sessionStartedAt);
            conflict.lineage = previous.lineage; savedEntries.push(tokenRecentEntry(conflict)); recentView.refresh(true);
        });
        await retainsSelection('visibility_auto_7', 'conflicting same-lineage sibling');
        assert(await (await line('visibility_conflict_7')).isChecked(), 'a conflicting same-lineage recording keeps its independent default visibility');
        await (await line('visibility_8')).uncheck();
        await page.evaluate(() => {
            const index = savedEntries.findIndex(entry => entry.id === 'visibility_8'), previous = savedEntries[index], session = previous.archive.session;
            const values = session.history.total.slice(); values[0] += 2000;
            const conflict = makeRecentEntry('visibility_conflict_8', previous.archive.room, session.history.timestamps.slice(), values, session.sessionStartedAt);
            conflict.lineage = previous.lineage; savedEntries[index] = tokenRecentEntry(conflict); recentView.refresh(true);
        });
        assert(await (await line('visibility_conflict_8')).isChecked(), 'incompatible replacement cannot inherit another recording’s hidden preference');
        await page.fill('#tools-chart-line-search', 'visibility_model_07');
        await page.evaluate(() => {
            savedEntries = savedEntries.filter(entry => ['visibility_auto_7', 'visibility_conflict_7'].includes(entry.id));
            recentView.refresh(true);
        });
        assert(await page.locator('#tools-chart-line-search').isVisible(), 'a retained search remains editable after shrinking below thirty sessions');
        assert.equal(await page.locator('#tools-chart-line-search').inputValue(), 'visibility_model_07');
        const remainingHiddenIndex = await page.evaluate(() => recentState.chartIds.indexOf('visibility_auto_7'));
        assert.equal(await page.locator('.tools-chart-legend input[data-analysis-series="' + remainingHiddenIndex + '"]').isChecked(), false);
        await page.fill('#tools-chart-line-search', '');
        assert.equal(await page.locator('.tools-chart-legend label').count(), 2, 'clearing the retained search exposes both remaining recording controls');
        await recentViewDispose();

        // Expiry must not resurrect hidden lines when the only visible source leaves.
        await page.evaluate(() => {
            document.getElementById('view').replaceChildren(); metric = 'room';
            savedEntries = [
                tokenRecentEntry(makeRecentEntry('hidden_one', 'hidden_one_model', [testNow - 7200000, testNow - 3600000], [10, 20])),
                tokenRecentEntry(makeRecentEntry('hidden_two', 'hidden_two_model', [testNow - 7200000, testNow - 3600000], [30, 40])),
                tokenRecentEntry(makeRecentEntry('visible_expiring', 'visible_expiring_model', [testNow - 86400000 + 5000], [50]))
            ];
            recentState = recentFixture.createRecentComparisonState(); recentView = renderRecentFixture(recentState);
        });
        await (await line('hidden_one')).uncheck(); await (await line('hidden_two')).uncheck();
        await page.evaluate(() => tickRecent(40000));
        assert.equal(await (await line('hidden_one')).isChecked(), false); assert.equal(await (await line('hidden_two')).isChecked(), false);
        assert.equal(await page.locator('#tools-chart-inspection tbody tr:visible').count(), 0, 'all remaining lines may stay hidden after expiry');
        await recentViewDispose();
        async function recentViewDispose() {await page.evaluate(() => recentView.dispose()); assert.equal(await page.evaluate(() => activeTimers.size), 0);}
        assert.equal(await page.evaluate(() => fetchCount), 0, 'selection reconciliation never adds API requests');
        assert.deepEqual(errors, []);
        console.log(engine + ': Last24h global selection, frozen immutable snapshots, read-error retention and cleanup; hidden recording identity and absolute zoom/cursor survive new entries, expiry, reorder, compatible Auto replacements, metrics, Freeze/Resume and recreated views; conflicting lineages stay independent');
    } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
