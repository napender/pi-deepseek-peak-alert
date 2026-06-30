# Plan: Add TUI Status Bar & Widget Warnings

## Goal

Add in-app TUI warnings (status bar + widget) so users see peak alerts even when system notifications are muted. Works alongside existing desktop notifications.

## Architecture

```
                    ┌──────────────────────┐
                    │   Periodic Timer     │ (every 60s)
                    │   model_select       │
                    │   session_start      │
                    │   agent_end          │
                    └────────┬─────────────┘
                             │
                    ┌────────▼─────────────┐
                    │   updateTuiState()   │  ← new centralized function
                    │   Checks:            │
                    │   - isPeakHour()?    │
                    │   - isDeepSeek()?    │
                    │   - minutes left?    │
                    └────────┬─────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        setStatus()    setWidget()    Desktop Notifications
        (footer)       (above editor)  (existing, unchanged)
```

## Phases

### Phase 1: Centralized state + helper functions

- [x] Add `updateTuiWarnings(ctx, model)` function that reads peak status + active model
- [x] Track `currentModel` and `storedCtx` reference for the timer to use
- [x] Helper builds status text: `"🔴 PEAK · ~45 min left"` or `"🟢 Off-peak"`
- [x] Helper builds widget text: peak window label + time remaining

### Phase 2: Wire into lifecycle events

- [x] `session_start` → initialize TUI warnings
- [x] `model_select` → update immediately on switch
- [x] `agent_start` → refresh (captures peak status at run start)
- [x] `agent_end` → refresh (peak may have ended during run)
- [x] Periodic timer → call `updateTuiWarnings()` with stored ctx ref

### Phase 3: Status bar (footer)

- [x] When DeepSeek active + peak → `setStatus("deepseek-peak", "🔴 PEAK · ~45 min")`
- [x] When DeepSeek active + off-peak → `setStatus("deepseek-peak", "🟢 Off-peak")`
- [x] When NOT DeepSeek → `setStatus("deepseek-peak", undefined)` (hidden)

### Phase 4: Widget banner (above editor)

- [x] When DeepSeek active + peak → `setWidget("deepseek-peak", [warning lines])`
- [x] Lines: `"⚠️ DeepSeek peak pricing · {time_range} · ~{min} left · 2× rates"`
- [x] When off-peak or not DeepSeek → `setWidget("deepseek-peak", undefined)` (hidden)

### Phase 5: Test & verify

- [ ] Start pi with DeepSeek during peak → status bar + widget visible
- [ ] Start pi with DeepSeek off-peak → status shows green, widget hidden
- [ ] Switch to non-DeepSeek model → both hidden
- [ ] Switch back to DeepSeek during peak → both shown
- [ ] `/deepseek-peak` command still works
- [ ] Desktop notifications unchanged
- [ ] Timer auto-updates status/widget when peak starts/ends

### Phase 6: Push & PR

- [ ] Push feature branch
- [ ] Create PR against main
- [ ] Merge after review
