# Expanded comparisons — 3.30.0

This release adds an all-model **Last 24h** comparison and removes the separate session/model count limits from saved and live comparisons. It still installs as one userscript.

## Open comparisons

Install the [official 3.30.0 userscript](https://raw.githubusercontent.com/newivy2/TierScope/main/tierscope.user.js), then refresh your room tabs. Keep only one enabled TierScope copy.

Open **Library → Compare** and choose **Saved sessions**, **Live models**, or **Last 24h**. The **Current Live Session** card provides **Live sessions** and **Last 24h sessions** shortcuts beside the existing comparison actions. The Sessions tab and model-history actions also provide **Last 24h · all models** shortcuts.

## Last 24h — all saved models

This view always reads the complete saved Library. Model, search, favorite and date filters from other views do not restrict it.

- The default window rolls from exactly 24 hours before now through now, including both endpoints. **Range** offers **Last hour**, **Last 4 hours**, **Last 12 hours** and **Last 24 hours**. Each preset includes sessions with actual samples in that range and displays that portion of their histories.
- A session is included when it has at least one recorded sample inside that window. A session that started earlier is included if it contains recent samples.
- Empty sessions, future samples and old sessions without a sample inside the window are excluded. A gap crossing the window by itself does not qualify a session.
- All qualifying sessions appear, including separate sessions from the same model. Their audiences and histories are never added together.
- The chart uses actual dated timestamps, including midnight crossings. It shows the selected rolling range, with recording gaps preserved and no line extended past its final sample.

Solid lines identify current sessions in open TierScope tracking tabs; this room’s matching current session stays opaque pink, even if it began before newer recordings. Other ongoing sessions stay solid and opaque. Older sessions of the same model remain dashed, as do stopped, closed and stale sessions. Historical traces keep their progressive fading; older history forms the faint gray background.

Tracking indicators come from existing tab announcements, without reading more session histories or sending API requests. Paused tabs and temporary connection/retry waits still count as ongoing sessions. This indicates TierScope tracking, not confirmed broadcasting status on Chaturbate. A duplicate model uses the ongoing session with the most samples. Records with an unknown start are not guessed to be current. If tracking metadata is unavailable, an explanation appears and unmatched sessions use historical styling.

The metric strip changes the displayed tier or total. **Freeze comparison** holds the session snapshots and end time; **Resume comparison** catches up. Tracking indicators still update while frozen. Presets remain available while frozen, using the captured day without another storage read. The refresh button reads saved sessions again. Saved updates are checked every ten seconds while this view is open, and the rolling window advances periodically.

Unchecked sessions and a selected time range stay as chosen when the rolling view updates. Compatible automatic Library replacements inherit the same visibility choice; conflicting recordings remain separate. A manually zoomed range is clamped only if it moves outside the selected rolling window. Choosing a different preset opens its full range while retaining unchecked lines. The preset stays selected across metric changes and tab navigation while Library is open; the **Last 24h sessions** shortcut opens the full day.

Last 24h uses sessions already kept in the Library. It does not automatically keep unsaved recordings or scan additional rooms. Live models remains the view for currently open tracking tabs.

## Larger saved comparisons

Saved comparisons no longer impose a thirty-session or twelve-model comparison limit. Select as many stored sessions as needed in the Sessions Book, use **Compare all matching saved sessions** in the saved comparison chooser, or use a model's Compare shortcut. **Compare with previous** includes all available earlier sessions for that model.

The newest line stays opaque pink. The following eleven lines fade progressively. Every earlier session contributes to a faint gray background; that background is composited once so many overlapping old lines do not build into a dark mass. Each session remains separately inspectable and can be hidden.

With more than thirty selected sessions, the selected-session list and statistics use pages of 25. The chart still draws every selected line. Statistics paging does not change the comparison range, threshold calculations or chart selection. The original **Elapsed time** and **24h time of day** alignment options remain available for saved comparisons; the latter is separate from the rolling **Last 24h** view.

## More live models

Live models has no separate twelve-model selection or two-hundred-publisher discovery cutoff. Use **Select all**, **Clear**, model search and **Show more models** to manage the chooser. Latest-sample reports use pages of fifty.

One line is shown per selected model. If it is tracked in multiple tabs, the session with the most samples supplies that line; ties keep the current source. This room’s selected model uses pink. Other colors remain stable for models that stay selected, and additional models receive additional colors; a model joining as the current room takes the pink slot. Existing pause, stale-source, Reset and Freeze/Resume behavior is preserved.

## Inspect large charts

For more than thirty lines, legends and sample-inspection rows have searchable pages. Search and paging locate controls; they do not remove lines from the chart. Hide a line explicitly with its checkbox. Zoom, the pinned inspection cursor and hidden-line choices survive incoming updates and metric changes for the same selection.

Available recordings remain subject to the Library's configured storage capacity and the browser's resources. Larger selections require more rendering work, but do not cause additional Chaturbate API requests. Closing the view releases its timers, listeners and chart resources. Saved recordings, ATH and tracking state are unchanged by viewing comparisons.
