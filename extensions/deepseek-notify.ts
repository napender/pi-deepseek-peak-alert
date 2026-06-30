import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/**
 * DeepSeek Peak-Hour Notifications (IST timezone)
 *
 * DeepSeek peak hours (UTC): 1:00–4:00 AM and 6:00–10:00 AM
 *   → IST (UTC+5:30): 6:30–9:30 AM and 11:30 AM–3:30 PM
 *
 * During peak hours, prices are 2× regular.
 *
 * Edge cases covered:
 *   ✓ Switch to DeepSeek during peak          → immediate warning
 *   ✓ Session starts with DeepSeek in peak    → immediate warning
 *   ✓ Idle session, peak starts while away    → timer catches transition
 *   ✓ Actively working, peak starts mid-run   → timer notifies; agent_end
 *                                              uses request-START time for
 *                                              accurate peak/off-peak label
 *   ✓ Peak ends mid-run                       → agent_end correctly shows
 *                                              peak rate (billed at start)
 *   ✓ Every prompt during peak                → warned before request sent
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

// ─── Peak‑hour logic ─────────────────────────────────────────────

interface PeakSlot {
  startUtcH: number;
  endUtcH: number;
  startIstH: number;
  endIstH: number;
  label: string;
}

const PEAK_SLOTS: PeakSlot[] = [
  {
    startUtcH: 1,
    endUtcH: 4,
    startIstH: 6.5,
    endIstH: 9.5,
    label: "6:30 AM – 9:30 AM IST",
  },
  {
    startUtcH: 6,
    endUtcH: 10,
    startIstH: 11.5,
    endIstH: 15.5,
    label: "11:30 AM – 3:30 PM IST",
  },
];

function getActivePeakSlot(now: Date = new Date()): PeakSlot | null {
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
    return `🔴 PEAK NOW — ${slot.label} — ~${mins} min remaining — 2× pricing active`;
  }
  const mins = minutesUntilNextPeakStart();
  const nextSlot =
    PEAK_SLOTS.find((s) => {
      const nowH = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
      return nowH < s.startUtcH;
    }) ?? PEAK_SLOTS[0];
  return `🟢 Off-peak — next peak: ${nextSlot.label} (in ~${mins} min)`;
}

// ─── DeepSeek model detection ────────────────────────────────────

function isDeepSeek(model: { provider: string; id: string } | undefined): boolean {
  if (!model) return false;
  return model.provider === "deepseek" || model.id.toLowerCase().includes("deepseek");
}

// ─── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Shared state ───────────────────────────────────────────────
  // Tracks whether the CURRENT agent run was started during peak hours.
  // This is captured at agent_start time so agent_end can report
  // accurately even if peak starts or ends mid-run.
  let currentRunStartedInPeak = false;

  // Track the active model so the timer can check without ctx.
  let currentModel: { provider: string; id: string } | undefined;

  // ── Periodic timer: notify when peak hours BEGIN ───────────────
  // Covers: "user is actively working off-peak, peak starts mid-run"
  //   and  "session is idle, peak starts while away"
  let wasPeakLastCheck = isPeakHour();

  const peakCheckInterval = setInterval(() => {
    const nowPeak = isPeakHour();
    if (nowPeak && !wasPeakLastCheck) {
      // Transitioned INTO peak
      const slot = getActivePeakSlot();
      if (isDeepSeek(currentModel)) {
        sendNotification(
          "⚠️ DEEPSEEK PEAK HOURS STARTED",
          [
            `Peak window: ${slot?.label ?? "now"}`,
            "2× pricing is now active.",
            "Any NEW prompts will be billed at double rate.",
            "Switch with /model or Ctrl+P to avoid.",
          ].join(" · "),
          "Basso"
        );
      }
    }
    // Note: we intentionally do NOT notify when transitioning OUT of peak.
    // The user will notice from the next agent_end showing regular pricing.
    wasPeakLastCheck = nowPeak;
  }, 60_000); // check every 60 seconds

  // ── /deepseek-peak command ─────────────────────────────────────
  pi.registerCommand("deepseek-peak", {
    description: "Check if DeepSeek peak pricing is currently active",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const status = peakStatusText();
      ctx.ui.notify(status, isPeakHour() ? "warning" : "info");
    },
  });

  // ═══════════════════════════════════════════════════════════════
  // TRACK model changes for the timer
  // ═══════════════════════════════════════════════════════════════

  pi.on("model_select", async (event, _ctx) => {
    currentModel = event.model;

    // Warn if switching TO DeepSeek during peak
    if (!isDeepSeek(event.model)) return;
    if (!isPeakHour()) return;

    const slot = getActivePeakSlot();
    const minsLeft = minutesUntilPeakEnd();

    sendNotification(
      "⚠️ DEEPSEEK PEAK HOURS — 2× PRICE",
      [
        `Switched to ${event.model.name || event.model.id}.`,
        `Peak: ${slot?.label}`,
        minsLeft ? `Ends in ~${minsLeft} min` : "",
        "Prices DOUBLED. Ctrl+P to switch models.",
      ]
        .filter(Boolean)
        .join(" · "),
      "Basso"
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // SESSION START
  // ═══════════════════════════════════════════════════════════════

  pi.on("session_start", async (_event, ctx) => {
    currentModel = ctx.model;

    if (!ctx.model || !isDeepSeek(ctx.model)) return;
    if (!isPeakHour()) return;

    const slot = getActivePeakSlot();
    const minsLeft = minutesUntilPeakEnd();

    sendNotification(
      "⚠️ DEEPSEEK PEAK — Session Started",
      [
        `Model: ${ctx.model.name || ctx.model.id}`,
        `Peak: ${slot?.label}`,
        minsLeft ? `~${minsLeft} min remaining` : "",
        "2× pricing is active.",
      ]
        .filter(Boolean)
        .join(" · "),
      "Basso"
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // AGENT START — capture peak status at request time
  // ═══════════════════════════════════════════════════════════════

  pi.on("agent_start", async (_event, ctx) => {
    currentModel = ctx.model;
    // Capture peak status NOW so agent_end is accurate even if
    // peak starts or ends while the agent is still running.
    currentRunStartedInPeak = isDeepSeek(ctx.model) && isPeakHour();
  });

  // ═══════════════════════════════════════════════════════════════
  // BEFORE AGENT START — warn on every prompt during peak
  // ═══════════════════════════════════════════════════════════════

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!ctx.model || !isDeepSeek(ctx.model)) return;
    if (!isPeakHour()) return;

    const slot = getActivePeakSlot();
    const minsLeft = minutesUntilPeakEnd();

    sendNotification(
      "⏰ PEAK RATE — DeepSeek Prompt Sent",
      [
        `Peak: ${slot?.label}`,
        minsLeft ? `~${minsLeft} min until off-peak` : "",
        "You are being charged 2× for this request.",
      ]
        .filter(Boolean)
        .join(" · "),
      "Basso"
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // AGENT END — uses request-START peak status, not current time
  // ═══════════════════════════════════════════════════════════════

  pi.on("agent_end", async (event, ctx) => {
    if (!ctx.model || !isDeepSeek(ctx.model)) return;

    // Use the peak status captured at agent_start, not current time.
    // This correctly handles runs that span an off-peak → peak transition
    // (billed off-peak) or peak → off-peak (billed peak).
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
