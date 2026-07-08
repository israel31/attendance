const Store = (() => {
  const SUPABASE_URL = "https://ekoylhztqkxjpntyjkym.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrb3lsaHp0cWt4anBudHlqa3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NDQ5NjcsImV4cCI6MjA5NzMyMDk2N30.BN-jgyDdWz3pTltkRbrADFij52SSdMl_qrIo_vtml8I";

  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let cachedMeetings = [];
  let realtimeChannel = null;

  function extractSheetId(url) {
    const matches = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return matches ? matches[1] : null;
  }

  function parseCSV(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length <= 1) return [];

    return lines.slice(1).map(line => {
      const columns = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(col => col.replace(/^"|"$/g, '').trim());
      return {
        staffId: columns[0] || '',
        name: columns[1] || '',
        department: columns[2] || '',
        email: columns[3] || ''
      };
    }).filter(p => p.email);
  }

  async function fetchParticipantsFromGoogleSheet(sheetUrl) {
    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) throw new Error("Invalid Google Sheets URL format.");

    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Sheet1`;
    const resp = await fetch(exportUrl);
    if (!resp.ok) throw new Error("Failed to fetch sheet data. Ensure access is set to 'Anyone with the link'.");
    
    const csvText = await resp.text();
    return parseCSV(csvText);
  }

  function getStoredSheetUrl() { return localStorage.getItem('sqa_google_sheet_url') || ''; }
  function setStoredSheetUrl(url) { localStorage.setItem('sqa_google_sheet_url', url.trim()); }

  const uid = (len = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

  async function syncCalendar() {
    const { data } = await supabaseClient.from('meetings').select('*').order('start_at', { ascending: false });
    cachedMeetings = (data || []).map(m => ({
      id: m.id,
      meetingCode: m.meeting_code,
      title: m.title,
      start: m.start_at,
      end: m.end_at,
      location: m.location,
      description: m.description
    }));
    return cachedMeetings;
  }

  async function createScheduledMeeting(title, startIsoString, durationMinutes) {
    const sheetUrl = getStoredSheetUrl();
    if (!sheetUrl) {
      alert("Please configure and validate your Google Spreadsheet link first.");
      return null;
    }

    const shortCode = uid(6);
    const randomId = 'local-' + Math.random().toString(36).substr(2, 9);
    
    const startDate = new Date(startIsoString);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

    let masterParticipants = [];
    try {
      masterParticipants = await fetchParticipantsFromGoogleSheet(sheetUrl);
    } catch (e) {
      alert(e.message);
      return null;
    }

    const { data: newMeeting, error } = await supabaseClient
      .from('meetings')
      .insert([{
        id: randomId,
        meeting_code: shortCode,
        title: title || 'Scheduled Meeting',
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        location: 'Dashboard Scheduled',
        description: 'Manually scheduled inside application.'
      }])
      .select()
      .single();

    if (error) return null;

    const seedPayload = masterParticipants.map(p => ({
      meeting_id: randomId,
      staff_id: p.email.toLowerCase().trim(), 
      name: p.name,
      department: p.department,
      status: 'Absent'
    }));

    await supabaseClient.from('attendance').insert(seedPayload);

    const mapped = {
      id: newMeeting.id,
      meetingCode: newMeeting.meeting_code,
      title: newMeeting.title,
      start: newMeeting.start_at,
      end: newMeeting.end_at,
      location: newMeeting.location,
      description: newMeeting.description
    };
    cachedMeetings.push(mapped);
    return mapped;
  }

  async function getAttendance(meetingId, forceRefreshFromSheet = false) {
    let { data: supabaseRows } = await supabaseClient.from('attendance').select('*').eq('meeting_id', meetingId);
    const sheetUrl = getStoredSheetUrl();

    if (sheetUrl && (!supabaseRows || supabaseRows.length === 0 || forceRefreshFromSheet)) {
      try {
        const freshSheetParticipants = await fetchParticipantsFromGoogleSheet(sheetUrl);
        const existingRowsMap = new Map((supabaseRows || []).map(r => [r.staff_id.toLowerCase().trim(), r]));
        const newRecordsToInsert = [];

        for (let p of freshSheetParticipants) {
          const key = p.email.toLowerCase().trim();
          if (!existingRowsMap.has(key)) {
            newRecordsToInsert.push({
              meeting_id: meetingId,
              staff_id: p.email.toLowerCase().trim(), 
              name: p.name,
              department: p.department,
              status: 'Absent'
            });
          }
        }

        if (newRecordsToInsert.length > 0) {
          await supabaseClient.from('attendance').insert(newRecordsToInsert);
        }

        const { data: refetched } = await supabaseClient.from('attendance').select('*').eq('meeting_id', meetingId);
        supabaseRows = refetched;
      } catch (err) {
        console.error("Sheet roster sync failed.", err);
      }
    }

    return (supabaseRows || []).map(r => ({
      staffId: r.staff_id, 
      name: r.name,
      department: r.department,
      status: r.status,
      checkInTime: r.check_in_time,
      deviceId: r.device_id
    }));
  }

  function listenToAttendanceUpdates(meetingId, onUpdateCallback) {
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = supabaseClient
      .channel(`live-attendance-${meetingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `meeting_id=eq.${meetingId}` }, () => {
        if (onUpdateCallback) onUpdateCallback();
      })
      .subscribe();
  }

  async function checkIn({ meetingId, staffId, deviceId }) {
    const meeting = await loadMeetingById(meetingId);
    if (!meeting) return { ok: false, reason: 'Meeting record context lost.' };

    const windowState = meetingWindowStatus(meeting);
    if (windowState.state === 'upcoming') {
      return { ok: false, reason: 'Check-in is locked. It only opens 15 minutes before the meeting starts.' };
    }
    if (windowState.state === 'closed') {
      return { ok: false, reason: 'This meeting check-in window has closed.' };
    }

    const { data: existing } = await supabaseClient.from('attendance').select('*').eq('meeting_id', meetingId).eq('staff_id', staffId.toLowerCase().trim()).maybeSingle();
    if (!existing) return { ok: false, reason: 'Email address not listed on the registration roster.' };
    if (existing.status === 'Present' || existing.status === 'Late') return { ok: false, reason: 'Already checked in.', already: true, row: existing };

    const start = new Date(meeting.start).getTime();
    const finalStatus = Date.now() > (start + 10 * 60000) ? 'Late' : 'Present';
    const timestamp = new Date().toISOString();

    const { data: updated } = await supabaseClient.from('attendance').update({ status: finalStatus, check_in_time: timestamp, device_id: deviceId }).eq('id', existing.id).select().single();
    return { ok: true, row: { staffId: updated.staff_id, name: updated.name, department: updated.department, status: updated.status, checkInTime: updated.check_in_time }, meeting };
  }

  async function findParticipant({ staffId, email }) {
    const sheetUrl = getStoredSheetUrl();
    if (!sheetUrl) return null;
    const list = await fetchParticipantsFromGoogleSheet(sheetUrl);
    const targetKey = String(email || staffId).toLowerCase().trim();
    return list.find(p => p.email.toLowerCase().trim() === targetKey);
  }

  async function loadMeetingById(meetingId) {
    let meeting = cachedMeetings.find(m => m.id === meetingId);
    if (!meeting) {
      const { data } = await supabaseClient.from('meetings').select('*').eq('id', meetingId).maybeSingle();
      if (data) {
        meeting = { id: data.id, meetingCode: data.meeting_code, title: data.title, start: data.start_at, end: data.end_at, location: data.location, description: data.description };
        cachedMeetings.push(meeting);
      }
    }
    return meeting;
  }

  async function loadMeetingByCode(code) {
    const upper = String(code).toUpperCase().trim();
    let meeting = cachedMeetings.find(m => m.meetingCode.toUpperCase() === upper);
    if (!meeting) {
      const { data } = await supabaseClient.from('meetings').select('*').eq('meeting_code', upper).maybeSingle();
      if (data) {
        meeting = { id: data.id, meetingCode: data.meeting_code, title: data.title, start: data.start_at, end: data.end_at, location: data.location, description: data.description };
        cachedMeetings.push(meeting);
      }
    }
    return meeting;
  }

  async function toCSV(meetingId) {
    const meeting = await loadMeetingById(meetingId);
    const rows = await getAttendance(meetingId);
    const header = ['Email', 'Name', 'Department', 'Status', 'Check-in Time', 'Device ID'];
    const lines = [header.join(',')];
    rows.forEach(r => { lines.push([r.staffId, `"${r.name}"`, `"${r.department}"`, r.status, r.checkInTime ? new Date(r.checkInTime).toLocaleString() : '', r.deviceId || ''].join(',')); });
    return { filename: `${(meeting?.title || 'meeting').replace(/\s+/g, '_')}_attendance.csv`, content: lines.join('\n') };
  }

  function meetingWindowStatus(meeting) {
    if (!meeting) return { state: 'closed' };
    const now = Date.now(); 
    const start = new Date(meeting.start).getTime();
    const end = new Date(meeting.end).getTime();
    const openTimeWindow = start - (15 * 60000);

    if (now < openTimeWindow) return { state: 'upcoming' };
    if (now >= openTimeWindow && now <= end) return { state: 'open' };
    return { state: 'closed' };
  }

  return {
    syncCalendar, createScheduledMeeting, getAttendance, listenToAttendanceUpdates, checkIn,
    findParticipant, loadMeetingById, loadMeetingByCode, toCSV, meetingWindowStatus,
    getMeetings: () => cachedMeetings, getMeeting: (id) => cachedMeetings.find(m => m.id === id),
    getStoredSheetUrl, setStoredSheetUrl, fetchParticipantsFromGoogleSheet,
    getDevice: () => {
      const raw = localStorage.getItem('sqa_device_identity');
      return raw ? JSON.parse(raw) : null;
    },
    rememberDevice: (identity) => localStorage.setItem('sqa_device_identity', JSON.stringify(identity)),
    forgetDevice: () => localStorage.removeItem('sqa_device_identity')
  };
})();