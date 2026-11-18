const assert = require('node:assert/strict'), path = require('node:path');
const engine = process.env.TIERSCOPE_BROWSER || 'chromium';
const bundle = require('esbuild').buildSync({stdin: {contents: `
import {renderAnalysisChart} from './src/analysis-chart-view.js';
import {buildLiveModelSeries} from './src/live-model-chart-data.js';
window.chartFixture={renderAnalysisChart,buildLiveModelSeries};`, resolveDir: path.join(__dirname, '..')},
    bundle: true, write: false, format: 'iife', target: 'es2022'}).outputFiles[0].text;
(async () => {
    const browser = await require('playwright')[engine].launch({headless: true, executablePath: process.env.TIERSCOPE_CHROMIUM_PATH,
        args: JSON.parse(process.env.TIERSCOPE_CHROMIUM_ARGS || '[]')});
    try {
        const page = await browser.newPage({viewport: {width: 900, height: 1100}, timezoneId: 'UTC'}), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(`<style>body{background:#15131e;color:white;font:12px Arial}#view{width:500px;--panel-text:#fff;--panel-muted:#aaa;--panel-divider:#555}canvas{display:block;width:100%;height:200px}.tools-actions{display:flex;gap:5px;flex-wrap:wrap}.tools-chart-legend{display:flex;gap:12px}.tools-series-swatch{display:inline-block;width:15px;border-top:2px solid}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:3px}</style><main id="view" data-theme="dark"></main>`);
        await page.addScriptTag({content: bundle});
        await page.evaluate(() => {
            window.strokeLog = [];
            const stroke = CanvasRenderingContext2D.prototype.stroke;
            CanvasRenderingContext2D.prototype.stroke = function(...args) {
                if (Math.abs(this.lineWidth - 1.8) < 0.01) strokeLog.push({alpha: this.globalAlpha, dash: this.getLineDash(), color: this.strokeStyle});
                return stroke.apply(this, args);
            };
            window.now = Date.UTC(2026, 9, 24, 0, 2);
            window.archives = [
                {room: 'alice', session: {history: {timestamps: [now - 180000, now - 60000], breaks: [false, false], total: [40, 60], anonymous: [5, 5]}}},
                {room: 'brenda', session: {history: {timestamps: [now - 120000, now], breaks: [false, false], total: [70, 80], anonymous: [5, 5]}}}
            ];
            const projection = chartFixture.buildLiveModelSeries(archives, 'room', {now, windowMs: 240000});
            window.chartConfig = {originAt: projection.originAt, sourceIds: ['tab-alice', 'tab-brenda'], colorIndices: [0, 1]};
            window.chart = chartFixture.renderAnalysisChart(document.getElementById('view'), projection.series, projection.labels,
                projection.axisMs, 'Room audience', null, 'live', chartConfig);
            window.initialCanvas = chart.canvas;
        });
        assert.deepEqual(await page.locator('.tools-chart-legend label span:last-child').allTextContents(), ['alice', 'brenda']);
        assert.equal(await page.locator('#tools-chart-lines').isVisible(), false, 'small comparisons keep the existing compact controls');
        assert.deepEqual(await page.locator('.tools-series-swatch').evaluateAll(nodes => nodes.map(node => [node.style.borderTopStyle, node.style.opacity])), [['solid', '1'], ['solid', '1']]);
        assert.equal(await page.getByText(/Latest session/).count(), 0);
        const colors = await page.locator('.tools-chart-legend label').evaluateAll(nodes => nodes.map(node => node.style.color));
        assert.notEqual(colors[0], colors[1]);
        assert(await page.evaluate(() => strokeLog.length >= 2 && strokeLog.every(stroke => stroke.alpha === 1 && !stroke.dash.length)));
        assert.match(await page.locator('#tools-chart-range').textContent(), /10\/23\/2026.*10\/24\/2026/);
        const canvas = page.locator('canvas#tools-analysis-chart'); await canvas.focus();
        await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#tools-chart-inspection tbody tr').first().locator('td').first().textContent(), '45');
        assert.match(await page.locator('#tools-chart-inspection caption').textContent(), /10\/23\/2026/);
        await page.keyboard.press('End');
        assert.deepEqual(await page.locator('#tools-chart-inspection tbody tr td:first-of-type').allTextContents(), ['—', '85']);
        assert.match(await page.locator('#tools-chart-inspection tbody tr').first().textContent(), /No accepted sample/);
        await page.keyboard.press('ArrowLeft'); await page.click('#tools-chart-zoom-in');
        await page.uncheck('[data-analysis-series="1"]');
        const before = await page.evaluate(() => {const state = chart.capture(); return {
            cursor: state.originAt + state.cursor, start: state.originAt + state.start, end: state.originAt + state.end};});
        await page.evaluate(() => {
            now += 30000;
            archives[0].session.history.timestamps.push(now); archives[0].session.history.total.push(90); archives[0].session.history.anonymous.push(5); archives[0].session.history.breaks.push(false);
            const projection = chartFixture.buildLiveModelSeries(archives, 'room', {now, windowMs: 240000});
            chartConfig = {...chartConfig, originAt: projection.originAt};
            chart.update(projection.series, projection.axisMs, 'Room audience', 'live', chartConfig);
        });
        const after = await page.evaluate(() => {const state = chart.capture(); return {
            cursor: state.originAt + state.cursor, start: state.originAt + state.start, end: state.originAt + state.end};});
        assert.deepEqual(after, before, 'new samples keep a pinned real timestamp and zoom range');
        assert.equal(await page.evaluate(() => chart.canvas === initialCanvas), true);
        assert.equal(await page.locator('[data-analysis-series="1"]').isChecked(), false);
        assert.deepEqual(await page.locator('.tools-chart-legend label').evaluateAll(nodes => nodes.map(node => node.style.color)), colors);
        await page.evaluate(() => {document.getElementById('view').dataset.theme = 'bright'; chart.draw();});
        const brightColors = await page.locator('.tools-chart-legend label').evaluateAll(nodes => nodes.map(node => node.style.color));
        assert.notDeepEqual(brightColors, colors); assert.notEqual(brightColors[0], brightColors[1]);
        await page.evaluate(() => {
            window.mountExpanded = (count, mode = 'elapsed', shadow = false, seriesStyles = null) => {
                chart.dispose(); const host = document.getElementById('view'); host.replaceChildren(); host.dataset.theme = 'dark';
                window.largeSeries = Array.from({length: count}, (_, index) => ({times: [0, 60000], values: shadow ?
                    (index < 30 ? [20, 20] : [8, 8]) : [20 + index, 21 + index], breaks: [false, false],
                    timestamps: mode === 'timeline' ? [now - 60000, now] : [now - index * 1000, now + 60000 - index * 1000]}));
                const labels = largeSeries.map((_, index) => 'model_' + index + ' · saved session');
                const config = {originAt: now - 60000, sourceIds: labels, colorIndices: labels.map((_, index) => index),
                    ...(mode === 'timeline' ? {rankTimes: labels.map((_, index) => now - 1000000 + index * 1000)} : {}),
                    ...(seriesStyles ? {seriesStyles} : {})};
                window.expandedConfig = config;
                window.strokeLog = [];
                chart = chartFixture.renderAnalysisChart(host, largeSeries, labels, 60000, 'Room audience', null, mode, config);
            };
        });
        await page.evaluate(() => mountExpanded(60));
        assert.equal(await page.locator('.tools-chart-legend label').count(), 30);
        assert.equal(await page.locator('#tools-chart-inspection tbody tr').count(), 30);
        assert.match(await page.locator('#tools-chart-lines-status').textContent(), /Lines 1–30 of 60/);
        const savedStyles = await page.locator('.tools-chart-legend label').evaluateAll(nodes => nodes.map(node => ({
            color: node.style.color, alpha: Number(node.querySelector('.tools-series-swatch').style.opacity)})));
        assert.equal(new Set(savedStyles.map(style => style.color)).size, 30, 'the newest thirty saved sessions have distinct colors');
        savedStyles.forEach((style, rank) => assert(Math.abs(style.alpha - (1 - rank * 0.55 / 29)) < 1e-6,
            'all thirty colored sessions fade evenly by age'));
        assert(await page.locator('.tools-series-swatch').evaluateAll(nodes => nodes.every(node => node.style.borderTopStyle === 'dashed')),
            'saved snapshots use dashed strokes, including the newest');
        const savedStrokes = await page.evaluate(() => strokeLog);
        assert.equal(savedStrokes.length, 30, 'the canvas draws exactly thirty individual foreground strokes');
        assert.equal(new Set(savedStrokes.map(stroke => stroke.color)).size, 30, 'the actual foreground strokes have thirty distinct colors');
        assert(savedStrokes.every(stroke => stroke.dash.length > 0), 'the actual saved strokes are dashed');
        savedStrokes.forEach((stroke, position) => assert(Math.abs(stroke.alpha - (1 - (29 - position) * 0.55 / 29)) < 1e-6));
        await page.click('#tools-chart-lines-next');
        assert.match(await page.locator('#tools-chart-lines-status').textContent(), /Lines 31–60 of 60/);
        const backgroundStyles = await page.locator('.tools-chart-legend label').evaluateAll(nodes => nodes.map(node => ({
            color: node.style.color, alpha: Number(node.querySelector('.tools-series-swatch').style.opacity),
            dash: node.querySelector('.tools-series-swatch').style.borderTopStyle})));
        assert(backgroundStyles.every(style => style.alpha === 0.12 && style.color === 'rgb(170, 170, 170)' && style.dash === 'dashed'),
            'gray dashed history begins with session thirty-one');
        assert.equal(await page.locator('[data-analysis-series="59"]').count(), 1);
        await page.fill('#tools-chart-line-search', 'model_59');
        assert.equal(await page.locator('.tools-chart-legend label').count(), 1);
        assert.equal(await page.locator('#tools-chart-inspection tbody tr').count(), 1);
        assert.equal(await page.locator('#tools-chart-inspection tbody tr td').first().textContent(), '79');
        assert.match(await page.locator('#tools-chart-lines-status').textContent(), /1 matching \/ 60 total/);
        await page.uncheck('[data-analysis-series="59"]');
        assert.equal(await page.locator('#tools-chart-inspection tbody tr:visible').count(), 0);
        await page.fill('#tools-chart-line-search', ''); await page.click('#tools-chart-lines-next');
        assert.equal(await page.locator('[data-analysis-series="59"]').isChecked(), false);
        await page.check('[data-analysis-series="59"]'); await canvas.focus(); await page.keyboard.press('End'); await page.click('#tools-chart-zoom-in');
        const pagedState = await page.evaluate(() => chart.capture());
        await page.evaluate(() => chart.update(largeSeries.map(series => ({...series, values: series.values.map(value => value + 1)})), 60000, 'Registered viewers'));
        assert.equal(await page.evaluate(() => chart.capture().linePage), 1);
        assert.equal(await page.evaluate(() => chart.capture().cursor), pagedState.cursor);
        assert.equal(await page.evaluate(() => chart.capture().start), pagedState.start);
        await page.evaluate(() => mountExpanded(60, 'timeline'));
        await page.fill('#tools-chart-line-search', 'model_59');
        assert.equal(await page.locator('.tools-series-swatch').evaluate(node => node.style.opacity), '1', 'original dates own rolling-window ranks');
        assert.equal(await page.locator('.tools-series-swatch').evaluate(node => node.style.borderTopStyle), 'dashed');
        assert.match(await page.locator('#tools-chart-range').textContent(), /10\/24\/2026/);
        await page.fill('#tools-chart-line-search', 'model_0 ·');
        assert.equal(await page.locator('.tools-series-swatch').evaluate(node => node.style.opacity), '0.12');
        assert.equal(await page.locator('.tools-chart-legend label').evaluate(node => node.style.color), 'rgb(170, 170, 170)');
        const shadow = async count => page.evaluate(count => {
            window.composites = [];
            if (!window.compositeHook) {
                window.compositeHook = true; const drawImage = CanvasRenderingContext2D.prototype.drawImage;
                CanvasRenderingContext2D.prototype.drawImage = function(...args) {
                    if (this.globalAlpha > 0 && this.globalAlpha < 1) composites.push(this.globalAlpha);
                    return drawImage.apply(this, args);
                };
            }
            mountExpanded(count, 'elapsed', true);
            const pixels = chart.canvas.getContext('2d').getImageData(120, 102, 20, 6).data;
            let alpha = 0; for (let i = 3; i < pixels.length; i += 4) alpha = Math.max(alpha, pixels[i]);
            return {alpha, composites};
        }, count);
        const singleShadow = await shadow(31), crowdedShadow = await shadow(130);
        assert.deepEqual(crowdedShadow.composites.map(alpha => Math.round(alpha * 100)), [12]);
        assert(crowdedShadow.alpha >= 20 && crowdedShadow.alpha <= 32, '100 older overlapping traces stay within a single 12% layer: ' + crowdedShadow.alpha);
        assert(Math.abs(crowdedShadow.alpha - singleShadow.alpha) <= 4, 'adding 99 coincident traces does not darken the background');
        await page.evaluate(() => mountExpanded(40, 'live'));
        assert.equal(await page.locator('.tools-chart-legend label').count(), 30);
        assert.match(await page.locator('#tools-chart-lines-status').textContent(), /of 40/);
        assert.equal(await page.evaluate(() => new Set(strokeLog.map(stroke => stroke.color)).size), 40, 'all 40 live models use distinct drawn colors');
        assert(await page.evaluate(() => strokeLog.length === 40 && strokeLog.every(stroke => stroke.alpha === 1 && !stroke.dash.length)));
        await page.fill('#tools-chart-line-search', 'model_39');
        assert.equal(await page.locator('[data-analysis-series="39"]').count(), 1);
        assert.equal(await page.locator('#tools-chart-inspection tbody tr td').first().textContent(), '59');
        assert.equal(await page.locator('.tools-series-swatch').evaluate(node => node.style.opacity), '1');
        await page.evaluate(() => mountExpanded(40, 'live', false,
            Array.from({length: 40}, (_, index) => index === 0 ? {primary: true, live: true} : index === 1 ? {live: true} : {})));
        const mixedLine = index => page.locator('.tools-chart-legend label').filter({has: page.locator('[data-analysis-series="' + index + '"]')});
        for (const index of [0, 1]) {
            assert.equal(await mixedLine(index).locator('.tools-series-swatch').evaluate(node => node.style.borderTopStyle), 'solid');
            assert.equal(await mixedLine(index).locator('.tools-series-swatch').evaluate(node => node.style.opacity), '1');
        }
        for (const index of [2, 3]) assert.equal(await mixedLine(index).locator('.tools-series-swatch').evaluate(node => node.style.borderTopStyle), 'dashed',
            'stopped or stale traces on a Live axis use dashed strokes');
        const mixedStrokes = await page.evaluate(() => strokeLog);
        assert.equal(mixedStrokes.filter(stroke => !stroke.dash.length).length, 2,
            'actual Live canvas strokes remain solid only for ongoing sources');
        assert(mixedStrokes.filter(stroke => !stroke.dash.length).every(stroke => stroke.alpha === 1));
        await page.evaluate(() => {
            window.styleFlags = Array.from({length: 60}, (_, index) => index === 0 ? {primary: true, live: true} : index === 1 ? {live: true} : {});
            mountExpanded(60, 'timeline', false, styleFlags); window.styledCanvas = chart.canvas;
        });
        const line = index => page.locator('.tools-chart-legend label').filter({has: page.locator('[data-analysis-series="' + index + '"]')});
        const swatch = index => line(index).locator('.tools-series-swatch');
        assert.equal(await swatch(0).evaluate(node => node.style.borderTopStyle), 'solid');
        assert.equal(await swatch(0).evaluate(node => node.style.opacity), '1', 'the current session stays opaque even beyond the newest thirty');
        assert.equal(await line(0).evaluate(node => node.style.color), 'rgb(255, 105, 180)');
        assert.match(await line(0).getAttribute('title'), /Current tracked session — solid pink/);
        assert.match(await line(0).textContent(), /Current/);
        assert.equal(await swatch(1).evaluate(node => node.style.borderTopStyle), 'solid');
        assert.equal(await swatch(1).evaluate(node => node.style.opacity), '1', 'other tracked old sessions are promoted out of the shadow layer');
        assert.match(await line(1).getAttribute('title'), /Currently tracked session/);
        assert.notEqual(await line(1).evaluate(node => node.style.color), 'rgb(255, 105, 180)');
        assert.equal(await swatch(2).evaluate(node => node.style.borderTopStyle), 'dashed');
        assert.equal(await swatch(2).evaluate(node => node.style.opacity), '0.12');
        const commands = await page.evaluate(() => strokeLog);
        assert.equal(commands.filter(command => !command.dash.length).length, 2, 'real canvas commands use solid strokes only for tracked sessions');
        assert(commands.filter(command => !command.dash.length).every(command => command.alpha === 1));
        assert.equal(commands.at(-1).color, '#ff69b4', 'the current session paints last, above newer historical sessions');
        assert.deepEqual(commands.at(-1).dash, []);
        await page.fill('#tools-chart-line-search', 'model_59');
        assert.equal(await swatch(59).evaluate(node => node.style.borderTopStyle), 'dashed', 'a newer historical session cannot acquire the current-session style');
        assert.equal(await swatch(59).evaluate(node => node.style.opacity), '1');
        assert.match(await line(59).getAttribute('title'), /Historical session — dashed/);
        assert.notEqual(await line(59).evaluate(node => node.style.color), 'rgb(255, 105, 180)');
        await page.fill('#tools-chart-line-search', 'model_5 ·'); await page.uncheck('[data-analysis-series="5"]');
        await canvas.focus(); await page.keyboard.press('End'); await page.click('#tools-chart-zoom-in');
        const styledState = await page.evaluate(() => chart.capture());
        await page.evaluate(() => {
            const changedStyles = Array.from({length: 60}, (_, index) => index === 2 ? {primary: true} : index === 3 ? {live: true} : {});
            strokeLog = []; chart.update(largeSeries, 60000, 'Room audience', 'timeline', {...expandedConfig, seriesStyles: changedStyles});
        });
        assert.deepEqual(await page.evaluate(() => chart.capture()), styledState, 'style updates preserve zoom, pin, hidden lines and line search');
        assert(await page.evaluate(() => chart.canvas === styledCanvas));
        assert.equal(await page.locator('[data-analysis-series="5"]').isChecked(), false);
        assert.equal(await page.evaluate(() => strokeLog.at(-1).color), '#ff69b4');
        await page.fill('#tools-chart-line-search', '');
        assert.equal(await swatch(0).evaluate(node => node.style.borderTopStyle), 'dashed');
        assert.equal(await swatch(0).evaluate(node => node.style.opacity), '0.12', 'a source no longer tracked returns to its historical shadow style');
        assert.equal(await swatch(1).evaluate(node => node.style.borderTopStyle), 'dashed');
        assert.equal(await swatch(2).evaluate(node => node.style.borderTopStyle), 'solid');
        assert.equal(await line(2).evaluate(node => node.style.color), 'rgb(255, 105, 180)');
        assert.match(await line(2).getAttribute('title'), /Current tracked session/);
        assert.equal(await swatch(3).evaluate(node => node.style.borderTopStyle), 'solid');
        await page.evaluate(() => {document.getElementById('view').dataset.theme = 'bright'; chart.draw();});
        assert.equal(await line(2).evaluate(node => node.style.color), 'rgb(180, 35, 112)');
        await page.evaluate(() => {
            const {seriesStyles, ...ordinary} = expandedConfig;
            document.getElementById('view').dataset.theme = 'dark'; chart.update(largeSeries, 60000, 'Room audience', 'timeline', ordinary);
        });
        await page.fill('#tools-chart-line-search', 'model_59');
        assert.equal(await swatch(59).evaluate(node => node.style.borderTopStyle), 'dashed', 'a newest saved snapshot remains historical without ongoing tracking metadata');
        assert.equal(await line(59).evaluate(node => node.style.color), 'rgb(255, 105, 180)');
        assert.deepEqual(errors, []); await page.close();
        console.log(engine + ': live/timeline real-date alignment, large comparisons, gray shadows and dynamic tracked/current styling with preserved pinned zoom/visibility passed');
    } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
