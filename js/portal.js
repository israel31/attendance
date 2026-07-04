/* portal.js — participant attendance portal */

let html5QrCode = null;
let pendingMeeting = null; // meeting object once identified via scan/code

const screen = document.getElementById('screen');

function showHome() {
  stopScanner();
  pendingMeeting = null;
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
    e.preventDefault(); Store.forgetDevice(); showHome(); toast('Device forgotten.', '');
  });
}

function showScanner() {
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

function handleScanResult(decodedText) {
  stopScanner();
  try {
    const url = new URL(decodedText);
    const meetingId = url.searchParams.get('m');
    const token = url.searchParams.get('t');
    resolveMeeting(meetingId, token);
  } catch (e) {
    showError('That QR code isn\u2019t recognized. Try the meeting code instead.');
  }
}

function showCodeEntry() {
  stopScanner();
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

  function submit() {
    const meeting = Store.getMeetingByCode(input.value.trim());
    if (!meeting) { toast('That code doesn\u2019t match a meeting.', 'bad'); return; }
    resolveMeeting(meeting.id, meeting.token);
  }
}

function resolveMeeting(meetingId, token) {
  const meeting = Store.getMeeting(meetingId);
  if (!meeting || meeting.token !== token) {
    showError('This meeting couldn\u2019t be verified.');
    return;
  }
  const state = Store.meetingWindowStatus(meeting);
  if (state.state !== 'open') {
    showError('This meeting is currently closed.', meeting);
    return;
  }
  pendingMeeting = meeting;

  const device = Store.getDevice();
  if (device) {
    attemptCheckIn(device.staffId);
  } else {
    showIdentify();
  }
}

function showIdentify() {
  screen.innerHTML = `
    <div class="card">
      <div class="card-title">Confirm it's you</div>
      <div class="card-sub">Enter your Staff ID or email — just once. This device will remember you next time.</div>
      <div class="field"><label>Staff ID or email</label><input id="ident-input" placeholder="S-1001 or you@org.com"></div>
      <button class="btn btn-primary btn-block" id="ident-submit">Check in</button>
      <button class="btn btn-ghost btn-block" id="ident-back" style="margin-top:10px;">Back</button>
    </div>
  `;
  const input = document.getElementById('ident-input');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  document.getElementById('ident-submit').addEventListener('click', submit);
  document.getElementById('ident-back').addEventListener('click', showHome);

  function submit() {
    const val = input.value.trim();
    if (!val) return;
    const participant = val.includes('@')
      ? Store.findParticipant({ email: val })
      : Store.findParticipant({ staffId: val });
    if (!participant) { toast('We couldn\u2019t match that to the participant list.', 'bad'); return; }
    attemptCheckIn(participant.staffId, participant.name);
  }
}

function attemptCheckIn(staffId, name) {
  const deviceId = getDeviceId();
  const result = Store.checkIn({ meetingId: pendingMeeting.id, staffId, deviceId });
  if (!result.ok) {
    if (result.already) {
      showSuccess(result.row, pendingMeeting, true);
    } else {
      showError(result.reason);
    }
    return;
  }
  Store.rememberDevice({ staffId: result.row.staffId, name: name || result.row.name });
  showSuccess(result.row, pendingMeeting, false);
}

function showSuccess(row, meeting, wasAlready) {
  screen.innerHTML = `
    <div class="card viewfinder" style="text-align:center;padding:40px 26px;">
      <span class="vf-tr"></span><span class="vf-br"></span>
      <div style="width:56px;height:56px;border-radius:50%;background:var(--good-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#1FAA6D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h3 style="font-size:19px;">${wasAlready ? 'Already checked in' : 'Attendance recorded'}</h3>
      <p style="margin-top:8px;">${meeting.title}</p>
      <p style="margin-top:2px;">${fmtDateTime(meeting.start)}</p>
      <div class="divider"></div>
      <p style="font-size:13px;">Recorded as <strong style="color:var(--ink)">${row.name}</strong> · ${row.status} · ${fmtTime(row.checkInTime)}</p>
      <button class="btn btn-dark btn-block" id="done-btn" style="margin-top:22px;">Done</button>
    </div>
  `;
  document.getElementById('done-btn').addEventListener('click', showHome);
}

function showError(message, meeting) {
  screen.innerHTML = `
    <div class="card" style="text-align:center;padding:40px 26px;">
      <div style="width:56px;height:56px;border-radius:50%;background:var(--bad-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#E14E4E" stroke-width="3" stroke-linecap="round"/></svg>
      </div>
      <h3 style="font-size:18px;">${message}</h3>
      ${meeting ? `<p style="margin-top:8px;">${meeting.title}</p>` : ''}
      <button class="btn btn-ghost btn-block" id="err-back" style="margin-top:22px;">Back</button>
    </div>
  `;
  document.getElementById('err-back').addEventListener('click', showHome);
}

function getDeviceId() {
  let id = localStorage.getItem('sqa_device_id');
  if (!id) { id = Store.uuid(); localStorage.setItem('sqa_device_id', id); }
  return id;
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
