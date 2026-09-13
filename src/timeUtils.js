// src/timeUtils.js
// Shared helpers for parsing "9:00 AM - 9:30 AM" style ranges into minutes,
// formatting back to display strings, and merging nearby gaps together so
// the UI shows one clean range instead of several fragmented ones.

function parseTimeRangeToMinutes(rangeStr) {
  const match = String(rangeStr).match(
    /(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (!match) return null;
  const to24 = (h, m, ampm) => {
    h = Number(h);
    if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
    if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
    return h * 60 + Number(m);
  };
  return {
    startMin: to24(match[1], match[2], match[3]),
    endMin: to24(match[4], match[5], match[6]),
  };
}

function minutesToTimeStr(totalMin) {
  let h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Merges gap objects ({ time_range, note }) whose ranges are close together
 * (separated by less than `thresholdMinutes` of real activity) into a single
 * combined range. Gaps that fail to parse are dropped (defensive).
 *
 * @param {Array<{time_range: string, note?: string}>} gaps
 * @param {number} thresholdMinutes - merge gaps if the space between them is <= this
 * @returns {Array<{time_range: string, note: string}>}
 */
function mergeNearbyGaps(gaps, thresholdMinutes = 45) {
  const parsed = (gaps || [])
    .map((g) => {
      const range = parseTimeRangeToMinutes(g.time_range);
      return range ? { ...range, original: g } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin);

  if (parsed.length === 0) return [];

  const merged = [parsed[0]];

  for (let i = 1; i < parsed.length; i++) {
    const last = merged[merged.length - 1];
    const current = parsed[i];
    if (current.startMin - last.endMin <= thresholdMinutes) {
      // extend the previous merged range
      last.endMin = Math.max(last.endMin, current.endMin);
    } else {
      merged.push(current);
    }
  }

  return merged.map((m) => ({
    time_range: `${minutesToTimeStr(m.startMin)} - ${minutesToTimeStr(m.endMin)}`,
    note: "no evidence found for this period",
  }));
}

module.exports = { parseTimeRangeToMinutes, minutesToTimeStr, mergeNearbyGaps };
