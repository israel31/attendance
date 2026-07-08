let activeMeetingId = null;
let attendanceRows = [];
let previousStatuses = {};

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderMeetingList() {
  const list = document.getElementById('meeting-list');
  const meetings = Store.getMeetings();

  if (!meetings.length) {
    list.innerHTML = '<li class="panel-empty" style="min-height:120px"><p>No meetings scheduled yet. Configure a sheet and click schedule.</p></li>';
    return;
  }

  list.innerHTML = meetings.map(m => {
    const window = Store.meetingWindowStatus(m);
    const badgeClass = `badge-${window.state}`;
    const badgeLabel = window.state;
    const isActive = m.id === activeMeetingId ? ' active' : '';
    const presentCount = m.id === activeMeetingId
      ? attendanceRows.filter(r => r.status === 'Present' || r.status === 'Late').length
      : null;

    return `
      <li class="meeting-item${isActive}" data-id="${escapeAttr(m.id)}" onclick="selectMeeting('${escapeAttr(m.id)}')">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="meta">
          <span class="badge ${badgeClass}">${badgeLabel}</span>
          <span class="meeting-code">${escapeHtml(m.meetingCode)}</span>
          <span>${formatDateTime(m.start)}</span>
          ${presentCount !== null ? `<span>${presentCount} checked in</span>` : ''}
        </div>
      </li>`;
  }).join('');
}

function renderDashboard() {
  const panel = document.getElementById('dashboard-panel');
  const meeting = Store.getMeeting(activeMeetingId);

  if (!meeting) {
    panel.innerHTML = `
      <div class="panel-empty">
        <div class="icon">📋</div>
        <p>Select a meeting from the sidebar to view live attendance.</p>
      </div>`;
    return;
  }

  const window = Store.meetingWindowStatus(meeting);
  const present = attendanceRows.filter(r => r.status === 'Present').length;
  const late = attendanceRows.filter(r => r.status === 'Late').length;
  const absent = attendanceRows.filter(r => r.status === 'Absent').length;
  const portalUrl = buildPortalUrl(meeting.id, meeting.meetingCode);

  panel.innerHTML = `
    <div class="meeting-header">
      <div>
        <h2>${escapeHtml(meeting.title)}</h2>
        <div class="details">
          <span class="badge badge-${window.state}">${window.state}</span>
          &nbsp;·&nbsp; Code: <span class="meeting-code">${escapeHtml(meeting.meetingCode)}</span>
          &nbsp;·&nbsp; ${formatDateTime(meeting.start)} – ${formatDateTime(meeting.end)}
          ${meeting.location ? `&nbsp;·&nbsp; ${escapeHtml(meeting.location)}` : ''}
        </div>
      </div>
      <div class="meeting-actions" style="display:flex; gap:10px;">
        <button class="btn btn-secondary" id="re-fetch-sheet-btn">Sync Sheet Roster</button>
        <button class="btn btn-primary" id="download-report-btn">Download CSV Report</button>
      </div>
    </div>

    <div class="qr-section">
      <div id="qr-canvas"></div>
      <div class="qr-info">
        <h3>Participant Check-in QR</h3>
        <p>Scan with any phone camera or open the portal link below.</p>
        <p class="qr-url">${escapeHtml(portalUrl)}</p>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card present"><div class="value">${present}</div><div class="label">Present</div></div>
      <div class="stat-card late"><div class="value">${late}</div><div class="label">Late</div></div>
      <div class="stat-card absent"><div class="value">${absent}</div><div class="label">Absent</div></div>
      <div class="stat-card"><div class="value">${attendanceRows.length}</div><div class="label">Total</div></div>
    </div>

    <div class="grid-wrapper">
      <table class="attendance-grid">
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Department</th>
            <th>Status</th>
            <th>Check-in Time</th>
          </tr>
        </thead>
        <tbody id="attendance-tbody">
          ${renderAttendanceRows()}
        </tbody>
      </table>
    </div>`;

  renderQRCode(portalUrl);
}

function renderAttendanceRows() {
  return attendanceRows.map(r => {
    const key = r.staffId;
    const flashed = previousStatuses[key] && previousStatuses[key] !== r.status && r.status !== 'Absent';
    const flashClass = flashed ? ' flash-update' : '';
    previousStatuses[key] = r.status;

    return `
      <tr class="status-${r.status}${flashClass}" data-staff="${escapeAttr(r.staffId)}">
        <td>${escapeHtml(r.staffId)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.department)}</td>
        <td><span class="status-pill ${r.status}">${r.status}</span></td>
        <td>${r.checkInTime ? formatDateTime(r.checkInTime) : '—'}</td>
      </tr>`;
  }).join('');
}

