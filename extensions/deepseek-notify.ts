import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/**
 * DeepSeek Peak-Hour Notifications
 *
 * DeepSeek peak hours (UTC): 1:00–4:00 AM and 6:00–10:00 AM
 * During peak hours, prices are 2× regular.
 *
 * ─── CONFIGURE YOUR TIMEZONE ──────────────────────────────────────
 * Change TIMEZONE_OFFSET_HOURS below to your UTC offset.
 * Then update the PEAK_SLOTS labels to show your local times.
 *
 * Common offsets:
 *   IST  (India)          +5.5
 *   EST  (US Eastern)     -5 / -4 (DST)
 *   PST  (US Pacific)     -8 / -7 (DST)
 *   GMT  (UK)              0 / +1 (BST)
 *   CET  (Central Europe) +1 / +2 (CEST)
 *   CST  (China)          +8
 *   JST  (Japan)          +9
 *   AEST (Sydney)        +10 / +11 (DST)
 *
 * Three-layer warning system:
 *   Layer 1: TUI status bar  → always visible in footer
 *   Layer 2: TUI widget       → banner above editor
 *   Layer 3: Desktop notifications → system-level alerts
 */

// ─── Platform notification ───────────────────────────────────────

function sendNotification(title: string, body: string, sound?: string) {
  const esc = (s: string) => s.replace(/"/g, '\\"').replace(/\n/g, " ");
  const t = esc(title);
  const b = esc(body);
  const { exec } = require("node:child_process");

  if (process.platform === "darwin") {
    const soundFlag = sound ? ` sound name "${sound}"` : "";
    exec(
      `osascript -e 'display notification "${b}" with title "${t}"${soundFlag}'`
    );
  } else if (process.platform === "linux") {
    const urgency = sound ? "-u critical" : "";
    exec(`notify-send ${urgency} "${t}" "${b}"`);
  } else if (process.platform === "win32") {
    const ps = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;
      $tpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);
      $tpl.GetElementsByTagName('text')[0].AppendChild($tpl.CreateTextNode('${t}')) > $null;
      $tpl.GetElementsByTagName('text')[1].AppendChild($tpl.CreateTextNode('${b}')) > $null;
      $toast = [Windows.UI.Notifications.ToastNotification]::new($tpl);
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('pi-deepseek').Show($toast);
    `;
    exec(`powershell -Command "${ps.replace(/"/g, '\\"')}"`);
  }
}

// ─── CONFIGURE YOUR TIMEZONE ──────────────────────────────────────
// Change this to your UTC offset (e.g. -5 for EST, +1 for CET, +8 for CST)
const TIMEZONE_OFFSET_HOURS = 5.5; // IST (UTC+5:30)

/** Convert UTC decimal hours to local time string (e.g. 6.5 → "6:30 AM") */
function utcToLocalTimeLabel(utcH: number): string {
  let local = utcH + TIMEZONE_OFFSET_HOURS;
  if (local < 0) local += 24;
  if (local >= 24) local -= 24;
  const h = Math.floor(local);
  const m = Math.round((local - h) * 60);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m > 0 ? `${h12}:${m < 10 ? "0" : ""}${m} ${ampm}` : `${h12}:00 ${ampm}`;
}

/** Timezone abbreviation derived from offset (for display only) */
function tzAbbr(): string {
  const off = TIMEZONE_OFFSET_HOURS;
  if (off === 5.5) return "IST";
  if (off === -5) return "EST";
  if (off === -8) return "PST";
  if (off === 0) return "GMT";
  if (off === 1) return "CET";
  if (off === 8) return "CST";
  if (off === 9) return "JST";
  if (off === 10) return "AEST";
  return `UTC${off >= 0 ? "+" : ""}${off}`;
}

// ─── Peak‑hour logic (UTC-based, unaffected by timezone) ─────────

const PEAK_SLOTS = [
  { startUtcH: 1, endUtcH: 4 },
  { startUtcH: 6, endUtcH: 10 },
];

function peakSlotLabel(slot: typeof PEAK_SLOTS[0]): string {
  return `${utcToLocalTimeLabel(slot.startUtcH)} – ${utcToLocalTimeLabel(slot.endUtcH)} ${tzAbbr()}`;
}

function getActivePeakSlot(now: Date = new Date()) {
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
  for (const slot of PEAK_SLOTS) {
    if (utcH >= slot.startUtcH && utcH < slot.endUtcH) return slot;
  }
  return null;
}

function isPeakHour(now: Date = new Date()): boolean {
  return getActivePeakSlot(now) !== null;
}

function minutesUntilPeakEnd(now: Date = new Date()): number | null {
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
  for (const slot of PEAK_SLOTS) {
    if (utcH >= slot.startUtcH && utcH < slot.endUtcH) {
      return Math.ceil((slot.endUtcH - utcH) * 60);
    }
  }
  return null;
}

