# Compare without watching — 3.32.0 beta

Open **Library → Sessions → Current Live Session**. Enter another model's room name in the box and choose **Compare without watching**. Enter only the name, without a URL or `@`.

TierScope opens Live models comparison and selects your current room plus the entered room. The extra room's line begins with its first accepted sample; earlier audience history is unavailable. Metric selection, real-time alignment, Freeze and chart-only view work as they do for other live comparisons.

This beta tracks one entered room at a time. Choosing another replaces that temporary comparison recording. **Stop tracking this room** stops its scans and keeps the last chart snapshot while Library remains open. Closing Library, changing pages or reloading stops this tracking and discards its temporary recording. It is not automatically saved to Library or added to all-time highs.

The extra room refreshes about once a minute, subject to request spacing, foreground priority and server restrictions. Pauses, rejected samples, connection failures and missed scans remain gaps; unavailable data is never plotted as a fabricated zero. The normal room's tracking controls and automatic keeping remain independent.

This is an experimental API-only feature. Chaturbate may refuse a room's data when its page is not open, or when access is restricted. The beta reports failures rather than opening the room or clicking tabs. A successful mocked browser test cannot establish what the live service permits; testing real public rooms is part of this beta review.

Current Live Session shortcuts now read **Compare with previous**, **Compare all live sessions**, **Compare last 24h sessions**, and **Compare without watching**. Other comparison navigation labels remain unchanged.