function buildPortalUrl(meetingId, code) {
  const base = window.location.href.replace(/admin\.html.*$/, 'portal.html');
  return `${base}?m=${encodeURIComponent(meetingId)}&t=${encodeURIComponent(code)}`;
}

function renderQRCode(url) {
  const container = document.getElementById('qr-canvas');
  if (!container || typeof QRCode === 'undefined') return;
  container.innerHTML = '';
  new QRCode(container, {
    text: url,
    width: 140,
    height: 140,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
  const syncBtn = document.getElementById('sync-calendar-btn');
  const statusEl = document.getElementById('sync-status');
  const urlInput = document.getElementById('sheet-url-input');
  
  const modal = document.getElementById('schedule-modal');

  if (urlInput) urlInput.value = Store.getStoredSheetUrl();

  document.getElementById('save-sheet-url-btn')?.addEventListener('click', async () => {
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) { alert("Please enter a valid Google Sheet shared link."); return; }
    try {
      statusEl.textContent = 'Verifying sheet...';
      await Store.fetchParticipantsFromGoogleSheet(rawUrl);
      Store.setStoredSheetUrl(rawUrl);
      statusEl.textContent = 'Sheet verified!';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
      if (activeMeetingId) selectMeeting(activeMeetingId);
    } catch (err) {
      alert("Verification Failed: " + err.message);
      statusEl.textContent = 'Verification failed';
    }
  });

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    statusEl.textContent = 'Refreshing list…';
    try {
      await Store.syncCalendar();
      renderMeetingList();
      statusEl.textContent = 'List Refreshed';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (err) {
      statusEl.textContent = 'Refresh failed';
    } finally {
      syncBtn.disabled = false;
    }
  });

  try {
    await Store.syncCalendar();
    renderMeetingList();
    const list = Store.getMeetings();
    if (list.length > 0) selectMeeting(list[0].id);
  } catch {
    statusEl.textContent = 'Failed to load initial meetings.';
  }

  window.selectMeeting = async function (id) {
    activeMeetingId = id;
    renderMeetingList();

    attendanceRows = await Store.getAttendance(id, false);
    previousStatuses = {};
    attendanceRows.forEach(r => { previousStatuses[r.staffId] = r.status; });
    renderDashboard();

    Store.listenToAttendanceUpdates(id, async () => {
      attendanceRows = await Store.getAttendance(id, false);
      renderDashboard();
      renderMeetingList();
    });
  };

  document.getElementById('instant-meeting-btn').addEventListener('click', () => {
    const localNow = new Date();
    localNow.setMinutes(localNow.getMinutes() - localNow.getTimezoneOffset());
    document.getElementById('modal-start').value = localNow.toISOString().slice(0, 16);
    
    // Set default values for granular options
    document.getElementById('modal-duration-hours').value = 1;
    document.getElementById('modal-duration-minutes').value = 0;
    
    modal.classList.remove('hidden');
  });

  document.getElementById('modal-cancel-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  document.getElementById('modal-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('modal-title').value.trim();
    const startVal = document.getElementById('modal-start').value;
    
    const inputHours = parseInt(document.getElementById('modal-duration-hours').value, 10) || 0;
    const inputMinutes = parseInt(document.getElementById('modal-duration-minutes').value, 10) || 0;

    if (!title) { alert("Please input a meeting title."); return; }
    if (!startVal) { alert("Please specify a starting time execution window."); return; }
    
    const totalDurationMinutes = (inputHours * 60) + inputMinutes;
    if (totalDurationMinutes <= 0) { alert("Please specify a duration greater than 0 minutes."); return; }

    modal.classList.add('hidden');
    statusEl.textContent = 'Scheduling meeting...';

    const localMeeting = await Store.createScheduledMeeting(title, startVal, totalDurationMinutes);
    if (localMeeting) {
      document.getElementById('modal-title').value = '';
      statusEl.textContent = 'Meeting Scheduled!';
      await Store.syncCalendar();
      renderMeetingList();
      selectMeeting(localMeeting.id);
    } else {
      statusEl.textContent = 'Scheduling failed.';
    }
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  });

  document.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'download-report-btn') {
      if (!activeMeetingId) return;
      const report = await Store.toCSV(activeMeetingId);
      const blob = new Blob([report.content], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = report.filename; link.click();
      URL.revokeObjectURL(url);
    }

    if (e.target && e.target.id === 're-fetch-sheet-btn') {
      if (!activeMeetingId) return;
      const originalText = e.target.innerText;
      e.target.innerText = "Syncing..."; e.target.disabled = true;
      attendanceRows = await Store.getAttendance(activeMeetingId, true);
      renderDashboard(); renderMeetingList();
      e.target.innerText = originalText; e.target.disabled = false;
    }
  });
});