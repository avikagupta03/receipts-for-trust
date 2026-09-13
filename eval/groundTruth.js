// eval/groundTruth.js
// A synthetic "fake day" of evidence with KNOWN correct answers baked in.
// Used to measure the reconstruction pipeline's accuracy without needing
// real Google API calls each time.
//
// Design choices, deliberately included to stress-test the pipeline:
// - Two genuine activities that SHOULD be clustered together (standup thread)
// - One genuine activity with only a single piece of evidence
// - A pile of promotional/newsletter noise that should be filtered out
// - A deliberate 2+ hour gap with zero evidence (should be flagged)
// - One ambiguous item (calendar hold with vague title) to test confidence calibration

const evidenceItems = [
  // --- Real activity 1: a client call, with calendar + 2 related emails (should cluster) ---
  {
    id: "cal_001",
    type: "calendar_event",
    title: "Client sync — Acme Corp",
    start: "2026-09-10T09:00:00.000Z",
    end: "2026-09-10T09:30:00.000Z",
    attendees: ["priya@acmecorp.com"],
    location: "Google Meet",
    description: "Discuss Q3 rollout timeline",
  },
  {
    id: "email_001",
    type: "email",
    subject: "Re: Q3 rollout timeline",
    from: "priya@acmecorp.com",
    to: "me@example.com",
    timestamp: "2026-09-10T08:45:00.000Z",
    snippet: "Sending over the deck before our call in a bit.",
  },
  {
    id: "email_002",
    type: "email",
    subject: "Re: Q3 rollout timeline",
    from: "me@example.com",
    to: "priya@acmecorp.com",
    timestamp: "2026-09-10T09:35:00.000Z",
    snippet: "Thanks for the call — following up with the revised dates we agreed on.",
  },

  // --- Real activity 2: single standalone event, no related emails ---
  {
    id: "cal_002",
    type: "calendar_event",
    title: "Dentist appointment",
    start: "2026-09-10T13:00:00.000Z",
    end: "2026-09-10T14:00:00.000Z",
    attendees: [],
    location: "Downtown Dental",
    description: null,
  },

  // --- Ambiguous item: vague calendar hold, should get LOWER confidence ---
  {
    id: "cal_003",
    type: "calendar_event",
    title: "Hold",
    start: "2026-09-10T16:00:00.000Z",
    end: "2026-09-10T16:30:00.000Z",
    attendees: [],
    location: null,
    description: null,
  },

  // --- Noise: should ALL be filtered out ---
  {
    id: "noise_001",
    type: "email",
    subject: "🔥 50% off everything this weekend only",
    from: "deals@retailstore.com",
    to: "me@example.com",
    timestamp: "2026-09-10T07:00:00.000Z",
    snippet: "Don't miss our biggest sale of the season.",
  },
  {
    id: "noise_002",
    type: "email",
    subject: "Your weekly LinkedIn digest",
    from: "newsletters-noreply@linkedin.com",
    to: "me@example.com",
    timestamp: "2026-09-10T07:30:00.000Z",
    snippet: "See what your network has been up to this week.",
  },
  {
    id: "noise_003",
    type: "email",
    subject: "Monthly portfolio statement",
    from: "statements@fundmanager.com",
    to: "me@example.com",
    timestamp: "2026-09-10T10:15:00.000Z",
    snippet: "Your monthly account statement is now available.",
  },
  {
    id: "noise_004",
    type: "email",
    subject: "New jobs matching your profile",
    from: "jobs-noreply@linkedin.com",
    to: "me@example.com",
    timestamp: "2026-09-10T18:20:00.000Z",
    snippet: "5 new roles that match your experience.",
  },

  // Note: deliberate ~2.5 hour gap between dentist (ends 14:00) and hold (16:00)
  // is only 2 hours, so let's also leave a real gap: 16:30 -> end of day 18:00+
  // is a gap too, and 09:35 -> 13:00 is a ~3h15m gap (should be flagged).
];

// The known-correct answer key a perfect system should produce.
const expected = {
  // Activities that MUST appear (by concept, not exact wording)
  requiredActivities: [
    {
      description: "Client call/sync with Acme Corp about Q3 rollout",
      mustCiteIds: ["cal_001", "email_001", "email_002"], // should be clustered together
      expectMinConfidence: "high",
    },
    {
      description: "Dentist appointment",
      mustCiteIds: ["cal_002"],
      expectMinConfidence: "high",
    },
    {
      description: "Vague calendar hold",
      mustCiteIds: ["cal_003"],
      expectMaxConfidence: "medium", // should NOT be reported as high confidence — title gives no real info
    },
  ],
  // IDs that must NEVER be cited in any activity block (they're noise)
  forbiddenIds: ["noise_001", "noise_002", "noise_003", "noise_004"],
  // Expect noise_filtered_count to be exactly 4
  expectedNoiseCount: 4,
  // Expect at least one gap flagged in this window (09:35 - 13:00 is empty)
  expectedGapWindows: [{ startsAfter: "09:35", endsBefore: "13:00" }],
};

module.exports = { evidenceItems, expected };
