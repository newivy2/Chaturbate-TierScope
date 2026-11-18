const test = require('node:test'), assert = require('node:assert/strict');

function archive(room, timestamps, values, breaks = timestamps.map(() => false)) {
    return {room, session: {history: {timestamps, breaks, total: values, anonymous: values.map(() => 5),
        withTokens: values.map(value => Math.floor(value / 2)), red: values.map(() => 1)}}};
}

test('replacing any selected live model reuses its free color without changing other visible models', async () => {
    const {allocateLiveModelColors} = await import('../src/live-model-chart-data.js');
    const rooms = Array.from({length: 12}, (_, index) => 'model_' + index);
    const initial = allocateLiveModelColors(rooms);
    assert.equal(new Set(initial.values()).size, 12);
    for (const removed of [0, 5, 11]) {
        const selected = rooms.filter((_, index) => index !== removed).concat('new_model');
        const next = allocateLiveModelColors(selected, initial);
        assert.equal(next.size, 12); assert.equal(new Set(next.values()).size, 12);
        for (const room of selected.filter(room => room !== 'new_model')) assert.equal(next.get(room), initial.get(room));
        assert.equal(next.get('new_model'), initial.get(rooms[removed]), 'the newcomer uses the vacated color');
        assert.equal(next.has(rooms[removed]), false);
        assert.deepEqual([...initial.keys()], rooms, 'earlier selections remain unchanged');
    }
    assert.equal(allocateLiveModelColors(['alice', 'alice']).size, 1);
    assert.equal(allocateLiveModelColors([], initial).size, 0);
    assert.equal(allocateLiveModelColors([...rooms, 'thirteenth']).size, 13);
    assert.throws(() => allocateLiveModelColors(['']), /named models/);
    const repaired = allocateLiveModelColors(['alice', 'brenda', 'charlie'], new Map([['alice', 3], ['brenda', 3], ['charlie', 99]]));
    assert.equal(repaired.get('alice'), 3); assert.equal(new Set(repaired.values()).size, 3);
});

