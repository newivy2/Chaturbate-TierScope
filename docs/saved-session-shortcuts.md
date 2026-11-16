# Saved sessions shortcuts — 3.31.1

**Saved sessions** in full and chart-only comparisons starts a fresh comparison of this room's current tracked session with all earlier saved sessions from the same model. It clears filters and selections left over from another model or comparison mode. A Library copy of the current session is excluded, using the session's original start time.

If this room has no live samples yet, the shortcut uses its newest saved session and compares it with earlier sessions. If there is no earlier history, it explains what is missing and leaves the second selection empty. It never substitutes another model just to populate the chart.

On directory pages, an open replay supplies the model; otherwise, the selected model folder or analysis filter supplies it. With no model selected, choose one in the session picker.

Model-card comparisons and **Compare with previous** remain available. You can still manually choose sessions from different models after using the shortcut. Returning through **Saved sessions** rebuilds the same-model comparison again.

Review checks:

- From Live models or Last 24h, select Saved sessions and check that every selected session belongs to the current room's model.
- Repeat in Chart only view and after choosing a mixed-model comparison manually.
- Replay another model while on a room page: Saved sessions should still use the room being tracked.
- Try a model without earlier history: the picker should explain the missing history, without showing an unrelated comparison.

This only changes analysis selection. It does not add API scans, save Library entries, reset live tracking or move playback.
