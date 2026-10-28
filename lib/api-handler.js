const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const { questions, faultTypes } = require('./questions');

const allowedColors = ['#e83e32', '#2588d8', '#f3c52f'];
const cleanName = value => String(value || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 32);
const uuid = () => require('crypto').randomUUID();
let cachedAdmin;

function getAdmin() {
  if (!cachedAdmin) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    cachedAdmin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return cachedAdmin;
}

function json(res, status, value) { return res.status(status).json(value); }
function tokenFrom(req) {
  const header = String(req.headers.authorization || '');
  return header.replace(/^Bearer\s+/i, '') || String(req.body?.token || '');
}
function requireAdmin(req, res) {
  if (!process.env.ADMIN_TOKEN || tokenFrom(req) !== process.env.ADMIN_TOKEN) {
    json(res, 401, { error: 'Invalid admin token.' }); return false;
  }
  return true;
}
function publicQuestion(q) { const { answer, ...safe } = q; return safe; }
async function dbError(query) {
  const { data, error } = await query;
  if (error) { const e = new Error(error.message); e.status = 400; throw e; }
  return data;
}
async function getRace(db, id) {
  const q = db.from('races').select('*').eq('id', id).maybeSingle();
  return dbError(q);
}
async function currentRace(db) {
  const { data, error } = await db.rpc('ensure_active_race');
  if (error) { const e = new Error(error.message); e.status = 400; throw e; }
  return Array.isArray(data) ? data[0] : data;
}
async function latestRace(db) {
  return dbError(db.from('races').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle());
}
async function getParticipant(db, req) {
  const pid = String(req.headers['x-participant-id'] || req.body?.participantId || '');
  const sessionToken = String(req.headers['x-participant-token'] || req.body?.sessionToken || '');
  if (!pid || !sessionToken) return null;
  const participant = await dbError(db.from('participants').select('*').eq('id', pid).maybeSingle());
  if (!participant) return null;
  const digest = require('crypto').createHash('sha256').update(sessionToken).digest('hex');
  return digest === participant.session_token_hash ? participant : null;
}
async function getResult(db, participantId, raceId) {
  return dbError(db.from('results').select('*').eq('participant_id', participantId).eq('race_id', raceId).maybeSingle());
}
async function listResults(db, raceId) {
  const results = await dbError(db.from('results').select('*, participants!inner(id,name,car_color,lead_name,lead_phone)').eq('race_id', raceId));
  const faults = await dbError(db.from('faults').select('participant_id,triggered_at,repaired_at').eq('race_id', raceId));
  const repairMs = new Map();
  for (const fault of faults) if (fault.repaired_at) repairMs.set(fault.participant_id, (repairMs.get(fault.participant_id) || 0) + fault.repaired_at - fault.triggered_at);
  const ranked = results.map(row => ({ ...row, repair_duration_ms: repairMs.get(row.participant_id) || 0 }));
  ranked.sort((a, b) => (a.status === 'finished' ? 0 : 1) - (b.status === 'finished' ? 0 : 1) || (a.elapsed_ms ?? Infinity) - (b.elapsed_ms ?? Infinity) || a.incorrect_attempts - b.incorrect_attempts || (a.finish_at ?? Infinity) - (b.finish_at ?? Infinity));
  let rank = 0;
  return ranked.map(row => ({
    'Participant ID': row.participant_id, 'Participant/team name': row.participants.name,
    'Team lead': row.participants.lead_name, 'Team lead phone': row.participants.lead_phone,
    'Race ID': raceId, 'Completion status': row.status,
    'Race time (seconds)': row.elapsed_ms == null ? '' : row.elapsed_ms / 1000,
    'Official elapsed time (ms)': row.elapsed_ms ?? '', 'Finish timestamp': row.finish_at ?? '',
    'Final score': row.final_score, 'Fault count': row.faults,
    'Correct answers': row.correct_answers, 'Incorrect attempts': row.incorrect_attempts,
    'Repair duration (ms)': row.repair_duration_ms,
    'Final rank': row.status === 'finished' ? ++rank : ''
  }));
}
async function getRaceSummary(db, race) {
  if (!race) return { race: null };
  const summary = { id: race.id, status: race.status, start_at: race.start_at, ends_at: race.ends_at };
  if (race.status === 'finished') {
    const rows = await dbError(db.from('results').select('participant_id,status,elapsed_ms,final_score,correct_answers,incorrect_attempts,participants!inner(name)').eq('race_id', race.id));
    const ranked = rows.sort((a, b) => (a.status === 'finished' ? 0 : 1) - (b.status === 'finished' ? 0 : 1) || (b.final_score || 0) - (a.final_score || 0) || (a.elapsed_ms ?? Infinity) - (b.elapsed_ms ?? Infinity));
    summary.results = ranked.map((row, index) => ({
      rank: index + 1, participantId: row.participant_id, name: row.participants.name,
      status: row.status, elapsedMs: row.elapsed_ms, score: row.final_score || 0,
      correctAnswers: row.correct_answers || 0, incorrectAnswers: row.incorrect_attempts || 0
    }));
  }
  return { race: race ? summary : null };
}
async function broadcast(db, raceId, event, payload) {
  const { error } = await db.channel(`race:${raceId}`).send({ type: 'broadcast', event, payload });
  if (error) console.error('Realtime broadcast failed:', error.message);
}
async function publishState(db, race) {
  const state = await getRaceSummary(db, race);
  await broadcast(db, race.id, 'state', state);
}
async function startParticipant(db, participantId, raceId, startAt, score, color) {
  const row = await getResult(db, participantId, raceId);
  if (!row || row.status !== 'ready') return;
  await dbError(db.from('results').update({ status: 'racing', start_at: startAt, final_score: score * 100 }).eq('id', row.id).eq('status', 'ready'));
  await broadcast(db, raceId, 'driverStart', { participantId, startAt, color });
}
async function finalize(db, race) {
  if (race.status !== 'running') return;
  const now = Date.now();
  if (race.ends_at && now < race.ends_at) return;
  await dbError(db.from('results').update({ status: 'dnf' }).eq('race_id', race.id).in('status', ['ready', 'racing']));
  const final = await dbError(db.from('races').update({ status: 'finished' }).eq('id', race.id).eq('status', 'running').select('*').maybeSingle());
  if (final) {
    await broadcast(db, race.id, 'race:final', { raceId: race.id });
    await publishState(db, final);
  }
}

