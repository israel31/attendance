/* portal.js — participant attendance portal */

let html5QrCode = null;
let pendingMeeting = null; // meeting object once identified via scan/code

// Safety Fallback: Ensure calling toast() never throws a ReferenceError if ui.js fails
const safeToast = (msg, kind) => {
  if (typeof toast === 'function') {
    toast(msg, kind);
  } else {
    alert(msg);
  }
};

function showHome() {
  stopScanner();
  pendingMeeting = null;
  
  const screen = document.getElementById('screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="card viewfinder" style="text-align:center;padding:40px 26px;">
      <span class="vf-tr"></span><span class="vf-br"></span>
      <h3 style="font-size:20px;margin-bottom:8px;">Check in to a meeting</h3>
      <p style="margin-bottom:26px;">No account needed. Scan the QR on display, or type the short code beside it.</p>
      <button class="btn btn-primary btn-lg btn-block" id="scan-btn">Scan QR code</button>
      <button class="btn btn-ghost btn-lg btn-block" id="code-btn" style="margin-top:12px;">Enter meeting code</button>
      ${Store.getDevice() ? `<p style="margin-top:20px;font-size:12px;">Remembered as <strong style="color:var(--ink)">${Store.getDevice().name}</strong> on this device · <a href="#" id="forget-btn" style="color:var(--blue);font-weight:600;">not you?</a></p>` : ''}
    </div>
  `;
  document.getElementById('scan-btn').addEventListener('click', showScanner);
  document.getElementById('code-btn').addEventListener('click', showCodeEntry);
  document.getElementById('forget-btn')?.addEventListener('click', (e) => {
    e.preventDefault(); 
    Store.forgetDevice(); 
    showHome(); 
    safeToast('Device forgotten.', '');
  });
}

function showScanner() {
  const screen = document.getElementById('screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="card">
      <div class="card-title">Point your camera at the QR code</div>
      <div class="card-sub">Scanning starts automatically.</div>
      <div id="qr-reader" style="width:100%;"></div>
      <button class="btn btn-ghost btn-block" id="cancel-scan-btn" style="margin-top:14px;">Cancel</button>
    </div>
  `;
  document.getElementById('cancel-scan-btn').addEventListener('click', showHome);

  html5QrCode = new Html5Qrcode('qr-reader');
  html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 230 },
    (decodedText) => { handleScanResult(decodedText); },
    () => {}
  ).catch(() => {
    screen.innerHTML = `
      <div class="card" style="text-align:center;">
        <div class="card-title">Camera unavailable</div>
        <p style="margin-bottom:18px;">Permission was denied, or no camera was found. Use the meeting code instead.</p>
        <button class="btn btn-primary btn-block" id="fallback-code-btn">Enter meeting code</button>
        <button class="btn btn-ghost btn-block" id="fallback-home-btn" style="margin-top:10px;">Back</button>
      </div>`;
    document.getElementById('fallback-code-btn').addEventListener('click', showCodeEntry);
    document.getElementById('fallback-home-btn').addEventListener('click', showHome);
  });
}

function stopScanner() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
    html5QrCode = null;
  }
}

async function handleScanResult(decodedText) {
  stopScanner();
  let meetingId = null;
  let token = null;

  try {
    if (decodedText.startsWith('http://') || decodedText.startsWith('https://')) {
      const url = new URL(decodedText);
      meetingId = url.searchParams.get('m');
      token = url.searchParams.get('t');
    } else {
      const fallbackParams = new URLSearchParams(decodedText.split('?')[1] || decodedText);
      meetingId = fallbackParams.get('m');
      token = fallbackParams.get('t');
    }

    if (meetingId) {
      await resolveMeeting(meetingId, token);
    } else {
      throw new Error("Invalid format");
    }
  } catch (e) {
    showError('That QR code isn\u2019t recognized. Try the meeting code instead.');
  }
}