function minutesUntilNextPeakStart(now: Date = new Date()): number | null {
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
  for (const slot of PEAK_SLOTS) {
    if (utcH < slot.startUtcH) {
      return Math.ceil((slot.startUtcH - utcH) * 60);
    }
  }
  const firstSlot = PEAK_SLOTS[0];
  const minsUntilMidnight = (24 - utcH) * 60;
  return Math.ceil(minsUntilMidnight + firstSlot.startUtcH * 60);
}

function peakStatusText(): string {
  const slot = getActivePeakSlot();
  if (slot) {
    const mins = minutesUntilPeakEnd();
    return `🔴 PEAK NOW — ${peakSlotLabel(slot)} — ~${mins} min remaining — 2× pricing active`;
  }
  const mins = minutesUntilNextPeakStart();
  const nextSlot =
    PEAK_SLOTS.find((s) => {
      const nowH = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
      return nowH < s.startUtcH;
    }) ?? PEAK_SLOTS[0];
  return `🟢 Off-peak — next peak: ${peakSlotLabel(nextSlot)} (in ~${mins} min)`;
}

// ─── DeepSeek model detection ────────────────────────────────────

function isDeepSeek(model: { provider: string; id: string } | undefined): boolean {
  if (!model) return false;
  return model.provider === "deepseek" || model.id.toLowerCase().includes("deepseek");
}

// ─── TUI status bar + widget helpers ─────────────────────────────

/** Update both the footer status and the editor widget based on current state. */
function updateTuiWarnings(
  ctx: { ui: { setStatus: (id: string, text: string | undefined) => void; setWidget: (id: string, lines: string[] | undefined) => void } },
  model: { provider: string; id: string } | undefined,
) {
  const WIDGET_ID = "deepseek-peak";
  const STATUS_ID = "deepseek-peak";

  if (isDeepSeek(model) && isPeakHour()) {
    const now = new Date();
    const slot = getActivePeakSlot(now);
    const mins = minutesUntilPeakEnd(now);
    const label = slot ? peakSlotLabel(slot) : "now";

    // Status bar: compact indicator
    ctx.ui.setStatus(STATUS_ID, `🔴 PEAK · ~${mins ?? "?"} min`);

    // Widget banner: full warning above editor
    const lines = [
      `⚠️  DeepSeek peak pricing active · ${label} · ~${mins ?? "?"} min remaining`,
      `    Prices are 2× regular rate. Ctrl+P to switch models.`,
    ];
    ctx.ui.setWidget(WIDGET_ID, lines);
  } else if (isDeepSeek(model) && !isPeakHour()) {
    // Off-peak but DeepSeek active: green status, no banner
    ctx.ui.setStatus(STATUS_ID, "🟢 Off-peak");
    ctx.ui.setWidget(WIDGET_ID, undefined);
  } else {
    // Not DeepSeek: hide everything
    ctx.ui.setStatus(STATUS_ID, undefined);
    ctx.ui.setWidget(WIDGET_ID, undefined);
  }
}

