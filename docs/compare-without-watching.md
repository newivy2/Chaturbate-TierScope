# Compare without watching — 3.32.0

Open **Library → Sessions → Current Live Session**. Enter another model's room name and choose **Compare without watching**. Enter only the name, without a URL or `@`. Repeat to add more models. Adding a room retains existing comparisons; adding an active room again does not duplicate it.

Each tracked room has its own status and **Stop** control. The room list is remembered across Library closing, navigation and reloads. Open Chaturbate tabs coordinate ownership so one room is not deliberately scanned once per tab. Closing all Chaturbate tabs suspends tracking; selected rooms resume when Chaturbate is opened again.

Use a room's **Stop** button to stop it explicitly. Automatic stopping requires consecutive, successful room-list observations showing the broadcaster absent for **more than 15 minutes**. At exactly 15 minutes it remains active. A return resets the window. API errors, wrong-room responses, offline time and long observation gaps reset confirmation; they do not prove continued absence. Ownerless observations add no zero-audience samples.

Rooms refresh about once a minute, subject to shared request spacing, foreground priority and server restrictions. More rooms can mean longer intervals. Normal room tracking and its controls remain independent.

Recent aggregate samples have a **three-hour recovery window**, including non-favorite rooms. Reloads and ownership changes can recover the recording, marking the interruption as a gap. After that window expires, a selected room starts fresh. Recovery stores tier histories and totals, not lists of viewer usernames.

Favorite models use their existing automatic-keeping consent and minimum recorded-duration setting. Eligible sessions are kept or updated in Library under its normal storage limits. Favorites with automatic keeping off remain off. Pauses and gaps do not count toward the minimum. Permanent Library keeping is separate from recovery; a failed save retains valid live data and reports the pending save.

This is an experimental API-only feature. Chaturbate may refuse a room's data when its page is not open, or when access is restricted. TierScope reports access failures in the tracking list. Rooms request data through the authenticated room-list API. Access to a room can depend on your account and the site’s restrictions.

Current Live Session shortcuts now read **Compare with previous**, **Compare all live sessions**, **Compare last 24h sessions**, and **Compare without watching**. Other comparison navigation labels remain unchanged.

The main panel, Live comparison and saved-model comparison share **15 minutes**, **1 hour**, **4 hours**, **12 hours**, **24 hours** and **Full range**, in that order. Existing 30-minute and 2-hour panel preferences or backups migrate to 1 hour and 4 hours respectively.

In Live comparison, **Full range** fits the first and last accepted samples of visible, selected recordings. Hidden lines do not reserve empty space, and paused or stopped sessions do not add an empty tail to the current time. Adding/removing selections or hiding/showing a line refits this full view. Range presets preserve the model selections and hidden lines. Ordinary sample updates preserve manual zoom; **Full range** restores the fitted view.

In saved-model comparison, Full range includes saved recordings older than 24 hours and fits visible sample endpoints. Frozen views can expand to any preset without rereading the Library. Hidden sessions stay hidden when omitted by a short preset and restored by a wider one.

The newest **30 sessions by start time** keep their colors, with historical lines fading progressively. Historical lines ranked **31** and older form a faint gray background. Ongoing TierScope sessions stay colored, solid and opaque at any age, including paused sessions and temporary connection or retry waits. Other saved, stopped and stale sessions use dashed lines. Reordering and hiding lines preserve their age rank when start times differ. Range changes preserve checked and unchecked sessions.

Use **Clear stopped/stale** below the background-tracking list or in Live comparison to hide old entries. Live comparison also clears retained traces from closed source tabs. The choice survives Library reopening and page reloads; heartbeats alone do not restore a dismissed session. A fresh accepted sample or explicitly adding the room again returns it to view. Cleanup does not delete Library recordings or three-hour recovery data, and it does not stop active tracking or clear paused rooms.
