# Compare without watching — 3.32.0 beta

Open **Library → Sessions → Current Live Session**. Enter another model's room name and choose **Compare without watching**. Enter only the name, without a URL or `@`. Repeat to add more models. Adding a room retains existing comparisons; adding an active room again does not duplicate it.

Each tracked room has its own status and **Stop** control. The room list is remembered across Library closing, navigation and reloads. Open Chaturbate tabs coordinate ownership so one room is not deliberately scanned once per tab. Closing all Chaturbate tabs suspends tracking; selected rooms resume when Chaturbate is opened again.

Use a room's **Stop** button to stop it explicitly. Automatic stopping requires consecutive, successful room-list observations showing the broadcaster absent for **more than 15 minutes**. At exactly 15 minutes it remains active. A return resets the window. API errors, wrong-room responses, offline time and long observation gaps reset confirmation; they do not prove continued absence. Ownerless observations add no zero-audience samples.

Rooms refresh about once a minute, subject to shared request spacing, foreground priority and server restrictions. More rooms can mean longer intervals. Normal room tracking and its controls remain independent.

Recent aggregate samples have a **three-hour recovery window**, including non-favorite rooms. Reloads and ownership changes can recover the recording, marking the interruption as a gap. After that window expires, a selected room starts fresh. Recovery stores tier histories and totals, not lists of viewer usernames.

Favorite models use their existing automatic-keeping consent and minimum recorded-duration setting. Eligible sessions are kept or updated in Library under its normal storage limits. Favorites with automatic keeping off remain off. Pauses and gaps do not count toward the minimum. Permanent Library keeping is separate from recovery; a failed save retains valid live data and reports the pending save.

This is an experimental API-only feature. Chaturbate may refuse a room's data when its page is not open, or when access is restricted. The beta reports failures rather than opening the room or clicking tabs. A successful mocked browser test cannot establish what the live service permits; testing real public rooms is part of this beta review.

Current Live Session shortcuts now read **Compare with previous**, **Compare all live sessions**, **Compare last 24h sessions**, and **Compare without watching**. Other comparison navigation labels remain unchanged.

**3.32.0-beta.3 chart ranges:** In Live comparison, **Full sessions** fits the first and last accepted samples of visible, selected recordings. Hidden lines do not reserve empty space, and paused or stopped sessions do not add an empty tail to the current time. Adding/removing selections or hiding/showing a line refits this full view. Range presets preserve the model selections and hidden lines. Ordinary sample updates preserve manual zoom; **Full range** restores the fitted view.
