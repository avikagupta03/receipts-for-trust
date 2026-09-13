// src/writeHtmlReport.js
// Generates a polished, consumer-facing HTML report of the reconstructed day.
// No raw evidence hashes are shown — sources are referenced by human-readable
// labels (event title / email subject) inside a collapsible details element.

const fs = require("fs");
const path = require("path");
const { mergeNearbyGaps } = require("./timeUtils");

function confidenceBadge(confidence) {
  const colors = {
    high: { bg: "#e8f5ee", fg: "#1e8e5a", dot: "#34a853", label: "High confidence" },
    medium: { bg: "#fef7e0", fg: "#b06a00", dot: "#f9ab00", label: "Medium confidence" },
    low: { bg: "#fce8e6", fg: "#c5221f", dot: "#ea4335", label: "Low confidence" },
  };
  const c = colors[confidence] || colors.medium;
  return `<span style="display:inline-flex;align-items:center;gap:6px;background:${c.bg};color:${c.fg};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;white-space:nowrap;">
    <span style="width:6px;height:6px;border-radius:50%;background:${c.dot};"></span>${c.label}
  </span>`;
}

function evidenceIcon(item) {
  return item && item.type === "calendar_event" ? "📅" : "✉️";
}

function evidenceLabel(item) {
  if (!item) return "Unknown source";
  if (item.type === "calendar_event") return item.title;
  return item.subject;
}

function formatDateLabel(dateStr) {
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function renderActivityCard(block, evidenceById, index) {
  const sources = block.evidence_ids
    .map((id) => evidenceById.get(id))
    .filter(Boolean);

  const sourcesHtml =
    sources.length > 0
      ? `<details style="margin-top:12px;">
           <summary style="cursor:pointer;color:#5f6368;font-size:13px;font-weight:500;list-style:none;display:flex;align-items:center;gap:4px;">
             <span style="display:inline-block;transition:transform 0.15s;">▸</span>
             ${sources.length} source${sources.length > 1 ? "s" : ""}
           </summary>
           <div style="margin:10px 0 0 0;padding:10px 14px;background:#f8f9fa;border-radius:8px;">
             ${sources
               .map(
                 (s) =>
                   `<div style="display:flex;gap:8px;padding:4px 0;color:#5f6368;font-size:13px;">
                      <span>${evidenceIcon(s)}</span><span>${escapeHtml(evidenceLabel(s))}</span>
                    </div>`
               )
               .join("\n")}
           </div>
         </details>`
      : "";

  return `
    <div style="position:relative;padding-left:28px;padding-bottom:22px;">
      <div style="position:absolute;left:0;top:4px;width:12px;height:12px;border-radius:50%;background:#4285f4;border:3px solid #fff;box-shadow:0 0 0 1.5px #dbe4f5;"></div>
      <div style="background:#fff;border:1px solid #e8eaed;border-radius:14px;padding:18px 20px;box-shadow:0 1px 3px rgba(60,64,67,0.08);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="font-weight:700;color:#202124;font-size:13px;letter-spacing:0.02em;">${escapeHtml(block.time_range)}</span>
          ${confidenceBadge(block.confidence)}
        </div>
        <div style="color:#3c4043;font-size:15px;line-height:1.55;">${escapeHtml(block.summary)}</div>
        ${sourcesHtml}
      </div>
    </div>
  `;
}

function renderGap(gap) {
  return `
    <div style="position:relative;padding-left:28px;padding-bottom:22px;">
      <div style="position:absolute;left:2px;top:6px;width:8px;height:8px;border-radius:50%;background:#dadce0;"></div>
      <div style="border:1px dashed #dadce0;border-radius:14px;padding:14px 20px;color:#80868b;font-size:13px;">
        <strong style="color:#5f6368;">${escapeHtml(gap.time_range)}</strong> — ${escapeHtml(gap.note)}
      </div>
    </div>
  `;
}

function statPill(value, label) {
  return `
    <div style="text-align:center;flex:1;">
      <div style="font-size:22px;font-weight:700;color:#202124;">${value}</div>
      <div style="font-size:11px;color:#5f6368;text-transform:uppercase;letter-spacing:0.04em;margin-top:2px;">${label}</div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeHtmlReport(dateLabel, reconstruction, evidenceItems, outputPath) {
  const evidenceById = new Map(evidenceItems.map((e) => [e.id, e]));

  const activityCards = reconstruction.activity_blocks
    .map((block, i) => renderActivityCard(block, evidenceById, i))
    .join("\n");

  const mergedGaps = mergeNearbyGaps(reconstruction.unaccounted_time);
  const gapCards = mergedGaps.map(renderGap).join("\n");

  const noiseCount = reconstruction.noise_filtered_count || 0;
  const activityCount = reconstruction.activity_blocks.length;
  const totalEvidence = reconstruction.activity_blocks.reduce(
    (sum, b) => sum + b.evidence_ids.length,
    0
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Day Reconstruction — ${escapeHtml(dateLabel)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;background:linear-gradient(180deg,#f0f3fb 0%,#f8f9fa 220px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;min-height:100vh;">
  <div style="max-width:640px;margin:0 auto;padding:48px 20px 60px;">

    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;background:linear-gradient(135deg,#4285f4,#7b61ff);color:#fff;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:6px 14px;border-radius:20px;margin-bottom:16px;">
        Day Reconstruction
      </div>
      <h1 style="font-size:26px;color:#202124;margin:0 0 6px;font-weight:700;">Your Day, Reconstructed</h1>
      <p style="color:#5f6368;font-size:14px;margin:0;">${escapeHtml(formatDateLabel(dateLabel))}</p>
    </div>

    <div style="background:#fff;border:1px solid #e8eaed;border-radius:16px;padding:20px 16px;margin-bottom:32px;display:flex;box-shadow:0 1px 3px rgba(60,64,67,0.06);">
      ${statPill(activityCount, "Activities")}
      ${statPill(totalEvidence, "Sources cited")}
      ${statPill(noiseCount, "Filtered as noise")}
    </div>

    <h2 style="font-size:13px;color:#5f6368;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 16px;font-weight:700;">What happened</h2>
    <div>
      ${activityCards || "<p style='color:#9aa0a6;padding-left:28px;'>No verified activity found for this day.</p>"}
      ${gapCards}
    </div>

    <p style="color:#bdc1c6;font-size:12px;margin-top:28px;text-align:center;line-height:1.6;">
      Every activity above is backed by real calendar or email evidence — nothing is guessed.<br/>
      Unaccounted time is shown honestly rather than filled in.
    </p>
  </div>
</body>
</html>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf8");
  return outputPath;
}

module.exports = { writeHtmlReport };
