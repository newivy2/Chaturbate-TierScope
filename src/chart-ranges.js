// Shared chart presets, ordered from the shortest window to the full recording.
export const CHART_RANGES = Object.freeze([
    {key: 'quarter', ms: 15 * 60000, label: '15 minutes', shortLabel: '15m'},
    {key: 'hour', ms: 60 * 60000, label: '1 hour', shortLabel: '1h'},
    {key: 'fourHours', ms: 4 * 60 * 60000, label: '4 hours', shortLabel: '4h'},
    {key: 'twelveHours', ms: 12 * 60 * 60000, label: '12 hours', shortLabel: '12h'},
    {key: 'day', ms: 24 * 60 * 60000, label: '24 hours', shortLabel: '24h'},
    {key: 'full', ms: Infinity, label: 'Full range', shortLabel: 'Full'}
].map(range => Object.freeze(range)));

// Old settings and backups retain their intent by choosing the next wider
// supported window. Invalid preferences remain invalid for the caller to reject.
export function normalizeChartRangeKey(value) {
    if (value === 'halfHour') return 'hour';
    if (value === 'twoHours') return 'fourHours';
    return CHART_RANGES.some(range => range.key === value) ? value : null;
}
