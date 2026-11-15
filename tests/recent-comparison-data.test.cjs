const test = require('node:test'), assert = require('node:assert/strict');
const now = Date.UTC(2026, 10, 15, 12), day = 86400000;
function entry(id, room, timestamps, extra = {}) {
    return {id, archive: {room, session: {history: {timestamps, breaks: timestamps.map(() => false),
        total: timestamps.map((_, i) => i + 10), anonymous: timestamps.map(() => 5)}, ...extra}}};
}

test('Last 24h includes both endpoints and excludes old, future and empty recordings', async () => {
    const {selectRecentComparisonEntries, RECENT_COMPARISON_MS} = await import('../src/recent-comparison-data.js');
    assert.equal(RECENT_COMPARISON_MS, day);
    const entries = [entry('cutoff', 'alice', [now - day]), entry('now', 'brenda', [now]),
        entry('old', 'carol', [now - day - 1]), entry('future', 'diana', [now + 1]), entry('empty', 'ella', [])];
    const before = JSON.stringify(entries), result = selectRecentComparisonEntries(entries, now);
    assert.deepEqual(result.entries.map(item => item.id), ['now', 'cutoff']);
    assert.equal(result.cutoffAt, now - day); assert.equal(result.now, now);
    assert.equal(result.roomCount, 2); assert.equal(result.sampleCount, 2);
    assert.equal(JSON.stringify(entries), before, 'selection never mutates or sorts source records');
    assert.equal(result.entries[0], entries[1], 'selection retains source identity for snapshot caching');
});

test('old starts and long sessions qualify through any real recent sample, including before a future tail', async () => {
    const {selectRecentComparisonEntries} = await import('../src/recent-comparison-data.js');
    const long = entry('long', 'alice', [now - 3 * day, now - day - 1, now - day, now - 1000, now + 1],
        {sessionStartedAt: now - 4 * day});
    const result = selectRecentComparisonEntries([long], now), item = result.metadata[0];
    assert.equal(result.entries.length, 1); assert.equal(item.startAt, now - 4 * day);
    assert.equal(item.latestAt, now - 1000); assert.equal(item.latestIndex, 3); assert.equal(item.sampleCount, 2);
});

test('a recording interval crossing the window without an accepted sample does not qualify', async () => {
    const {selectRecentComparisonEntries} = await import('../src/recent-comparison-data.js');
    const gap = entry('gap', 'alice', [now - day - 1, now + 1]); gap.archive.session.history.breaks[1] = true;
    const result = selectRecentComparisonEntries([gap, entry('old-pause', 'brenda', [now - 2 * day, now - day - 1], {isPaused: true})], now);
    assert.equal(result.entries.length, 0); assert.equal(result.roomCount, 0); assert.equal(result.sampleCount, 0);
});

test('all models and separate same-model sessions are included without a count cap', async () => {
    const {selectRecentComparisonEntries} = await import('../src/recent-comparison-data.js');
    const entries = Array.from({length: 75}, (_, i) => entry('session-' + i, 'model_' + (i % 15), [now - 100000 + i]));
    const result = selectRecentComparisonEntries(entries, now);
    assert.equal(result.entries.length, 75); assert.equal(result.roomCount, 15);
    assert.equal(result.sampleCount, 75); assert.equal(new Set(result.metadata.map(item => item.sourceId)).size, 75);
    assert.equal(result.entries[0].id, 'session-74');
});

test('record IDs distinguish conflicting shared lineages and reports use the latest dated sample inside the window', async () => {
    const {selectRecentComparisonEntries} = await import('../src/recent-comparison-data.js');
    const source = entry('new-record-id', 'alice', [now - 2000, now - 1000, now - 1000, now - 1500, now + 1]);
    source.lineage = 'stable-library-session';
    const [item] = selectRecentComparisonEntries([source], now).metadata;
    assert.equal(item.sourceId, source.id); assert.equal(item.latestIndex, 2);
    assert.equal(item.sampleCount, 4); assert.equal(item.startAt, now - 2000);
    const sibling = {...source, id: 'conflicting-record-id'};
    assert.equal(new Set(selectRecentComparisonEntries([source, sibling], now).metadata.map(item => item.sourceId)).size, 2);
    for (const invalid of [NaN, -1, Infinity, 1.5]) assert.throws(() => selectRecentComparisonEntries([], invalid), /Invalid recent comparison/);
    assert.throws(() => selectRecentComparisonEntries(null, now), /Invalid recent comparison/);
});