// ─── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Shared state ───────────────────────────────────────────────
  let currentRunStartedInPeak = false;
  let currentModel: { provider: string; id: string } | undefined;
  // Stored ctx reference so the timer can update TUI components
  let storedCtx: { ui: { setStatus: (id: string, text: string | undefined) => void; setWidget: (id: string, lines: string[] | undefined) => void } } | null = null;

  // ── Periodic timer ─────────────────────────────────────────────
  let wasPeakLastCheck = isPeakHour();

  const peakCheckInterval = setInterval(() => {
    const nowPeak = isPeakHour();

    // Update TUI status/widget every tick (handles idle transitions)
    if (storedCtx) {
      updateTuiWarnings(storedCtx, currentModel);
    }

    // Desktop notification: only on transition INTO peak
    if (nowPeak && !wasPeakLastCheck) {
      const slot = getActivePeakSlot();
      if (isDeepSeek(currentModel)) {
        sendNotification(
          "⚠️ DEEPSEEK PEAK HOURS STARTED",
          [
            `Peak window: ${slot ? peakSlotLabel(slot) : "now"}`,
            "2× pricing is now active.",
            "Any NEW prompts will be billed at double rate.",
            "Switch with /model or Ctrl+P to avoid.",
          ].join(" · "),
          "Basso"
        );
      }
    }
    wasPeakLastCheck = nowPeak;
  }, 60_000);

  // ── Cleanup on session shutdown ────────────────────────────────
  pi.on("session_shutdown", async () => {
    clearInterval(peakCheckInterval);
    // Clear TUI artifacts so another extension's UI isn't polluted
    if (storedCtx) {
      storedCtx.ui.setStatus("deepseek-peak", undefined);
      storedCtx.ui.setWidget("deepseek-peak", undefined);
    }
    storedCtx = null;
  });

  // ── /deepseek-peak command ─────────────────────────────────────
  pi.registerCommand("deepseek-peak", {
    description: "Check if DeepSeek peak pricing is currently active",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const status = peakStatusText();
      ctx.ui.notify(status, isPeakHour() ? "warning" : "info");
    },
  });

  // ═══════════════════════════════════════════════════════════════
  // SESSION START — init TUI + desktop notification
  // ═══════════════════════════════════════════════════════════════

  pi.on("session_start", async (_event, ctx) => {
    currentModel = ctx.model;
    storedCtx = ctx;
    updateTuiWarnings(ctx, currentModel);

    if (!ctx.model || !isDeepSeek(ctx.model)) return;
    if (!isPeakHour()) return;

    const slot = getActivePeakSlot();
    const minsLeft = minutesUntilPeakEnd();

    sendNotification(
      "⚠️ DEEPSEEK PEAK — Session Started",
      [
        `Model: ${ctx.model.name || ctx.model.id}`,
        `Peak: ${peakSlotLabel(slot)}`,
        minsLeft ? `~${minsLeft} min remaining` : "",
        "2× pricing is active.",
      ]
        .filter(Boolean)
        .join(" · "),
      "Basso"
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // MODEL SELECT — update TUI + desktop notification
  // ═══════════════════════════════════════════════════════════════

  pi.on("model_select", async (event, _ctx) => {
    currentModel = event.model;
    updateTuiWarnings(_ctx, currentModel);

    if (!isDeepSeek(event.model)) return;
    if (!isPeakHour()) return;

    const slot = getActivePeakSlot();
    const minsLeft = minutesUntilPeakEnd();

    sendNotification(
      "⚠️ DEEPSEEK PEAK HOURS — 2× PRICE",
      [
        `Switched to ${event.model.name || event.model.id}.`,
        `Peak: ${peakSlotLabel(slot)}`,
        minsLeft ? `Ends in ~${minsLeft} min` : "",
        "Prices DOUBLED. Ctrl+P to switch models.",
      ]
        .filter(Boolean)
        .join(" · "),
      "Basso"
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // AGENT START — capture peak status, refresh TUI, store ctx
  // ═══════════════════════════════════════════════════════════════

  pi.on("agent_start", async (_event, ctx) => {
    currentModel = ctx.model;
    storedCtx = ctx;
    updateTuiWarnings(ctx, currentModel);
    currentRunStartedInPeak = isDeepSeek(ctx.model) && isPeakHour();
  });

  // ═══════════════════════════════════════════════════════════════
  // BEFORE AGENT START — desktop notification on every peak prompt
  // ═══════════════════════════════════════════════════════════════

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!ctx.model || !isDeepSeek(ctx.model)) return;
    if (!isPeakHour()) return;

    const slot = getActivePeakSlot();
    const minsLeft = minutesUntilPeakEnd();

    sendNotification(
      "⏰ PEAK RATE — DeepSeek Prompt Sent",
      [
        `Peak: ${peakSlotLabel(slot)}`,
        minsLeft ? `~${minsLeft} min until off-peak` : "",
        "You are being charged 2× for this request.",
      ]
        .filter(Boolean)
        .join(" · "),
      "Basso"
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // AGENT END — refresh TUI (peak may have ended), desktop notify
  // ═══════════════════════════════════════════════════════════════

  pi.on("agent_end", async (event, ctx) => {
    updateTuiWarnings(ctx, currentModel);

    if (!ctx.model || !isDeepSeek(ctx.model)) return;

    const wasPeak = currentRunStartedInPeak;

    let totalCost = 0;
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const msg of event.messages) {
      if (msg.role === "assistant" && msg.usage) {
        totalCost += msg.usage.cost?.total ?? 0;
        totalTokens += msg.usage.totalTokens ?? 0;
        totalInput += msg.usage.input ?? 0;
        totalOutput += msg.usage.output ?? 0;
      }
    }

    const prefix = wasPeak ? "⚠️ PEAK " : "";

    const lines: string[] = [];
    if (totalCost > 0) lines.push(`💰 $${totalCost.toFixed(4)}${wasPeak ? " (2× rate)" : ""}`);
    if (totalTokens > 0)
      lines.push(`📊 ${totalTokens} tokens (in:${totalInput} out:${totalOutput})`);
    if (wasPeak) lines.push("🔴 Billed at peak rate");

    sendNotification(`${prefix}✅ DeepSeek Done`, lines.join(" · "));
  });

  // ═══════════════════════════════════════════════════════════════
  // ERROR
  // ═══════════════════════════════════════════════════════════════

  pi.on("message_end", async (event, ctx) => {
    if (!ctx.model || !isDeepSeek(ctx.model)) return;
    if (event.message.role !== "assistant") return;
    if (event.message.stopReason !== "error") return;

    sendNotification(
      "❌ DeepSeek Error",
      event.message.errorMessage || "Unknown error"
    );
  });
}
