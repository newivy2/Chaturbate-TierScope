const test = require('node:test'), assert = require('node:assert/strict');
const line = (times, values = times.map(() => 1)) => ({times, values, timestamps: times.slice(), breaks: times.map(() => false)});

test('visible chart bounds expand and contract with enabled lines without changing their samples', async () => {
    const {visibleAnalysisWindow} = await import('../src/analysis-chart-data.js');
    const series = [line([0, 10000]), line([3000, 6000]), line([4000, 8000])], before = JSON.stringify(series);
    assert.deepEqual(visibleAnalysisWindow(series, new Set(), 12000), [0, 10000]);
    assert.deepEqual(visibleAnalysisWindow(series, new Set([0]), 12000), [3000, 8000]);
    assert.deepEqual(visibleAnalysisWindow(series, new Set([0, 2]), 12000), [3000, 6000]);
    assert.deepEqual(visibleAnalysisWindow(series, new Set([1, 2]), 12000), [0, 10000]);
    assert.equal(JSON.stringify(series), before);
});

test('visible chart bounds give a single point a minimum one-second window within the axis', async () => {
    const {visibleAnalysisWindow} = await import('../src/analysis-chart-data.js');
    assert.deepEqual(visibleAnalysisWindow([line([5000])], new Set(), 10000), [4500, 5500]);
    assert.deepEqual(visibleAnalysisWindow([line([0])], new Set(), 10000), [0, 1000]);
    assert.deepEqual(visibleAnalysisWindow([line([10000])], new Set(), 10000), [9000, 10000]);
    assert.deepEqual(visibleAnalysisWindow([line([100])], new Set(), 400), [0, 400]);
    assert.deepEqual(visibleAnalysisWindow([line([0])], new Set(), 0), [0, 0]);
});

test('visible chart bounds ignore samples outside the axis or with invalid counts and safely handle no visible data', async () => {
    const {visibleAnalysisWindow} = await import('../src/analysis-chart-data.js');
    const invalid = line([-100, NaN, 1000, 4000, 6000, 7000, 12000], [1, 2, 3, -1, Infinity, 4, 5]);
    assert.deepEqual(visibleAnalysisWindow([invalid], new Set(), 10000), [1000, 7000]);
    assert.deepEqual(visibleAnalysisWindow([line([])], new Set(), 10000), [0, 10000]);
    assert.deepEqual(visibleAnalysisWindow([line([1000])], new Set([0]), 10000), [0, 10000]);
    assert.deepEqual(visibleAnalysisWindow([], new Set(), 10000), [0, 10000]);
    for (const axis of [-1, NaN, Infinity]) assert.throws(() => visibleAnalysisWindow([], new Set(), axis), /Invalid chart range/);
});
