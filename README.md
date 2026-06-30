# pi-deepseek-peak-alert

A [pi](https://pi.dev) extension that sends desktop notifications when you're using DeepSeek models during **peak pricing hours** (2× regular rates).

DeepSeek introduced peak/valley pricing in July 2025. This extension makes sure you never accidentally burn double credits without knowing.

## Peak Hours

| UTC Window | IST (UTC+5:30) |
|---|---|
| 01:00 – 04:00 | 06:30 AM – 09:30 AM |
| 06:00 – 10:00 | 11:30 AM – 03:30 PM |

During these windows, all DeepSeek API billing items are **doubled**.

## What It Does

| Trigger | Notification |
|---|---|
| Switch to DeepSeek during peak | ⚠️ "DEEPSEEK PEAK HOURS — 2× PRICE" |
| Peak hours begin while DeepSeek is active | ⚠️ "DEEPSEEK PEAK HOURS STARTED" (background timer) |
| Every prompt sent during peak | ⏰ "PEAK RATE — Prompt Sent" |
| Agent run completes | Shows cost with "(2× rate)" label if peak |
| DeepSeek errors | ❌ Error notification |

Plus a `/deepseek-peak` command to check status anytime.

## Install

### Via pi (recommended)

```bash
# From npm (once published)
pi install npm:pi-deepseek-peak-alert

# From git
pi install git:github.com/napendra/pi-deepseek-peak-alert

# Local
pi install /path/to/pi-deepseek-peak-alert
```

### Manual

Copy `extensions/deepseek-notify.ts` into `~/.pi/agent/extensions/`.

## Usage

The extension loads automatically. No flags, no config.

```bash
pi
/model          # pick a DeepSeek model
/deepseek-peak  # check peak status anytime
```

If you're in peak hours, you'll get a desktop notification immediately upon switching.

## Platform Support

| OS | Mechanism |
|---|---|
| macOS | `osascript` display notification (built-in) |
| Linux | `notify-send` (requires `libnotify-bin`) |
| Windows | PowerShell toast notifications |

## Customization

Edit `extensions/deepseek-notify.ts` and reload with `/reload`:

- **Change timezone** — adjust `IST_OFFSET_HOURS` and `PEAK_SLOTS` labels
- **Disable specific notifications** — comment out the `pi.on(...)` blocks
- **Add sound** — macOS supports `sound name "Glass"` etc.
- **Cost threshold** — only alert if cost exceeds a threshold in `agent_end`

## Edge Cases Covered

- ✅ Switch to DeepSeek mid-session during peak
- ✅ Session starts with DeepSeek default in peak
- ✅ Idle session — peak starts while you're away (timer catches it)
- ✅ Actively working — peak starts mid-run (timer notifies; billing label uses request-start time)
- ✅ Peak ends mid-run (correctly shows peak billing)
- ✅ Timer only fires when DeepSeek is active (silent on other models)

## Uninstall

```bash
pi remove pi-deepseek-peak-alert
```

## License

MIT