function showCodeEntry() {
  stopScanner();
  const screen = document.getElementById('screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="card">
      <div class="card-title">Enter the meeting code</div>
      <div class="card-sub">It's the short code shown beside the QR, e.g. M7K9P2.</div>
      <div class="field"><input id="code-input" class="mono" maxlength="6" placeholder="M7K9P2" style="text-transform:uppercase;letter-spacing:.14em;font-weight:700;text-align:center;font-size:20px;"></div>
      <button class="btn btn-primary btn-block" id="submit-code-btn">Continue</button>
      <button class="btn btn-ghost btn-block" id="back-btn" style="margin-top:10px;">Back</button>
    </div>
  `;
  const input = document.getElementById('code-input');
  input.focus();
  input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  document.getElementById('submit-code-btn').addEventListener('click', submit);
  document.getElementById('back-btn').addEventListener('click', showHome);

  async function submit() {
    const meeting = await Store.loadMeetingByCode(input.value.trim());
    if (!meeting) { safeToast('That code doesn\u2019t match a meeting.', 'bad'); return; }
    await resolveMeeting(meeting.id, meeting.meetingCode);
  }
}

async function resolveMeeting(meetingId, token) {
  const meeting = await Store.loadMeetingById(meetingId);
  if (!meeting || meeting.meetingCode !== token) {
    showError('This meeting couldn\u2019t be verified.');
    return;
  }
  const state = Store.meetingWindowStatus(meeting);
  if (state.state === 'upcoming') {
    showError('Check-in is locked. It only opens 15 minutes before the meeting starts.', meeting);
    return;
  }
  if (state.state === 'closed') {
    showError('This meeting check-in window has closed.', meeting);
    return;
  }
  pendingMeeting = meeting;

  const device = Store.getDevice();
  
  if (device && (!device.email || !device.email.includes('@'))) {
    Store.forgetDevice();
    showIdentify();
    return;
  }

  if (device) {
    attemptCheckIn(device.email || device.staffId);
  } else {
    showIdentify();
  }
}

function showIdentify() {
  const screen = document.getElementById('screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="card">
      <div class="card-title">Confirm it's you</div>
      <div class="card-sub">Enter your organizational Email address — just once. This device will remember you next time.</div>
      <div class="field"><label>Email Address</label><input type="email" id="ident-input" placeholder="you@company.com"></div>
      <button class="btn btn-primary btn-block" id="ident-submit">Check in</button>
      <button class="btn btn-ghost btn-block" id="ident-back" style="margin-top:10px;">Back</button>
    </div>
  `;
  const input = document.getElementById('ident-input');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  document.getElementById('ident-submit').addEventListener('click', submit);
  document.getElementById('ident-back').addEventListener('click', showHome);

  async function submit() {
    const val = input.value.trim();
    if (!val) return;
    
    // FIXED: Query Supabase using meeting context instead of reading Google Sheet locally
    const participant = await Store.findParticipantInMeeting({ meetingId: pendingMeeting.id, email: val });
    if (!participant) { safeToast('We couldn\u2019t match that email to the participant list for this meeting.', 'bad'); return; }
    
    attemptCheckIn(participant.email, participant.name);
  }
}

function attemptCheckIn(email, name) {
  const deviceId = getDeviceId();
  Store.checkIn({ meetingId: pendingMeeting.id, staffId: email, deviceId }).then((result) => {
    if (!result.ok) {
      if (result.already) {
        showSuccess(result.row, pendingMeeting, true);
      } else {
        showError(result.reason);
      }
      return;
    }
    Store.rememberDevice({ email: result.row.staffId, staffId: result.row.staffId, name: name || result.row.name });
    showSuccess(result.row, pendingMeeting, false);
  }).catch((err) => {
    showError("An error occurred during verification.");
  });
}

function showSuccess(row, meeting, wasAlready) {
  const screen = document.getElementById('screen');
  if (!screen) return;

  const checkInString = row.checkInTime ? new Date(row.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

  screen.innerHTML = `
    <div class="card viewfinder" style="text-align:center;padding:40px 26px;">
      <span class="vf-tr"></span><span class="vf-br"></span>
      <div style="width:56px;height:56px;border-radius:50%;background:var(--good-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#1FAA6D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h3 style="font-size:19px;">${wasAlready ? 'Already checked in' : 'Attendance recorded'}</h3>
      <p style="margin-top:8px;">${escapeHtml(meeting.title)}</p>
      <p style="margin-top:2px;">${new Date(meeting.start).toLocaleString()}</p>
      <div class="divider"></div>
      <p style="font-size:13px;">Recorded as <strong style="color:var(--ink)">${escapeHtml(row.name)}</strong> · ${row.status} · ${checkInString}</p>
      <button class="btn btn-dark btn-block" id="done-btn" style="margin-top:22px;">Done</button>
    </div>
  `;
  document.getElementById('done-btn').addEventListener('click', showHome);
}

function showError(message, meeting) {
  const screen = document.getElementById('screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="card" style="text-align:center;padding:40px 26px;">
      <div style="width:56px;height:56px;border-radius:50%;background:var(--bad-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#E14E4E" stroke-width="3" stroke-linecap="round"/></svg>
      </div>
      <h3 style="font-size:18px;">${message}</h3>
      ${meeting ? `<p style="margin-top:8px;">${escapeHtml(meeting.title)}</p>` : ''}
      <button class="btn btn-ghost btn-block" id="err-back" style="margin-top:22px;">Back</button>
    </div>
  `;
  document.getElementById('err-back').addEventListener('click', showHome);
}

function getDeviceId() {
  let id = localStorage.getItem('sqa_device_id');
  if (!id) { id = 'dev-' + Math.random().toString(36).substr(2, 12); localStorage.setItem('sqa_device_id', id); }
  return id;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const m = params.get('m');
  const t = params.get('t');
  if (m && t) {
    resolveMeeting(m, t);
  } else {
    showHome();
  }
});