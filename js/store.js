/* ===========================================================
   store.js — the app's "backend".
   In Demo Mode this is entirely localStorage, seeded with a
   sample organization so the whole flow works with no Google
   account, per the PRD's Demo Mode requirement.
   In Production Mode, the same function shapes are kept so a
   future swap to real Google Calendar/Sheets calls only needs
   to change the inside of these functions, not the pages that
   call them. See README.md for what that swap needs.
   =========================================================== */

const Store = (() => {
  const KEYS = {
    mode: 'sqa_mode',
    participants: 'sqa_master_participants',
    meetings: 'sqa_meetings',
    device: 'sqa_device_identity',
    attendance: (meetingId) => `sqa_attendance_${meetingId}`,
  };

  const uid = (len = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  // ---------- Mode ----------
  function getMode() { return localStorage.getItem(KEYS.mode) || 'demo'; }
  function setMode(mode) { localStorage.setItem(KEYS.mode, mode); }

  // ---------- Seeding ----------
  const SAMPLE_NAMES = [
    ['S-1001', 'Amaka Obi', 'Communications'],
    ['S-1002', 'Tunde Bakare', 'Engineering'],
    ['S-1003', 'Chiamaka Eze', 'Finance'],
    ['S-1004', 'David Okafor', 'Engineering'],
    ['S-1005', 'Grace Adeyemi', 'Human Resources'],
    ['S-1006', 'Ifeanyi Nwosu', 'Operations'],
    ['S-1007', 'Blessing Umeh', 'Communications'],
    ['S-1008', 'Segun Alabi', 'Finance'],
    ['S-1009', 'Ngozi Chukwu', 'Operations'],
    ['S-1010', 'Emeka Chidozie', 'Engineering'],
    ['S-1011', 'Funmilayo Bello', 'Human Resources'],
    ['S-1012', 'Yusuf Garba', 'Operations'],
  ];

  function seedIfEmpty() {
    if (!localStorage.getItem(KEYS.participants)) {
      const participants = SAMPLE_NAMES.map(([staffId, name, department]) => ({
        staffId, name, department,
        email: `${name.toLowerCase().replace(/\s+/g, '.')}@sample.org`,
        status: 'Active',
        group: department,
      }));
      write(KEYS.participants, participants);
    }
    if (!localStorage.getItem(KEYS.meetings)) {
      const now = Date.now();
      const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
      const meetings = [
        makeMeetingObject({
          title: 'Weekly Ops Standup',
          date: new Date(now).toISOString(),
          start: new Date(now - 5 * MIN).toISOString(),   // started 5 min ago -> live now
          end: new Date(now + 55 * MIN).toISOString(),    // ends in 55 min
          location: 'Conference Room A',
          description: 'Auto-created from Google Calendar sync (demo).',
        }),
        makeMeetingObject({
          title: 'Board Strategy Session',
          date: new Date(now + DAY).toISOString(),
          start: new Date(now + DAY + 3 * HOUR).toISOString(),
          end: new Date(now + DAY + 5 * HOUR).toISOString(),
          location: 'Main Hall',
          description: 'Auto-created from Google Calendar sync (demo).',
        }),
        makeMeetingObject({
          title: 'New Staff Orientation',
          date: new Date(now + 3 * DAY).toISOString(),
          start: new Date(now + 3 * DAY + 2 * HOUR).toISOString(),
          end: new Date(now + 3 * DAY + 5 * HOUR).toISOString(),
          location: 'Training Hall B',
          description: 'Auto-created from Google Calendar sync (demo).',
        }),
      ];
      write(KEYS.meetings, meetings);
      meetings.forEach(m => write(KEYS.attendance(m.id), buildAttendanceFromMaster()));
    }
  }

  function makeMeetingObject({ title, date, start, end, location, description }) {
    return {
      id: uuid(),
      meetingCode: uid(6),
      token: uuid(),
      title, date, start, end, location, description,
      createdAt: new Date().toISOString(),
    };
  }

  function buildAttendanceFromMaster() {
    return getParticipants()
      .filter(p => p.status === 'Active')
      .map(p => ({
        staffId: p.staffId, name: p.name, department: p.department,
        status: 'Absent', checkInTime: null, deviceId: null, notes: '',
      }));
  }

  // ---------- Participants (master sheet) ----------
  function getParticipants() { return read(KEYS.participants, []); }

  // ---------- Meetings (calendar-synced) ----------
  function getMeetings() {
    return read(KEYS.meetings, []).sort((a, b) => new Date(a.start) - new Date(b.start));
  }
  function getMeeting(id) { return getMeetings().find(m => m.id === id); }
  function getMeetingByCode(code) {
    return getMeetings().find(m => m.meetingCode.toUpperCase() === String(code).toUpperCase());
  }

  function createInstantMeeting(title) {
    const now = Date.now();
    const meeting = makeMeetingObject({
      title: title || 'Instant Meeting',
      date: new Date(now).toISOString(),
      start: new Date(now).toISOString(),
      end: new Date(now + 60 * 60000).toISOString(),
      location: 'On the go',
      description: 'Manually started meeting.',
    });
    const meetings = getMeetings();
    meetings.push(meeting);
    write(KEYS.meetings, meetings);
    write(KEYS.attendance(meeting.id), buildAttendanceFromMaster());
    return meeting;
  }

  function syncCalendar() {
    // Demo stand-in for "detect new event in Google Calendar".
    const now = Date.now();
    const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    const titles = ['Department Sync', 'Client Review Call', 'Monthly All-Hands', 'Vendor Walkthrough'];
    const title = titles[Math.floor(Math.random() * titles.length)];
    const dayOffset = 1 + Math.floor(Math.random() * 6);
    const hourOfDay = 1 + Math.floor(Math.random() * 7); // spreads start times across the day
    const startAt = now + dayOffset * DAY + hourOfDay * HOUR;
    const meeting = makeMeetingObject({
      title,
      date: new Date(startAt).toISOString(),
      start: new Date(startAt).toISOString(),
      end: new Date(startAt + HOUR).toISOString(),
      location: 'Auto-detected',
      description: 'Detected from a newly created Google Calendar event.',
    });
    const meetings = getMeetings();
    meetings.push(meeting);
    write(KEYS.meetings, meetings);
    write(KEYS.attendance(meeting.id), buildAttendanceFromMaster());
    return meeting;
  }

  // ---------- Attendance ----------
  function getAttendance(meetingId) { return read(KEYS.attendance(meetingId), []); }
  function saveAttendance(meetingId, rows) { write(KEYS.attendance(meetingId), rows); }

  function meetingWindowStatus(meeting) {
    const now = Date.now();
    const start = new Date(meeting.start).getTime();
    const end = new Date(meeting.end).getTime();
    const opensAt = start - 15 * 60000;
    if (now < opensAt) return { state: 'upcoming', opensAt };
    if (now >= opensAt && now <= end) return { state: 'open' };
    return { state: 'closed' };
  }

  function checkIn({ meetingId, staffId, deviceId }) {
    const meeting = getMeeting(meetingId);
    if (!meeting) return { ok: false, reason: 'Meeting not found.' };

    const windowState = meetingWindowStatus(meeting);
    if (windowState.state === 'upcoming') return { ok: false, reason: 'This meeting is currently closed.' };
    if (windowState.state === 'closed') return { ok: false, reason: 'This meeting is currently closed.' };

    const rows = getAttendance(meetingId);
    const row = rows.find(r => r.staffId.toLowerCase() === String(staffId).toLowerCase());
    if (!row) return { ok: false, reason: 'ID not recognized on the participant list.' };
    if (row.status === 'Present') return { ok: false, reason: 'Already checked in for this meeting.', already: true, row };

    const start = new Date(meeting.start).getTime();
    const lateCutoff = start + 10 * 60000;
    row.status = Date.now() > lateCutoff ? 'Late' : 'Present';
    row.checkInTime = new Date().toISOString();
    row.deviceId = deviceId || null;
    saveAttendance(meetingId, rows);
    return { ok: true, row, meeting };
  }

  function findParticipant({ staffId, email }) {
    const list = getParticipants();
    return list.find(p =>
      (staffId && p.staffId.toLowerCase() === String(staffId).toLowerCase()) ||
      (email && p.email.toLowerCase() === String(email).toLowerCase())
    );
  }

  // ---------- Device memory ----------
  function getDevice() { return read(KEYS.device, null); }
  function rememberDevice(identity) { write(KEYS.device, identity); }
  function forgetDevice() { localStorage.removeItem(KEYS.device); }

  // ---------- Reports ----------
  function toCSV(meetingId) {
    const meeting = getMeeting(meetingId);
    const rows = getAttendance(meetingId);
    const header = ['Staff ID', 'Name', 'Department', 'Status', 'Check-in Time', 'Device ID', 'Notes'];
    const lines = [header.join(',')];
    rows.forEach(r => {
      lines.push([
        r.staffId, `"${r.name}"`, `"${r.department}"`, r.status,
        r.checkInTime ? new Date(r.checkInTime).toLocaleString() : '',
        r.deviceId || '', r.notes || ''
      ].join(','));
    });
    return { filename: `${(meeting?.title || 'meeting').replace(/\s+/g, '_')}_attendance.csv`, content: lines.join('\n') };
  }

  function resetDemoData() {
    Object.keys(localStorage)
      .filter(k => k.startsWith('sqa_'))
      .forEach(k => { if (k !== KEYS.mode) localStorage.removeItem(k); });
    seedIfEmpty();
  }

  return {
    uid, uuid, getMode, setMode, seedIfEmpty,
    getParticipants, getMeetings, getMeeting, getMeetingByCode,
    createInstantMeeting, syncCalendar,
    getAttendance, saveAttendance, meetingWindowStatus, checkIn, findParticipant,
    getDevice, rememberDevice, forgetDevice,
    toCSV, resetDemoData,
  };
})();
