# Attendance QR

A QR-code attendance system built as a static site (HTML/CSS/JS only) so it can be hosted for free on GitHub Pages. Ships in **Demo Mode**, which behaves like the real system — sample org, simulated calendar, live QR check-in — with no Google account required.

## Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `attendance-qr`).
2. Push everything in this folder to the repo root:
   ```bash
   git init
   git add .
   git commit -m "Attendance QR"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`. Save.
5. GitHub gives you a URL like `https://<your-username>.github.io/<your-repo>/`. It can take a minute to go live.
6. Open that URL — you're on the landing page in Demo Mode.

No build step, no npm install, no server. Every file here is served as-is.

## What works right now (Demo Mode)

- Simulated Google Calendar: "Sync calendar now" adds a new meeting, exactly like a newly detected calendar event would.
- Automatic Meeting ID, secure token, 6-character short code, and QR code for every meeting.
- Master participant list (12 sample staff) auto-copied into each meeting's attendance sheet, everyone starting **Absent**.
- QR codes are only valid from 15 minutes before start until the meeting ends — outside that window the portal shows "This meeting is currently closed."
- Participant portal: scan QR (camera), or type the short code if scanning fails; first check-in asks for a Staff ID or email, then remembers the device for next time.
- Duplicate check-in protection, live dashboard (present/absent/late/% complete), and CSV export.
- "Reset demo data" puts everything back to the sample state for repeat client demos.

This matches the PRD's Demo Mode requirement: a fake org, a simulated calendar, generated QR codes, and one-click reset, with no live systems touched.

## Turning on Production Mode (real Google Calendar + Sheets)

Production Mode is visible in the UI as a toggle, but it's intentionally a placeholder right now — wiring it up for real needs a few things a static GitHub Pages site can't hold securely on its own:

- **A Google Cloud project** with the Calendar API and Sheets API enabled, and an OAuth 2.0 Client ID (Web application type) with your GitHub Pages URL added as an authorized origin. This part *can* run from a static site using Google Identity Services (`accounts.google.com/gsi/client`) — the browser gets a short-lived access token directly, no server needed.
- **Detecting new calendar events automatically**, though, needs something watching the calendar continuously — either polling on a schedule or a push notification (Calendar API `watch` channel), and a push channel has to point at a server endpoint, which a GitHub Pages site can't be. The practical options are:
  - Poll the Calendar API from the open dashboard tab while someone has it open (simplest, but only checks while the tab is open), or
  - Add a small serverless function (a free tier on Cloudflare Workers, Vercel, or Google Cloud Functions works) that Calendar can notify, which then writes the new meeting into a Google Sheet or database the static site reads from.
- **Writing to Google Sheets** from the browser is doable with the same OAuth token and the Sheets API, once the above is in place.

Short version: everything in Demo Mode is real, working product logic — Production Mode just needs your own Google Cloud credentials plus one small piece of server-side glue for automatic event detection. Happy to build that next once you've got a Google Cloud project ready, or wire up Supabase Edge Functions per the original tech stack if you'd rather have a proper backend from day one.

## File map

```
index.html      landing page (choose Organizer / Check-in, Demo/Production toggle)
admin.html      organizer dashboard (calendar sync, QR + live attendance, reports)
portal.html     participant check-in (scan or code entry)
css/styles.css  design system
js/store.js     the "backend" — localStorage-based in Demo Mode
js/ui.js        shared UI helpers
js/admin.js     dashboard logic
js/portal.js    check-in logic
```
