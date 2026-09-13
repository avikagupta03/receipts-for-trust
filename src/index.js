// src/index.js
// Usage: node src/index.js 2026-09-10
// Reconstructs your day for the given date (local time) and writes a Google Doc.

require("dotenv").config();
const path = require("path");
const { getAuthorizedClient } = require("./auth");
const { fetchCalendarEvents, fetchGmailMessages } = require("./fetchData");
const { reconstructDay } = require("./reconstruct");
const { writeReportToDoc } = require("./writeDoc");
const { writeHtmlReport } = require("./writeHtmlReport");

async function main() {
  const dateArg = process.argv[2];
  if (!dateArg) {
    console.error("Usage: node src/index.js YYYY-MM-DD");
    process.exit(1);
  }

  const dayStart = new Date(`${dateArg}T00:00:00`);
  const dayEnd = new Date(`${dateArg}T23:59:59`);

  console.log(`Authorizing with Google...`);
  const auth = await getAuthorizedClient();

  console.log(`Fetching calendar events for ${dateArg}...`);
  const events = await fetchCalendarEvents(
    auth,
    dayStart.toISOString(),
    dayEnd.toISOString()
  );
  console.log(`  Found ${events.length} calendar event(s).`);

  console.log(`Fetching emails for ${dateArg}...`);
  const emails = await fetchGmailMessages(
    auth,
    dayStart.toISOString(),
    dayEnd.toISOString()
  );
  console.log(`  Found ${emails.length} email(s).`);

  const evidenceItems = [...events, ...emails].sort((a, b) => {
    const ta = new Date(a.start || a.timestamp).getTime();
    const tb = new Date(b.start || b.timestamp).getTime();
    return ta - tb;
  });

  if (evidenceItems.length === 0) {
    console.log("No evidence found for this day. Nothing to reconstruct.");
    return;
  }

  console.log(`Reconstructing day with Gemini...`);
  const reconstruction = await reconstructDay(evidenceItems);
  console.log(
    `  Reconstructed ${reconstruction.activity_blocks.length} activity block(s), ` +
      `${reconstruction.unaccounted_time.length} unaccounted gap(s).`
  );

  console.log(`Writing report to Google Docs...`);
  const docUrl = await writeReportToDoc(auth, dateArg, reconstruction, evidenceItems);
  console.log(`  Google Doc (verification record): ${docUrl}`);

  console.log(`Generating consumer-facing HTML report...`);
  const outputPath = path.join(__dirname, "..", "reports", `${dateArg}.html`);
  writeHtmlReport(dateArg, reconstruction, evidenceItems, outputPath);

  const fileUrl = `file://${outputPath.replace(/\\/g, "/")}`;
  console.log(`\nReport ready — click to open:\n${fileUrl}\n`);

  console.log(`Done!`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
