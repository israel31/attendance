/* admin.js — organizer dashboard */

let activeMeetingId = null;
let qrRenderer = null;

function baseCheckInUrl() {
  const path = location.pathname.replace(/index\.html$|admin\.html$/, '');
  return `${location.origin}${path}portal.html`;
}

function meetingStateBadge(meeting) {
  const s = Store.meetingWindowStatus(meeting);
  if (s.state === 'open') return `<span class="badge badge-good"><span class="dot pulse"></span> Live</span>`;
  if (s.state === 'upcoming') return `<span class="badge badge-warn">Upcoming</span>`;
  return `<span class="badge badge-bad">Closed</span>`;
}

function renderMeetingList() {
  const list = document.getElementById('meeting-list');
  const meetings = Store.getMeetings();
  if (!meetings.length) {
    list.innerHTML = `<div class="empty">No meetings yet. Sync the calendar or start an instant meeting.</div>`;
    return;
  }
  list.innerHTML = meetings.map(m => {
    const active = m.id === activeMeetingId ? 'style="border-color:var(--blue);"' : '';
    return `
      <div class="card" style="padding:16px 18px;cursor:pointer;margin-top:10px;" ${active} data-id="${m.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div>
            <div style="font-weight:700;font-size:14.5px;">${m.title}</div>
            <div style="font-size:12.5px;color:var(--ink-soft);margin-top:2px;">${fmtDateTime(m.start)} → ${fmtTime(m.end)} · ${m.location}</div>
          </div>
          ${meetingStateBadge(m)}
        </div>
      </div>`;
  }).join('');
  list.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => selectMeeting(el.dataset.id));
  });
}

function selectMeeting(id) {
  activeMeetingId = id;
  renderMeetingList();
  renderDashboard();
}

function renderDashboard() {
  const panel = document.getElementById('dashboard-panel');
  const meeting = Store.getMeeting(activeMeetingId);
  if (!meeting) {
    panel.innerHTML = `<div class="card"><div class="empty">Select a meeting on the left to display its QR code and live attendance.</div></div>`;
    return;
  }

  const state = Store.meetingWindowStatus(meeting);
  const rows = Store.getAttendance(activeMeetingId);
  const present = rows.filter(r => r.status === 'Present').length;
  const late = rows.filter(r => r.status === 'Late').length;
  const absent = rows.filter(r => r.status === 'Absent').length;
  const pct = rows.length ? Math.round(((present + late) / rows.length) * 100) : 0;
  const checkInUrl = `${baseCheckInUrl()}?m=${meeting.id}&t=${meeting.token}`;

  panel.innerHTML = `
    <div class="grid-2">
      <div class="card viewfinder">
        <span class="vf-tr"></span><span class="vf-br"></span>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <div>
            <div class="card-title">${meeting.title}</div>
            <div class="card-sub">${fmtDateTime(meeting.start)} — ${fmtTime(meeting.end)} · ${meeting.location}</div>
          </div>
          ${meetingStateBadge(meeting)}
        </div>
        <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-top:6px;">
          <div class="qr-box"><div id="qr-canvas"></div></div>
          <div style="flex:1;min-width:180px;">
            <div style="font-size:12px;font-weight:600;color:var(--ink-soft);margin-bottom:6px;">Or enter this code</div>
            <div class="code-chip">${meeting.meetingCode}</div>
            <p style="margin-top:14px;font-size:12.5px;">
              ${state.state === 'open' ? 'Valid now. Closes automatically at meeting end.' :
                state.state === 'upcoming' ? `Opens 15 minutes before start, at ${fmtTime(state.opensAt)}.` :
                'This meeting is currently closed.'}
            </p>
            <button class="btn btn-ghost" style="margin-top:14px;font-size:12.5px;padding:9px 14px;" id="copy-link-btn">Copy check-in link</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Live status</div>
        <div class="card-sub">Updates automatically — no refresh needed.</div>
        <div class="grid-3" style="grid-template-columns:1fr 1fr;">
          <div class="stat"><div class="num">${present + late}</div><div class="lbl">Present</div></div>
          <div class="stat"><div class="num">${absent}</div><div class="lbl">Absent</div></div>
          <div class="stat"><div class="num">${late}</div><div class="lbl">Late arrivals</div></div>
          <div class="stat"><div class="num">${pct}%</div><div class="lbl">Complete</div></div>
        </div>
        <div class="divider"></div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-ghost btn-block" id="export-csv-btn" style="font-size:13px;">Export CSV</button>
          <button class="btn btn-ghost btn-block" id="reset-meeting-btn" style="font-size:13px;">Reset check-ins</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Attendance sheet</div>
      <div class="card-sub">Auto-generated from the master participant list · everyone starts Absent.</div>
      <table>
        <thead><tr><th>Staff ID</th><th>Name</th><th>Department</th><th>Status</th><th>Check-in</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="mono">${r.staffId}</td>
              <td>${r.name}</td>
              <td>${r.department}</td>
              <td>${statusBadge(r.status)}</td>
              <td>${fmtTime(r.checkInTime)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  renderQR(checkInUrl);

  document.getElementById('copy-link-btn').addEventListener('click', () => {
    navigator.clipboard?.writeText(checkInUrl);
    toast('Check-in link copied.', 'good');
  });
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    const { filename, content } = Store.toCSV(activeMeetingId);
    downloadFile(filename, content);
  });
  document.getElementById('reset-meeting-btn').addEventListener('click', () => {
    if (!confirm('Reset all check-ins for this meeting back to Absent?')) return;
    const reset = Store.getAttendance(activeMeetingId).map(r => ({ ...r, status: 'Absent', checkInTime: null, deviceId: null }));
    Store.saveAttendance(activeMeetingId, reset);
    renderDashboard();
    toast('Check-ins reset.', '');
  });
}

function statusBadge(status) {
  if (status === 'Present') return `<span class="badge badge-good">Present</span>`;
  if (status === 'Late') return `<span class="badge badge-warn">Late</span>`;
  return `<span class="badge badge-bad">Absent</span>`;
}

function renderQR(text) {
  const holder = document.getElementById('qr-canvas');
  holder.innerHTML = '';
  new QRCode(holder, { text, width: 168, height: 168, colorDark: '#0F1B33', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  renderMeetingList();
  renderDashboard();

  document.getElementById('sync-calendar-btn').addEventListener('click', () => {
    const m = Store.syncCalendar();
    toast(`New event detected: "${m.title}". Sheet and QR created.`, 'good');
    renderMeetingList();
  });

  document.getElementById('instant-meeting-btn').addEventListener('click', () => {
    const title = prompt('Meeting title', 'Quick Meeting');
    if (title === null) return;
    const m = Store.createInstantMeeting(title);
    toast('Instant meeting started — live now.', 'good');
    selectMeeting(m.id);
  });

  document.getElementById('reset-demo-btn')?.addEventListener('click', () => {
    if (!confirm('Reset all demo data back to sample state?')) return;
    Store.resetDemoData();
    activeMeetingId = null;
    renderMeetingList();
    renderDashboard();
    toast('Demo data reset.', '');
  });

  // Live updates: poll locally + listen cross-tab (e.g. participant portal open elsewhere)
  setInterval(() => { renderMeetingList(); renderDashboard(); }, 2500);
  window.addEventListener('storage', () => { renderMeetingList(); renderDashboard(); });
});
