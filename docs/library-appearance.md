# Independent Library appearance — 3.31.0 beta

Install the [beta userscript](https://github.com/newivy2/TierScope/blob/beta/library-appearance/tierscope.user.js) over your existing script, then refresh room tabs. Official main remains 3.30.0.

- Drag Library’s pink upper-left grip left to enlarge it or right to shrink it. Fonts, charts, controls and spacing scale together, independently of Scope.
- Click the percentage button beside Close to restore Library to 100%. With the grip focused, arrow keys adjust the scale; Home restores 100%.
- Use the transparency slider fixed at the bottom of Library to adjust its background. Text and charts retain their contrast. Scope’s slider affects Scope and its tier rows independently.

Library remembers its own scale and opacity across reopenings, rooms and page reloads. The initial settings are 100% scale and 95% background opacity. Dark/bright mode remains shared with Scope. If saving fails, Library explains that the temporary appearance applies while it is open; adjusting again retries the save.

Narrow windows temporarily fit Library to the available space without overwriting the preferred scale. Widening the window restores that scale. Existing docking, sheet layout and Scope’s priority above an overlapping Library remain in place. Appearance changes preserve live tracking, replay, chart selections and recordings.


## Chart-only comparison view

Open a comparison in **Saved sessions**, **Live models** or **Last 24h**, then select **Chart only** in Library’s header. It shows the current chart with a small header and status line, keeping the tier icon strip, range controls and chart zoom/pan controls available while hiding tabs, session selectors, legends and reports. Select **Expand** to return to the same comparison and its controls.

Use the same tier icons to change the displayed metric. Live and Last 24h views retain their range presets; Saved comparisons retain their X axis and Match shared length controls. Changes carry back to the full Library because these are the original controls. Saved sessions, Live models and Last 24h shortcuts remain available in the minimized view. The chart fills the main scroll viewport by default and is at least as tall as the regular chart at the same scale. Scroll up or down for the shortcuts and controls; returning to the full Library preserves their choices. Entering chart-only view or choosing a different comparison mode brings its chart into view. Background updates preserve where you have scrolled. Short windows can scroll through the chart as well, with the transparency footer kept on screen.

The pink upper-left grip, percentage reset and bottom transparency slider remain available. Chart-only view remembers its own scale and opacity separately from the full Library. Library opens in its full view next time; chart-only appearance choices remain saved.

Switching views keeps the same chart, selected sessions, metric, hidden lines, zoom, pinned cursor and Freeze state. Live and recent comparisons continue updating as before. Status text and notices remain visible; expand to review detailed source status or inspection values. Keyboard chart inspection remains available to screen readers. If the comparison becomes empty or a saved selection becomes invalid, Library expands so the controls and explanation are available.