async function handle(req, res) {
  const db = getAdmin();
  const method = req.method || 'GET';
  const url = new URL(req.url, 'http://localhost');
  const route = (url.searchParams.get('route') || url.pathname.replace(/^\/api\/?/, '')).replace(/\/$/, '');
  const body = req.body || {};

  if (route === 'health' && method === 'GET') {
    const race = await latestRace(db) || await currentRace(db);
    return json(res, 200, { ok: true, raceId: race.id, status: race.status });
  }
  if (route === 'config' && method === 'GET') {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !publishableKey) return json(res, 503, { error: 'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the Vercel project settings.' });
    return json(res, 200, { supabaseUrl, publishableKey });
  }
  if (route === 'questions' && method === 'GET') return json(res, 200, questions.map(publicQuestion));
  if (route === 'state' && method === 'GET') {
    const race = await latestRace(db) || await currentRace(db);
    let latest = race;
    if (race.status === 'running' && race.ends_at <= Date.now()) {
      await finalize(db, race);
      latest = await getRace(db, race.id);
    }
    return json(res, 200, await getRaceSummary(db, latest));
  }

  if (route === 'join' && method === 'POST') {
    const name = cleanName(body.teamName || body.name), leadName = cleanName(body.leadName);
    const phone = String(body.phone || '').trim().replace(/[^+0-9 ()-]/g, '').slice(0, 24);
    if (!name) return json(res, 400, { error: 'Enter your team name.' });
    if (!leadName) return json(res, 400, { error: 'Enter the team lead name.' });
    if (phone.replace(/\D/g, '').length < 7) return json(res, 400, { error: 'Enter a valid team lead phone number.' });
    const race = await currentRace(db);
    if (!['lobby', 'running'].includes(race.status)) return json(res, 409, { error: 'The race is unavailable right now. Refresh and try again.' });
    const color = allowedColors.includes(String(body.carColor || '').toLowerCase()) ? String(body.carColor).toLowerCase() : allowedColors[0];
    const participantId = uuid(), sessionToken = require('crypto').randomBytes(32).toString('base64url');
    const sessionTokenHash = require('crypto').createHash('sha256').update(sessionToken).digest('hex');
    await dbError(db.from('participants').insert({ id: participantId, name, lead_name: leadName, lead_phone: phone, car_color: color, session_token_hash: sessionTokenHash }));
    await dbError(db.from('results').insert({ id: uuid(), participant_id: participantId, race_id: race.id, status: 'ready', start_at: 0, final_score: 0 }));
    await publishState(db, race);
    return json(res, 200, { participantId, sessionToken, raceId: race.id, carColor: color, raceStatus: race.status });
  }

  const participant = await getParticipant(db, req);
  if (route === 'join' && method === 'GET') {
    const raceId = url.searchParams.get('raceId');
    if (!participant || !raceId) return json(res, 401, { error: 'Participant session not found.' });
    const race = await getRace(db, raceId), result = await getResult(db, participant.id, raceId);
    if (!race || !result || !['ready', 'racing'].includes(result.status)) return json(res, 409, { error: 'Your active race session could not be restored.' });
    const pending = await dbError(db.from('faults').select('*').eq('participant_id', participant.id).eq('race_id', raceId).is('repaired_at', null).maybeSingle());
    const q = pending && questions.find(item => item.id === pending.question_id);
    const activeFault = pending && q ? { eventId: pending.id, fault: pending.fault_type, question: publicQuestion(q) } : null;
    return json(res, 200, { ok: true, raceId, status: result.status, startAt: result.start_at, color: participant.car_color, qualified: Boolean(result.qualified_at), speedCapKmh: result.retry_at && result.retry_at > Date.now() ? 5 : pending ? 5 : 60, activeFault, retryAt: result.retry_at || null });
  }
  if (route === 'color' && method === 'POST') {
    if (!participant) return json(res, 401, { error: 'Join the race first.' });
    const color = String(body.carColor || '').toLowerCase();
    if (!allowedColors.includes(color)) return json(res, 400, { error: 'Choose a listed car color.' });
    await dbError(db.from('participants').update({ car_color: color }).eq('id', participant.id));
    return json(res, 200, { ok: true });
  }
  if (route === 'qualify' && method === 'POST') {
    if (!participant) return json(res, 401, { error: 'Join the race first.' });
    const race = await getRace(db, String(body.raceId || ''));
    if (!race || race.status === 'finished') return json(res, 409, { error: 'This race has ended. Re-enter the garage for the next race.' });
    const row = await getResult(db, participant.id, race.id);
    if (!row || row.qualified_at) return json(res, 409, { error: 'Quiz already submitted.' });
    const score = Math.max(0, Math.min(10, Number(body.score) || 0));
    const qualifiedAt = Date.now();
    await dbError(db.from('results').update({ final_score: score * 100, qualified_at: qualifiedAt }).eq('id', row.id));
    if (race.status === 'running') await startParticipant(db, participant.id, race.id, Date.now() + 1000, score, participant.car_color);
    await publishState(db, race);
    return json(res, 200, { ok: true, waiting: race.status === 'lobby', started: race.status === 'running' });
  }
  if (route === 'resume' && method === 'POST') {
    if (!participant) return json(res, 401, { error: 'Participant session not found.' });
    const race = await getRace(db, String(body.raceId || ''));
    if (!race || race.status !== 'running') return json(res, 409, { error: 'Your active race session could not be restored. Please rejoin the next race.' });
    const result = await getResult(db, participant.id, race.id);
    if (!result || !['ready', 'racing'].includes(result.status)) return json(res, 409, { error: 'Your active race session could not be restored.' });
    const pending = await dbError(db.from('faults').select('*').eq('participant_id', participant.id).eq('race_id', race.id).is('repaired_at', null).maybeSingle());
    const q = pending && questions.find(item => item.id === pending.question_id);
    const activeFault = pending && q ? { eventId: pending.id, fault: pending.fault_type, question: publicQuestion(q) } : null;
    const data = { ok: true, raceId: race.id, status: result.status, startAt: result.start_at, color: participant.car_color, qualified: Boolean(result.qualified_at), speedCapKmh: result.retry_at && result.retry_at > Date.now() ? 5 : pending ? 5 : 60, activeFault, retryAt: result.retry_at || null };
    if (result.status === 'racing') await broadcast(db, race.id, 'driverStart', { ...data, participantId: participant.id, resume: true });
    return json(res, 200, data);
  }

  if (route === 'admin/validate' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, { ok: true });
  }
  if (route === 'admin/start' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const race = await currentRace(db);
    if (race.status !== 'lobby') return json(res, 409, { error: 'Race is not in the lobby.' });
    const startAt = Date.now() + 2000;
    const duration = Math.max(60, Math.min(7200, Number(process.env.RACE_DURATION_SECONDS) || 7200));
    const updated = await dbError(db.from('races').update({ status: 'running', start_at: startAt, ends_at: startAt + duration * 1000 }).eq('id', race.id).eq('status', 'lobby').select('*').maybeSingle());
    if (!updated) return json(res, 409, { error: 'Race has already started.' });
    const ready = await dbError(db.from('results').select('participant_id,final_score,participants!inner(car_color)').eq('race_id', race.id).not('qualified_at', 'is', null));
    for (const row of ready) await startParticipant(db, row.participant_id, race.id, startAt, row.final_score / 100, row.participants.car_color);
    await broadcast(db, race.id, 'race:open', { startAt, endsAt: updated.ends_at, raceId: race.id });
    await publishState(db, updated);
    return json(res, 200, { ok: true, message: 'Race started; qualified drivers are being gridded.' });
  }
  if (route === 'admin/stop' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const race = await currentRace(db);
    if (race.status !== 'running') return json(res, 409, { error: 'There is no running event to end.' });
    const updated = await dbError(db.from('races').update({ status: 'finished' }).eq('id', race.id).eq('status', 'running').select('*').maybeSingle());
    if (!updated) return json(res, 409, { error: 'Race has already ended.' });
    await dbError(db.from('results').update({ status: 'dnf' }).eq('race_id', race.id).in('status', ['ready', 'racing']));
    await broadcast(db, race.id, 'race:final', { raceId: race.id });
    await publishState(db, updated);
    return json(res, 200, { ok: true, message: 'Race ended.' });
  }

  if (route === 'fault/trigger' && method === 'POST') {
    if (!participant) return json(res, 401, { error: 'Join the race first.' });
    const race = await getRace(db, String(body.raceId || ''));
    const result = race && await getResult(db, participant.id, race.id);
    if (!race || race.status !== 'running' || !result || result.status !== 'racing') return json(res, 409, { error: 'Race is not running.' });
    if (result.retry_at && Date.now() < result.retry_at) return json(res, 429, { error: `Incorrect answer. Continue in safe mode for ${Math.ceil((result.retry_at - Date.now()) / 1000)} more seconds.`, retryAt: result.retry_at, speedCapKmh: 40 });
    const activeFault = await dbError(db.from('faults').select('*').eq('participant_id', participant.id).eq('race_id', race.id).is('repaired_at', null).maybeSingle());
    if (activeFault) {
      const q = questions.find(item => item.id === activeFault.question_id);
      if (!q) return json(res, 500, { error: 'The active repair question could not be loaded.' });
      return json(res, 200, { eventId: activeFault.id, fault: activeFault.fault_type, question: publicQuestion(q), alreadyActive: true, speedCapKmh: 5 });
    }
    const requested = faultTypes.includes(body.fault) ? body.fault : faultTypes[Math.floor(Math.random() * faultTypes.length)];
    const already = await dbError(db.from('faults').select('question_id').eq('participant_id', participant.id).eq('race_id', race.id));
    const candidates = questions.filter(q => q.fault === requested && !already.some(f => f.question_id === q.id));
    const pool = candidates.length ? candidates : questions.filter(q => q.fault === requested);
    const q = pool[Math.floor(Math.random() * pool.length)], now = Date.now(), eventId = uuid();
    await dbError(db.from('faults').insert({ id: eventId, participant_id: participant.id, race_id: race.id, fault_type: requested, question_id: q.id, triggered_at: now }));
    await dbError(db.from('results').update({ faults: result.faults + 1 }).eq('id', result.id));
    return json(res, 200, { eventId, fault: requested, question: publicQuestion(q), speedCapKmh: 5 });
  }
  if (route === 'repair/answer' && method === 'POST') {
    if (!participant) return json(res, 401, { error: 'Join the race first.' });
    const race = await getRace(db, String(body.raceId || ''));
    const result = race && await getResult(db, participant.id, race.id);
    if (!race || race.status !== 'running' || !result) return json(res, 409, { error: 'Race is not running.' });
    if (result.retry_at && Date.now() < result.retry_at) return json(res, 429, { error: `Incorrect answer. Please wait ${Math.ceil((result.retry_at - Date.now()) / 1000)} seconds before trying again.`, retryAt: result.retry_at });
    const fault = await dbError(db.from('faults').select('*').eq('id', body.eventId).eq('participant_id', participant.id).eq('race_id', race.id).is('repaired_at', null).maybeSingle());
    if (!fault) return json(res, 409, { error: 'No active repair challenge.' });
    const q = questions.find(item => item.id === fault.question_id);
    const correct = Number(body.answer) === q.answer, now = Date.now(), retryAt = correct ? null : now + 25000;
    await dbError(db.from('faults').update({ attempts: fault.attempts + 1, repaired_at: now }).eq('id', fault.id).is('repaired_at', null));
    await dbError(db.from('results').update({ incorrect_attempts: result.incorrect_attempts + (correct ? 0 : 1), correct_answers: result.correct_answers + (correct ? 1 : 0), retry_at: retryAt }).eq('id', result.id));
    return json(res, 200, { correct, correctAnswer: q.options[q.answer], speedCapKmh: correct ? 60 : 40, retryAt, feedback: correct ? 'Repair complete. Systems restored.' : 'Incorrect answer. Wait 25 seconds before continuing; safe mode is active.' });
  }
  if (route === 'race/finish' && method === 'POST') {
    if (!participant) return json(res, 401, { error: 'Join the race first.' });
    const race = await getRace(db, String(body.raceId || ''));
    if (!race || race.status !== 'running' || !race.start_at) return json(res, 409, { error: 'Race is not running.' });
    const result = await getResult(db, participant.id, race.id);
    if (!result || result.status !== 'racing') return json(res, 409, { error: 'A result was already recorded or the race session is not racing.' });
    const pending = await dbError(db.from('faults').select('id').eq('participant_id', participant.id).eq('race_id', race.id).is('repaired_at', null).maybeSingle());
    if (pending) return json(res, 409, { error: 'Resolve the active fault before finishing.' });
    const finish = Date.now(), elapsed = finish - result.start_at;
    if (finish < result.start_at) return json(res, 409, { error: 'The official race has not started yet.' });
    const updated = await dbError(db.from('results').update({ status: 'finished', finish_at: finish, elapsed_ms: elapsed, final_score: Math.max(0, result.final_score + 100000 - Math.floor(elapsed / 10)) }).eq('id', result.id).eq('status', 'racing').select('*').maybeSingle());
    if (!updated) return json(res, 409, { error: 'A result was already recorded.' });
    const finishSummary = { participantId: participant.id, name: participant.name, elapsedMs: elapsed, score: updated.final_score, correctAnswers: updated.correct_answers, incorrectAnswers: updated.incorrect_attempts, status: updated.status };
    await broadcast(db, race.id, 'race:ended', finishSummary);
    return json(res, 200, { ok: true, ...finishSummary });
  }

  const exportMatch = route.match(/^results\.(xlsx|csv)$/);
  if (exportMatch && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const race = await latestRace(db);
    if (!race) return json(res, 409, { error: 'There is no race to export.' });
    if (race.status !== 'finished') return json(res, 409, { error: 'Exports unlock when the race ends.' });
    const data = await listResults(db, race.id);
    if (exportMatch[1] === 'csv') {
      const esc = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const csv = data.length ? [Object.keys(data[0]).map(esc).join(','), ...data.map(row => Object.values(row).map(esc).join(','))].join('\r\n') : 'Participant ID,Participant/team name,Race ID,Completion status,Official elapsed time (ms),Final rank';
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="pitstop-results.csv"');
      return res.status(200).send('\ufeff' + csv);
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), 'Results');
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', 'attachment; filename="pitstop-results.xlsx"');
    return res.status(200).send(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  }
  return json(res, 404, { error: 'API route not found.' });
}

async function apiHandler(req, res) {
  try { await handle(req, res); }
  catch (error) {
    console.error('API error:', error);
    return json(res, error.status || 500, { error: error.status ? error.message : 'Server configuration or database error.' });
  }
}

module.exports = { apiHandler };