test('selected long sessions project onto one actual-date window without future samples or synthetic tails', async () => {
    const {selectRecentComparisonEntries} = await import('../src/recent-comparison-data.js');
    const {buildLiveModelSeries} = await import('../src/live-model-chart-data.js');
    const first = entry('first', 'alice', [now - 2 * day, now - day, now - 1000, now + 1]);
    const second = entry('second', 'brenda', [now - 3600000, now - 2000]);
    const chosen = selectRecentComparisonEntries([first, second], now);
    const projection = buildLiveModelSeries(chosen.entries.map(item => item.archive), 'room', {now, windowMs: day});
    assert.equal(projection.originAt, now - day); assert.equal(projection.axisMs, day);
    assert.equal(projection.series.length, 2);
    assert(projection.series.every(series => series.timestamps.every(time => time <= now)));
    const alice = projection.series[chosen.metadata.findIndex(item => item.room === 'alice')];
    assert.equal(alice.timestamps.at(-1), now - 1000);
    assert.equal(alice.times.at(-1), day - 1000, 'the line ends at a real accepted sample');
});

test('rolling hour, four-hour, twelve-hour and day windows include both exact boundaries', async () => {
    const {selectRecentComparisonEntries} = await import('../src/recent-comparison-data.js');
    for (const windowMs of [3600000, 4 * 3600000, 12 * 3600000, day]) {
        const cutoff = now - windowMs;
        const entries = [entry('before', 'alice', [cutoff - 1]), entry('cutoff', 'brenda', [cutoff]),
            entry('now', 'carol', [now]), entry('after', 'diana', [now + 1])];
        const result = selectRecentComparisonEntries(entries, now, windowMs);
        assert.deepEqual(result.entries.map(item => item.id), ['now', 'cutoff']);
        assert.equal(result.cutoffAt, cutoff); assert.equal(result.now, now);
        assert.equal(result.roomCount, 2); assert.equal(result.sampleCount, 2);
    }
});

test('shorter windows select real recent samples from old sessions and exclude earlier coverage', async () => {
    const {selectRecentComparisonEntries} = await import('../src/recent-comparison-data.js');
    const hour = 3600000, cutoff = now - hour;
    const ongoing = entry('ongoing', 'alice', [now - 3 * day, cutoff - 1, cutoff, now - 1000, now + 1],
        {sessionStartedAt: now - 4 * day});
    const earlier = entry('earlier', 'brenda', [now - 2 * hour]);
    const before = JSON.stringify([ongoing, earlier]);
    const result = selectRecentComparisonEntries([ongoing, earlier], now, hour);
    assert.deepEqual(result.entries, [ongoing]);
    assert.equal(result.metadata[0].startAt, now - 4 * day, 'a recent sample qualifies regardless of session start');
    assert.equal(result.metadata[0].sampleCount, 2); assert.equal(result.metadata[0].latestIndex, 3);
    assert.equal(result.metadata[0].latestAt, now - 1000);
    assert.equal(JSON.stringify([ongoing, earlier]), before, 'the shorter window never trims stored histories');
    assert.equal(selectRecentComparisonEntries([ongoing, earlier], now).entries.length, 2, 'omitting the range retains the original day default');
});

test('invalid or oversized rolling ranges fall back to the unchanged day selection', async () => {
    const {selectRecentComparisonEntries} = await import('../src/recent-comparison-data.js');
    const entries = [entry('yesterday', 'alice', [now - day]), entry('earlier', 'brenda', [now - 8 * 3600000]),
        entry('current', 'carol', [now]), entry('old', 'diana', [now - day - 1])];
    const expected = selectRecentComparisonEntries(entries, now);
    for (const invalid of [undefined, null, false, true, '', '3600000', NaN, Infinity, -Infinity, 0, -1, 1.5,
        day + 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
        assert.deepEqual(selectRecentComparisonEntries(entries, now, invalid), expected);
    }
    const narrow = selectRecentComparisonEntries([entry('cutoff', 'alice', [now - 1]),
        entry('too-old', 'brenda', [now - 2]), entry('now', 'carol', [now])], now, 1);
    assert.deepEqual(narrow.entries.map(item => item.id), ['now', 'cutoff'], 'any positive safe integer within the day bound is accepted');
});

test('rolling cutoff is clamped at the timestamp origin', async () => {
    const {selectRecentComparisonEntries} = await import('../src/recent-comparison-data.js');
    const result = selectRecentComparisonEntries([entry('origin', 'alice', [0]), entry('current', 'brenda', [100])], 100, 3600000);
    assert.equal(result.cutoffAt, 0); assert.equal(result.sampleCount, 2);
    assert.deepEqual(result.entries.map(item => item.id), ['current', 'origin']);
});