test('large live selections retain distinct stable slots and colors beyond thirty', async () => {
    const {allocateLiveModelColors} = await import('../src/live-model-chart-data.js');
    const {comparisonLineColor} = await import('../src/analysis-chart-data.js');
    const rooms = Array.from({length: 1000}, (_, index) => 'model_' + index), initial = allocateLiveModelColors(rooms);
    assert.equal(initial.size, 1000); assert.equal(new Set(initial.values()).size, 1000);
    const changed = rooms.filter((_, index) => index % 3 !== 0).concat('new_model'), next = allocateLiveModelColors(changed, initial);
    assert.equal(next.size, changed.length); assert.equal(new Set(next.values()).size, changed.length);
    for (const room of changed) if (room !== 'new_model') assert.equal(next.get(room), initial.get(room));
    for (const dark of [true, false]) {
        const colors = [...initial.values()].map(index => comparisonLineColor(index, dark));
        assert.equal(new Set(colors).size, 1000, 'generated colors never wrap to another assigned slot');
        assert.equal(new Set(colors.slice(0, 30)).size, 30, 'the first thirty slots are distinct');
        for (const color of colors.slice(0, 30)) {
            if (color.startsWith('#')) {
                const channels = color.slice(1).match(/../g).map(channel => parseInt(channel, 16));
                assert(new Set(channels).size > 1, 'foreground palette slots are chromatic: ' + color);
            } else {
                assert.match(color, /^hsl\(/);
                assert(Number(color.split(' ')[1].replace('%', '')) > 0, 'generated foreground colors have saturation');
            }
        }
        assert.notEqual(colors[0], colors[12]); assert.notEqual(colors[12], colors[24]);
        assert.match(colors[30], /^hsl\(/);
    }
    assert.equal(comparisonLineColor(0), '#ff69b4'); assert.equal(comparisonLineColor(1, false), '#175db0');
});

test('the selected current room owns pink regardless of alphabetical or selection order', async () => {
    const {allocateLiveModelColors} = await import('../src/live-model-chart-data.js');
    const rooms = ['alice', 'brenda', 'zoe'], previous = allocateLiveModelColors(rooms), before = [...previous];
    assert.equal(previous.get('alice'), 0);
    const primary = allocateLiveModelColors(rooms, previous, 'ZOE');
    assert.equal(primary.get('zoe'), 0, 'primary matching is case-insensitive');
    assert.equal(primary.get('brenda'), previous.get('brenda'), 'unrelated existing colors remain stable');
    assert.notEqual(primary.get('alice'), 0, 'the earlier pink occupant releases the reserved slot');
    assert.equal(new Set(primary.values()).size, rooms.length);
    assert.deepEqual([...previous], before, 'reserving pink never mutates earlier allocations');
    const reordered = allocateLiveModelColors(['zoe', 'alice', 'brenda'], primary, 'zoe');
    for (const room of rooms) assert.equal(reordered.get(room), primary.get(room));
});

test('a current room joining or returning reclaims pink without recoloring unrelated models', async () => {
    const {allocateLiveModelColors} = await import('../src/live-model-chart-data.js');
    const initial = allocateLiveModelColors(['alice', 'brenda', 'charlie']);
    const joined = allocateLiveModelColors(['alice', 'brenda', 'charlie', 'zoe'], initial, 'zoe');
    assert.equal(joined.get('zoe'), 0);
    for (const room of ['brenda', 'charlie']) assert.equal(joined.get(room), initial.get(room));
    const without = allocateLiveModelColors(['alice', 'brenda', 'charlie', 'new_model'], joined, 'zoe');
    assert.equal(without.get('new_model'), 0, 'an unselected primary does not reserve an unused color');
    const returned = allocateLiveModelColors(['new_model', 'zoe', 'charlie', 'brenda', 'alice'], without, 'Zoe');
    assert.equal(returned.get('zoe'), 0); assert.notEqual(returned.get('new_model'), 0);
    for (const room of ['alice', 'brenda', 'charlie']) assert.equal(returned.get(room), without.get(room));
    assert.equal(new Set(returned.values()).size, returned.size);
    assert.deepEqual([...allocateLiveModelColors(['alice', 'brenda'], initial, 'unselected')],
        [...allocateLiveModelColors(['alice', 'brenda'], initial)], 'an absent primary preserves existing behavior');
});

test('saved comparison ranks scale to many models and honor original dates after rolling-window clipping', async () => {
    const {comparisonSeriesOrder, comparisonOpacity} = await import('../src/analysis-chart-data.js');
    const series = Array.from({length: 10000}, () => ({timestamps: [100000], times: [0], values: [1], breaks: [false]}));
    const originalTimes = series.map((_, index) => 50000 + index), {newestFirst, ranks} = comparisonSeriesOrder(series, originalTimes);
    assert.equal(newestFirst.length, 10000); assert.equal(newestFirst[0], 9999); assert.equal(newestFirst.at(-1), 0);
    assert.equal(ranks[9999], 0); assert.equal(ranks[0], 9999);
    const foreground = Array.from({length: 30}, (_, rank) => comparisonOpacity(rank));
    assert.equal(foreground[0], 1); assert.equal(foreground[29], 0.45);
    foreground.forEach((alpha, rank) => {
        assert(Math.abs(alpha - (1 - rank * 0.55 / 29)) < 1e-12, 'all thirty foreground ranks fade evenly');
        assert(alpha >= 0.45 && alpha <= 1);
        if (rank) assert(alpha < foreground[rank - 1], 'older foreground sessions are progressively more transparent');
    });
    assert.equal(comparisonOpacity(ranks[9970]), 0.45, 'the thirtieth session remains a foreground color');
    assert.equal(comparisonOpacity(ranks[9969]), 0.12, 'gray begins with the thirty-first session');
    assert.equal(comparisonOpacity(ranks[0]), 0.12);
});

test('live models align the same instant rather than their individual session starts', async () => {
    const {buildLiveModelSeries} = await import('../src/live-model-chart-data.js');
    const now = Date.UTC(2026, 9, 24, 12, 10), first = now - 120000;
    const a = archive('alice', [first, now], [20, 30]), b = archive('brenda', [first + 60000, now], [50, 60]);
    const result = buildLiveModelSeries([a, b], 'room', {now, windowMs: Infinity});
    assert.equal(result.originAt, first); assert.equal(result.axisMs, 120000);
    assert.deepEqual(result.series[0].times, [0, 120000]); assert.deepEqual(result.series[1].times, [60000, 120000]);
    assert.deepEqual(result.series[0].values, [25, 35]); assert.deepEqual(result.labels, ['alice', 'brenda']);
    assert.deepEqual(buildLiveModelSeries([a], 'withTokens', {now}).series[0].values, [10, 15]);
    assert.equal(a.session.history.timestamps[0], first, 'projection does not alter captured histories');
});

test('live midnight and multi-day samples keep their real chronological positions', async () => {
    const {buildLiveModelSeries} = await import('../src/live-model-chart-data.js');
    const first = Date.UTC(2026, 9, 23, 23, 59), midnight = first + 60000, nextDay = midnight + 86400000;
    const result = buildLiveModelSeries([archive('alice', [first, midnight, nextDay], [1, 2, 3])], 'total', {now: nextDay, windowMs: Infinity});
    assert.deepEqual(result.series[0].times, [0, 60000, 86460000]);
    assert.deepEqual(result.series[0].timestamps, [first, midnight, nextDay]);
    assert.equal(result.axisMs, 86460000);
});

test('live inspection and plotting preserve gaps and never extend the last accepted sample', async () => {
    const {buildLiveModelSeries} = await import('../src/live-model-chart-data.js');
    const {inspectAnalysisSample, buildAnalysisPlot} = await import('../src/analysis-chart-data.js');
    const originAt = Date.UTC(2026, 9, 24, 12), now = originAt + 240000;
    const result = buildLiveModelSeries([archive('alice', [originAt, originAt + 60000, originAt + 180000], [20, 30, 40], [false, false, true])],
        'total', {now, windowMs: Infinity});
    const [series] = result.series;
    assert.equal(inspectAnalysisSample(series, 30000).value, 20, 'a covered interval retains the accepted sample');
    assert.equal(inspectAnalysisSample(series, 120000).kind, 'gap');
    assert.equal(inspectAnalysisSample(series, 180001).kind, 'outside');
    const plot = buildAnalysisPlot(series, 0, result.axisMs, 500);
    assert.equal(plot.points.at(-1).time, 180000);
    assert.equal(plot.points.at(-1).move, true, 'the post-gap sample starts a new path');
    assert.equal(plot.points.some(point => point.time === now - originAt), false);
});

test('recent live windows retain one valid predecessor but no invented endpoint', async () => {
    const {buildLiveModelSeries} = await import('../src/live-model-chart-data.js');
    const {inspectAnalysisSample, buildAnalysisPlot} = await import('../src/analysis-chart-data.js');
    const now = Date.UTC(2026, 9, 24, 12, 10);
    const source = archive('alice', [now - 600000, now - 120000, now - 60000], [10, 20, 30]);
    const result = buildLiveModelSeries([source], 'total', {now, windowMs: 90000});
    assert.equal(result.originAt, now - 90000); assert.equal(result.axisMs, 90000);
    assert.deepEqual(result.series[0].times, [-30000, 30000]);
    assert.equal(inspectAnalysisSample(result.series[0], 0).value, 20);
    assert.equal(inspectAnalysisSample(result.series[0], 30001).kind, 'outside');
    const oldOnly = buildLiveModelSeries([archive('old', [now - 600000], [90])], 'total', {now, windowMs: 90000});
    assert.deepEqual(buildAnalysisPlot(oldOnly.series[0], 0, oldOnly.axisMs, 500).points, []);
});

test('clock discontinuities and future or invalid samples cannot fabricate live connections', async () => {
    const {buildLiveModelSeries} = await import('../src/live-model-chart-data.js');
    const now = Date.UTC(2026, 9, 24, 12, 10), start = now - 120000;
    const data = archive('alice', [start, start + 60000, start + 10000, now, now + 60000], [1, 2, 99, 3, 999]);
    const result = buildLiveModelSeries([data], 'total', {now, windowMs: Infinity});
    assert.deepEqual(result.series[0].timestamps, [start, start + 60000, now]);
    assert.deepEqual(result.series[0].breaks, [false, false, true]);
    assert.equal(result.excludedSamples, 2);
    assert.throws(() => buildLiveModelSeries([data], 'made-up', {now}), /Unknown analysis metric/);
    for (const options of [{now: NaN}, {now: -1}, {now, windowMs: 0}, {now, windowMs: -100}, {now, originAt: now + 1}]) {
        assert.throws(() => buildLiveModelSeries([data], 'total', options), /Invalid live comparison/);
    }
});

test('single samples, equal timestamps and empty live comparisons remain inspectable without extra duration', async () => {
    const {buildLiveModelSeries} = await import('../src/live-model-chart-data.js');
    const {inspectAnalysisSample} = await import('../src/analysis-chart-data.js');
    const now = Date.UTC(2026, 9, 24, 12, 10);
    const result = buildLiveModelSeries([archive('alice', [now, now], [1, 2])], 'total', {now, windowMs: Infinity});
    assert.equal(result.axisMs, 1000);
    assert.equal(inspectAnalysisSample(result.series[0], 0).value, 2);
    assert.equal(inspectAnalysisSample(result.series[0], 1).kind, 'outside');
    const empty = buildLiveModelSeries([], 'room', {now});
    assert.deepEqual(empty.series, []); assert.equal(empty.axisMs, 3600000);
});

test('Full sessions fits accepted endpoints of the selected recordings without an idle clock tail', async () => {
    const {buildLiveModelSeries} = await import('../src/live-model-chart-data.js');
    const now = Date.UTC(2026, 10, 16, 12), oldest = archive('older', [now - 7200000, now - 3600000], [10, 20]);
    const newer = archive('newer', [now - 1800000, now - 600000], [30, 40]);
    const full = buildLiveModelSeries([oldest, newer], 'total', {now, windowMs: Infinity});
    assert.equal(full.originAt, now - 7200000); assert.equal(full.originAt + full.axisMs, now - 600000);
    const selected = buildLiveModelSeries([newer], 'total', {now, windowMs: Infinity});
    assert.equal(selected.originAt, now - 1800000); assert.equal(selected.axisMs, 1200000);
    assert.deepEqual(selected.series[0].times, [0, 1200000]);
    const finite = buildLiveModelSeries([newer], 'total', {now, windowMs: 3600000});
    assert.equal(finite.originAt, now - 3600000); assert.equal(finite.axisMs, 3600000, 'fixed windows still end at now');
});

test('Full sessions bounds exclude future, out-of-order and invalid-value samples', async () => {
    const {buildLiveModelSeries} = await import('../src/live-model-chart-data.js');
    const now = 1000000;
    const data = archive('mixed', [100000, 200000, 150000, 400000, now + 1], [NaN, 20, 999, 40, 1000]);
    const result = buildLiveModelSeries([data], 'total', {now, windowMs: Infinity});
    assert.equal(result.originAt, 200000); assert.equal(result.axisMs, 200000);
    assert.deepEqual(result.series[0].timestamps, [200000, 400000]);
    assert.deepEqual(result.series[0].breaks, [true, true]); assert.equal(result.excludedSamples, 3);
    const futureOnly = buildLiveModelSeries([archive('future', [now + 1], [10])], 'total', {now, windowMs: Infinity});
    assert.equal(futureOnly.originAt, now); assert.equal(futureOnly.axisMs, 1000);
    assert.deepEqual(futureOnly.series[0].times, []); assert.equal(futureOnly.excludedSamples, 1);
    const empty = buildLiveModelSeries([], 'total', {now, windowMs: Infinity});
    assert.equal(empty.originAt, now); assert.equal(empty.axisMs, 1000);
});
