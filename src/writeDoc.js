// src/writeDoc.js
// Takes the reconstructed day (activity blocks + unaccounted time)
// and writes it into a new Google Doc as a verification/backing record.
// Raw evidence hashes are never shown — sources are labeled by their
// human-readable title/subject instead.

const { google } = require("googleapis");
const { mergeNearbyGaps } = require("./timeUtils");

function evidenceLabel(item) {
  if (!item) return "Unknown source";
  if (item.type === "calendar_event") {
    return `Calendar: "${item.title}" (${item.start} - ${item.end})`;
  }
  return `Email: "${item.subject}" from ${item.from} at ${item.timestamp}`;
}

async function writeReportToDoc(auth, dateLabel, reconstruction, evidenceItems) {
  const docs = google.docs({ version: "v1", auth });

  const createRes = await docs.documents.create({
    requestBody: { title: `Day Reconstruction — ${dateLabel}` },
  });
  const documentId = createRes.data.documentId;

  const evidenceById = new Map(evidenceItems.map((e) => [e.id, e]));

  let text = `Day Reconstruction — ${dateLabel}\n\n`;
  text += `Reconstructed Activities\n`;
  text += `(${reconstruction.noise_filtered_count || 0} automated/promotional item(s) filtered out as noise)\n\n`;

  reconstruction.activity_blocks.forEach((block, i) => {
    text += `${i + 1}. [${block.time_range}] ${block.summary} (confidence: ${block.confidence})\n`;
    const labels = block.evidence_ids.map((id) => evidenceLabel(evidenceById.get(id)));
    labels.forEach((label) => {
      text += `   - ${label}\n`;
    });
    text += `\n`;
  });

  const mergedGaps = mergeNearbyGaps(reconstruction.unaccounted_time);
  if (mergedGaps.length > 0) {
    text += `Unaccounted Time (no evidence found)\n\n`;
    mergedGaps.forEach((gap) => {
      text += `- [${gap.time_range}] ${gap.note}\n`;
    });
    text += `\n`;
  }

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text,
          },
        },
      ],
    },
  });

  return `https://docs.google.com/document/d/${documentId}/edit`;
}

module.exports = { writeReportToDoc };
