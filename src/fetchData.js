// src/fetchData.js
// Pulls raw evidence from Calendar and Gmail for a given day window.

const { google } = require("googleapis");

/**
 * Fetch calendar events between two ISO timestamps.
 */
async function fetchCalendarEvents(auth, timeMinISO, timeMaxISO) {
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 100,
  });

  const events = res.data.items || [];
  return events.map((e) => ({
    type: "calendar_event",
    id: e.id,
    title: e.summary || "(no title)",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    attendees: (e.attendees || []).map((a) => a.email),
    location: e.location || null,
    description: e.description || null,
  }));
}

/**
 * Fetch Gmail messages (sent or received) within a day window.
 * Gmail search uses after:/before: on dates (YYYY/MM/DD), not timestamps,
 * so we filter precisely by internalDate after fetching.
 */
async function fetchGmailMessages(auth, timeMinISO, timeMaxISO) {
  const gmail = google.gmail({ version: "v1", auth });

  const afterDate = formatDateForGmailQuery(timeMinISO);
  const beforeDate = formatDateForGmailQuery(timeMaxISO, 1); // +1 day, Gmail 'before' is exclusive-ish

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: `after:${afterDate} before:${beforeDate}`,
    maxResults: 50,
  });

  const messages = listRes.data.messages || [];
  const detailed = [];

  for (const m of messages) {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: m.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "To", "Date"],
    });
    // Small delay between calls to stay well under Gmail API per-user quota
    // when a day has many emails (avoids bursting 50 requests in under a second).
    await new Promise((resolve) => setTimeout(resolve, 150));

    const headers = {};
    (msg.data.payload?.headers || []).forEach((h) => {
      headers[h.name.toLowerCase()] = h.value;
    });

    const internalDate = Number(msg.data.internalDate); // ms since epoch
    if (internalDate < Date.parse(timeMinISO) || internalDate > Date.parse(timeMaxISO)) {
      continue; // extra precision filter beyond Gmail's day-level query
    }

    detailed.push({
      type: "email",
      id: m.id,
      subject: headers["subject"] || "(no subject)",
      from: headers["from"] || null,
      to: headers["to"] || null,
      timestamp: new Date(internalDate).toISOString(),
      snippet: msg.data.snippet || "",
    });
  }

  return detailed;
}

function formatDateForGmailQuery(isoString, addDays = 0) {
  const d = new Date(isoString);
  d.setDate(d.getDate() + addDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

module.exports = { fetchCalendarEvents, fetchGmailMessages };
