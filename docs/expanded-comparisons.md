# Expanded comparisons — 3.30.0 beta

This preview adds an all-model **Last 24h** comparison and removes the separate session/model count limits from saved and live comparisons. It still installs as one userscript.

## Try the preview

Install [3.30.0-beta.1](https://github.com/newivy2/TierScope/blob/beta/expanded-comparisons/tierscope.user.js) over the existing TierScope script, then refresh your room tabs. Stable `main` remains on 3.29.0 until this preview is approved.

Open **Library → Compare** and choose **Saved sessions**, **Live models**, or **Last 24h**. The current-session card, Sessions tab and model-history actions also provide **Last 24h · all models** shortcuts.

## Last 24h — all saved models

This view always reads the complete saved Library. Model, search, favorite and date filters from other views do not restrict it.

- The window rolls from exactly 24 hours before now through now, including both endpoints.
- A session is included when it has at least one recorded sample inside that window. A session that started earlier is included if it contains recent samples.
- Empty sessions, future samples and old sessions without a sample inside the window are excluded. A gap crossing the window by itself does not qualify a session.
- All qualifying sessions appear, including separate sessions from the same model. Their audiences and histories are never added together.
- The chart uses actual dated timestamps, including midnight crossings. It shows the portion inside the last day, with recording gaps preserved and no line extended past its final sample.

The metric strip changes the displayed tier or total. **Freeze comparison** holds both the session snapshots and displayed date window; **Resume comparison** catches up. The refresh button reads saved sessions again. Saved updates are checked every ten seconds while this view is open, and the rolling window advances periodically.

Last 24h uses sessions already kept in the Library. It does not automatically keep unsaved recordings or scan additional rooms. Live models remains the view for currently open tracking tabs.

## Larger saved comparisons

Saved comparisons no longer impose a thirty-session or twelve-model comparison limit. Select as many stored sessions as needed in the Sessions Book, use **Compare all matching saved sessions** in the saved comparison chooser, or use a model's Compare shortcut. **Compare with previous** includes all available earlier sessions for that model.

The newest line stays opaque pink. The following eleven lines fade progressively. Every earlier session contributes to a faint gray background; that background is composited once so many overlapping old lines do not build into a dark mass. Each session remains separately inspectable and can be hidden.

With more than thirty selected sessions, the selected-session list and statistics use pages of 25. The chart still draws every selected line. Statistics paging does not change the comparison range, threshold calculations or chart selection. The original **Elapsed time** and **24h time of day** alignment options remain available for saved comparisons; the latter is separate from the rolling **Last 24h** view.

## More live models

Live models has no separate twelve-model selection or two-hundred-publisher discovery cutoff. Use **Select all**, **Clear**, model search and **Show more models** to manage the chooser. Latest-sample reports use pages of fifty.

One line is shown per selected model. If it is tracked in multiple tabs, the session with the most samples supplies that line; ties keep the current source. Colors remain stable for models that stay selected, and additional models receive additional colors. Existing pause, stale-source, Reset and Freeze/Resume behavior is preserved.

## Inspect large charts

For more than thirty lines, legends and sample-inspection rows have searchable pages. Search and paging locate controls; they do not remove lines from the chart. Hide a line explicitly with its checkbox. Zoom, the pinned inspection cursor and hidden-line choices survive incoming updates and metric changes for the same selection.

Available recordings remain subject to the Library's configured storage capacity and the browser's resources. Larger selections require more rendering work, but do not cause additional Chaturbate API requests. Closing the view releases its timers, listeners and chart resources. Saved recordings, ATH and tracking state are unchanged by viewing comparisons.
