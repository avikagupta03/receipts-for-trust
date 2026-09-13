// src/reconstruct.js
// Takes raw calendar events + emails and asks Gemini (free tier) to reconstruct
// a factual, cited narrative of the day. Designed to avoid hallucination:
// every claim must cite a specific evidence id, and gaps must be flagged
// rather than filled in.
//
// Also handles free-tier rate limits (429 errors) with exponential backoff,
// since the free tier caps requests per minute.

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are a forensic day-reconstruction assistant. You are given a list of evidence items (calendar events and emails) with timestamps and ids for a single day.

Your job:
1. FIRST, silently classify each evidence item as either:
   - SIGNAL: a real personal or professional activity — a meeting, a genuine 1:1 email exchange with a real person, a task you actively did.
   - NOISE: automated/promotional content — newsletters, marketing emails, LinkedIn digests, mutual fund/portfolio disclosures, "no-reply" bulk senders, shopping promos, job-alert digests, subscription content. If the sender looks like a bulk/no-reply/marketing address, or the subject reads like an ad or digest, treat it as NOISE even if the topic is work-adjacent.
2. Using ONLY the SIGNAL items, group them into "activity blocks" — e.g. multiple emails plus a meeting about the same topic become one activity block, not separate lines.
3. For each activity block, write ONE factual sentence describing what happened, and list the exact evidence ids that support it.
4. Identify time gaps of 90+ minutes during working hours (9am-6pm) with NO signal evidence at all, and list them as "unaccounted_time" blocks. Do NOT guess what happened during a gap. Note: a gap can exist even if noise items (newsletters etc.) exist in that window, since noise is not evidence of activity.
5. NEVER state that something happened unless it is directly supported by an evidence id. If you are not sure, lower your confidence field instead of guessing.
6. Report how many total NOISE items you filtered out, so nothing silently disappears.
7. Output ONLY valid JSON, no markdown, no commentary, matching exactly this shape:

{
  "activity_blocks": [
    {
      "time_range": "string, e.g. '9:00 AM - 9:30 AM'",
      "summary": "one factual sentence, no speculation",
      "evidence_ids": ["id1", "id2"],
      "confidence": "high" | "medium" | "low"
    }
  ],
  "unaccounted_time": [
    { "time_range": "string", "note": "no evidence found for this period" }
  ],
  "noise_filtered_count": 0
}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls an async function with exponential backoff retry on rate-limit (429) errors.
 * Free-tier Gemini caps requests per minute, so bursts (like eval loops) need this.
 */
async function withRetry(fn, { maxRetries = 5, baseDelayMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRateLimit =
        err?.status === 429 ||
        /rate limit|quota|429/i.test(err?.message || "");

      if (!isRateLimit || attempt === maxRetries) {
        throw err;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.log(
        `  Rate limited by Gemini free tier. Waiting ${delay / 1000}s before retry ${
          attempt + 1
        }/${maxRetries}...`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * @param {Array} evidenceItems - merged calendar + email items, each with an id/type/timestamp
 * @returns {Promise<{activity_blocks: Array, unaccounted_time: Array}>}
 */
async function reconstructDay(evidenceItems) {
  const evidenceForPrompt = evidenceItems.map((item) => {
    if (item.type === "calendar_event") {
      return {
        id: item.id,
        type: "calendar_event",
        title: item.title,
        start: item.start,
        end: item.end,
        attendees: item.attendees,
        location: item.location,
      };
    }
    return {
      id: item.id,
      type: "email",
      subject: item.subject,
      from: item.from,
      to: item.to,
      timestamp: item.timestamp,
      snippet: item.snippet,
    };
  });

  const userMessage = `Evidence items for this day:\n\n${JSON.stringify(
    evidenceForPrompt,
    null,
    2
  )}`;

  // Model is configurable via .env in case free-tier quota runs out on the
  // default model — gemini-3.1-flash-lite has a much higher daily request
  // allowance if gemini-3.6-flash gets rate-limited during heavy eval runs.
  const modelName = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const result = await withRetry(() => model.generateContent(userMessage));
  const raw = result.response.text();
  const cleaned = raw.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse Gemini's response as JSON. Raw output:\n${raw}`
    );
  }

  // Defensive check: strip any evidence_ids that don't actually exist,
  // to hard-guarantee zero hallucinated citations even if the model slips.
  const validIds = new Set(evidenceItems.map((e) => e.id));
  parsed.activity_blocks = (parsed.activity_blocks || []).map((block) => ({
    ...block,
    evidence_ids: (block.evidence_ids || []).filter((id) => validIds.has(id)),
  }));

  return parsed;
}

module.exports = { reconstructDay, withRetry, sleep };
