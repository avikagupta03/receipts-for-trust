// eval/runEval.js
// Runs the ground-truth synthetic day through the REAL reconstructDay()
// function (same code path as production) and scores the output on:
//   1. Coverage        — did every required real activity get captured?
//   2. Hallucination    — did any forbidden (noise) id get cited as evidence?
//   3. Noise filtering   — did the count of filtered noise match expectation?
//   4. Confidence calibration — was the vague item NOT over-reported as high confidence?
//   5. Gap detection     — was the known empty window flagged as unaccounted time?
//
// Usage: node eval/runEval.js
// (requires GEMINI_API_KEY in .env, same as normal runs)

require("dotenv").config();
const { reconstructDay } = require("../src/reconstruct");
const { evidenceItems, expected } = require("./groundTruth");

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function parseTimeRangeToMinutes(rangeStr) {
  // Best-effort parse of strings like "9:00 AM - 9:30 AM" or "9:35 AM - 1:00 PM"
  const match = rangeStr.match(
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

async function runEval() {
  console.log("Running eval against ground-truth synthetic day...\n");

  const result = await reconstructDay(evidenceItems);
  const allCitedIds = new Set(
    result.activity_blocks.flatMap((b) => b.evidence_ids)
  );

  const failures = [];
  const passes = [];

  // --- 1. Coverage: each required activity's ids should be cited SOMEWHERE ---
  expected.requiredActivities.forEach((req) => {
    const coveredIds = req.mustCiteIds.filter((id) => allCitedIds.has(id));
    const fullyCovered = coveredIds.length === req.mustCiteIds.length;
    if (fullyCovered) {
      passes.push(`✅ Coverage: "${req.description}" — all evidence cited`);
    } else {
      failures.push(
        `❌ Coverage: "${req.description}" — missing ids: ${req.mustCiteIds
          .filter((id) => !coveredIds.includes(id))
          .join(", ")}`
      );
    }
  });

  // --- 1b. Clustering check: the Acme call's 3 ids should be in the SAME block ---
  const acmeReq = expected.requiredActivities[0];
  const acmeBlock = result.activity_blocks.find((b) =>
    acmeReq.mustCiteIds.every((id) => b.evidence_ids.includes(id))
  );
  if (acmeBlock) {
    passes.push(`✅ Clustering: Acme call + related emails grouped into one activity block`);
  } else {
    failures.push(
      `❌ Clustering: Acme call evidence was split across multiple blocks instead of one`
    );
  }

  // --- 2. Hallucination: forbidden ids must NEVER appear in any activity block ---
  const hallucinatedIds = expected.forbiddenIds.filter((id) => allCitedIds.has(id));
  if (hallucinatedIds.length === 0) {
    passes.push(`✅ Hallucination: zero noise items cited as real activity`);
  } else {
    failures.push(
      `❌ Hallucination: noise item(s) wrongly cited as activity: ${hallucinatedIds.join(", ")}`
    );
  }

  // --- 3. Noise count matches expectation ---
  const actualNoiseCount = result.noise_filtered_count || 0;
  if (actualNoiseCount === expected.expectedNoiseCount) {
    passes.push(`✅ Noise count: reported ${actualNoiseCount}, matches expected ${expected.expectedNoiseCount}`);
  } else {
    failures.push(
      `❌ Noise count: reported ${actualNoiseCount}, expected ${expected.expectedNoiseCount}`
    );
  }

  // --- 4. Confidence calibration on the vague "Hold" event ---
  const holdReq = expected.requiredActivities.find((r) =>
    r.mustCiteIds.includes("cal_003")
  );
  const holdBlock = result.activity_blocks.find((b) =>
    b.evidence_ids.includes("cal_003")
  );
  if (holdBlock) {
    const rank = { low: 0, medium: 1, high: 2 };
    const maxAllowed = rank[holdReq.expectMaxConfidence];
    const actual = rank[holdBlock.confidence];
    if (actual <= maxAllowed) {
      passes.push(
        `✅ Confidence calibration: vague "Hold" event correctly NOT over-reported (got: ${holdBlock.confidence})`
      );
    } else {
      failures.push(
        `❌ Confidence calibration: vague "Hold" event over-reported as "${holdBlock.confidence}" (should be medium or low)`
      );
    }
  } else {
    failures.push(`❌ Confidence calibration: "Hold" event missing from output entirely`);
  }

  // --- 5. Gap detection: the 9:35am-1:00pm window should show up as unaccounted ---
  const gapWindow = expected.expectedGapWindows[0];
  const gapStartMin = timeToMinutes(gapWindow.startsAfter);
  const gapEndMin = timeToMinutes(gapWindow.endsBefore);

  const gapDetected = (result.unaccounted_time || []).some((gap) => {
    const parsed = parseTimeRangeToMinutes(gap.time_range);
    if (!parsed) return false;
    // consider it a match if the reported gap overlaps meaningfully with the known empty window
    return parsed.startMin < gapEndMin && parsed.endMin > gapStartMin;
  });

  if (gapDetected) {
    passes.push(`✅ Gap detection: known empty window (9:35am-1:00pm) correctly flagged`);
  } else {
    failures.push(
      `❌ Gap detection: known empty window (9:35am-1:00pm) was NOT flagged as unaccounted time`
    );
  }

  // --- Report ---
  console.log("--- RESULTS ---\n");
  [...passes, ...failures].forEach((line) => console.log(line));

  const total = passes.length + failures.length;
  const passRate = ((passes.length / total) * 100).toFixed(0);

  console.log(`\n--- SUMMARY ---`);
  console.log(`Pass rate: ${passes.length}/${total} (${passRate}%)`);
  console.log(`Hallucination rate: ${hallucinatedIds.length > 0 ? "FAIL — non-zero" : "0% (zero hallucinations)"}`);

  console.log(`\nRaw model output (for inspection):`);
  console.log(JSON.stringify(result, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

runEval().catch((err) => {
  console.error("Eval run failed to complete:", err.message);
  process.exit(1);
});
