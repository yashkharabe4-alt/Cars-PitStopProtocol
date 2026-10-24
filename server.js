require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
app.use(express.static(path.join(__dirname, 'public')));

const dbFile = path.resolve(process.env.DB_PATH || './data/pitstop.sqlite');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS races(id TEXT PRIMARY KEY, status TEXT NOT NULL, start_at INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS faults(id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id), race_id TEXT NOT NULL REFERENCES races(id), fault_type TEXT NOT NULL, question_id TEXT NOT NULL, triggered_at INTEGER NOT NULL, repaired_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id), race_id TEXT NOT NULL REFERENCES races(id), status TEXT NOT NULL, start_at INTEGER NOT NULL, finish_at INTEGER, elapsed_ms INTEGER, faults INTEGER NOT NULL DEFAULT 0, correct_answers INTEGER NOT NULL DEFAULT 0, incorrect_attempts INTEGER NOT NULL DEFAULT 0, final_score INTEGER NOT NULL DEFAULT 0, UNIQUE(participant_id, race_id));
`);
let raceId = process.env.RACE_ID || 'main-event';
db.prepare("INSERT OR IGNORE INTO races(id,status,created_at) VALUES(?, 'lobby', ?)").run(raceId, new Date().toISOString());
const active = new Map();
const questions = [
 {id:'q1',fault:'engine',text:'What is the time complexity of binary search on a sorted array?',options:['O(n)','O(log n)','O(n²)','O(1)'],answer:1,difficulty:'easy'},
 {id:'q2',fault:'brake',text:'Which structure follows LIFO order?',options:['Queue','Array','Stack','Graph'],answer:2,difficulty:'easy'},
 {id:'q3',fault:'fuel',text:'In C, which function allocates uninitialized memory?',options:['calloc','malloc','free','memset'],answer:1,difficulty:'easy'},
 {id:'q4',fault:'temperature',text:'What is the worst-case time complexity of merge sort?',options:['O(n)','O(n log n)','O(n²)','O(log n)'],answer:1,difficulty:'medium'},
 {id:'q5',fault:'speed',text:'Which operation is O(1) on a singly linked list when its head is known?',options:['Search by value','Insert at head','Find the tail','Sort the list'],answer:1,difficulty:'easy'},
 {id:'q6',fault:'engine',text:'What does a segmentation fault usually indicate?',options:['Invalid memory access','Integer overflow only','A syntax error','A slow algorithm'],answer:0,difficulty:'medium'},
 {id:'q7',fault:'brake',text:'A queue removes items in which order?',options:['LIFO','FIFO','Sorted order','Random order'],answer:1,difficulty:'easy'},
 {id:'q8',fault:'fuel',text:'Which loop runs at least once?',options:['for','while','do-while','range loop'],answer:2,difficulty:'easy'},
 {id:'q9',fault:'temperature',text:'What is the average time complexity of quicksort?',options:['O(log n)','O(n)','O(n log n)','O(n²)'],answer:2,difficulty:'medium'},
 {id:'q10',fault:'speed',text:'Which search technique requires sorted data?',options:['Linear search','Binary search','DFS','Hash lookup'],answer:1,difficulty:'easy'},
 {id:'q11',fault:'engine',text:'What is the output type of sizeof in C?',options:['int','size_t','long double','char'],answer:1,difficulty:'medium'},
 {id:'q12',fault:'brake',text:'Which traversal uses a queue?',options:['DFS','Inorder','BFS','Postorder'],answer:2,difficulty:'medium'}
];
const faultTypes = ['engine','brake','fuel','temperature','speed'];
const uuid = () => require('crypto').randomUUID();
function currentRace() { return db.prepare('SELECT * FROM races WHERE id=?').get(raceId); }
function rows() {
 return db.prepare(`SELECT p.id participant_id,p.name,r.race_id,r.status,r.elapsed_ms,r.finish_at,r.final_score,r.faults,r.correct_answers,r.incorrect_attempts FROM results r JOIN participants p ON p.id=r.participant_id WHERE r.race_id=? ORDER BY CASE WHEN r.status='finished' THEN 0 ELSE 1 END, r.elapsed_ms ASC, r.incorrect_attempts ASC, r.finish_at ASC`).all(raceId).map((x,i)=>({...x,rank:x.status==='finished'?i+1:null}));
}
function publish() { io.to(raceId).emit('leaderboard', rows()); }
function cleanName(s) { return String(s||'').trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,32); }
function validAdminToken(token, host='') {
 const configured=process.env.ADMIN_TOKEN;
 if(!configured) return true;
 if(configured==='replace-with-a-long-random-token' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && !token) return true;
 return token===configured;
}
function getState() { return {race:currentRace(), leaderboard:rows(), participants:db.prepare("SELECT p.id,p.name,COALESCE(r.status,'ready') status FROM participants p LEFT JOIN results r ON r.participant_id=p.id AND r.race_id=? ORDER BY p.created_at").all(raceId)}; }
io.on('connection', socket => {
 socket.emit('state', getState());
 socket.on('join', (payload, ack=()=>{}) => {
  const name=cleanName(payload?.name); if(!name) return ack({error:'Enter a name (up to 32 characters).'});
  const race=currentRace(); if(race.status==='running'||race.status==='finished') return ack({error:'This race has already started. Late entries cannot join this race.'});
  const id=uuid(); db.prepare('INSERT INTO participants(id,name,created_at) VALUES(?,?,?)').run(id,name,new Date().toISOString());
  active.set(id,{socketId:socket.id, raceId, qualifyingScore:Math.max(0,Math.min(3,Number(payload?.qualifyingScore)||0)),nextCheckpoint:0}); socket.data.participantId=id; socket.join(raceId);
  ack({participantId:id, raceId}); io.to(raceId).emit('state',getState());
 });
 socket.on('host:start', (_payload,ack=()=>{}) => {
  if(!validAdminToken(_payload?.token,socket.handshake.headers.host)) return ack({error:'Invalid host token.'});
  const race=currentRace(); if(race.status!=='lobby') return ack({error:'Race is not in the lobby.'});
  const startAt=Date.now()+Math.max(3,Number(process.env.COUNTDOWN_SECONDS)||5)*1000;
  db.prepare("UPDATE races SET status='running',start_at=? WHERE id=? AND status='lobby'").run(startAt,raceId);
  const insert=db.prepare("INSERT OR IGNORE INTO results(id,participant_id,race_id,status,start_at,final_score) VALUES(?,?,?,'racing',?,?)");
  for(const p of db.prepare('SELECT id FROM participants').all()) insert.run(uuid(),p.id,raceId,startAt,1000);
  io.to(raceId).emit('race:start',{startAt,raceId}); ack({ok:true,startAt}); io.to(raceId).emit('state',getState());
 });
 socket.on('fault:trigger', (payload,ack=()=>{}) => {
  const pid=socket.data.participantId; if(!pid) return ack({error:'Join the race first.'});
  const race=currentRace(); if(race.status!=='running') return ack({error:'Race is not running.'});
  if(db.prepare("SELECT 1 FROM faults WHERE participant_id=? AND race_id=? AND repaired_at IS NULL").get(pid,raceId)) return ack({error:'A fault is already active.'});
  const requested=faultTypes.includes(payload?.fault)?payload.fault:faultTypes[Math.floor(Math.random()*faultTypes.length)];
  const already=db.prepare('SELECT question_id FROM faults WHERE participant_id=? AND race_id=?').all(pid,raceId).map(x=>x.question_id);
  const candidates=questions.filter(q=>q.fault===requested&&!already.includes(q.id));
  const pool=candidates.length?candidates:questions.filter(q=>q.fault===requested); const q=pool[Math.floor(Math.random()*pool.length)];
  const eventId=uuid(), now=Date.now();
  db.prepare('INSERT INTO faults(id,participant_id,race_id,fault_type,question_id,triggered_at) VALUES(?,?,?,?,?,?)').run(eventId,pid,raceId,requested,q.id,now);
  db.prepare('UPDATE results SET faults=faults+1 WHERE participant_id=? AND race_id=?').run(pid,raceId);
  const {answer,...publicQuestion}=q; ack({eventId,fault:requested,question:publicQuestion}); publish();
 });
 socket.on('checkpoint', (payload,ack=()=>{}) => {
  const pid=socket.data.participantId, state=pid&&active.get(pid), race=currentRace();
  if(!state||race.status!=='running'||!race.start_at) return ack({error:'Race is not active.'});
  const index=Number(payload?.index), now=Date.now();
  if(!Number.isInteger(index)||index!==state.nextCheckpoint||index<0||index>7) return ack({error:'Checkpoint is out of sequence.'});
  const minLap=30000, expected=race.start_at+index*minLap/8;
  if(now<expected) return ack({error:'Checkpoint arrived before the permitted time.'});
  state.nextCheckpoint++; ack({ok:true,next:state.nextCheckpoint});
 });
 socket.on('repair:answer', (payload,ack=()=>{}) => {
  const pid=socket.data.participantId; if(!pid) return ack({error:'Join the race first.'});
  const fault=db.prepare('SELECT * FROM faults WHERE id=? AND participant_id=? AND race_id=? AND repaired_at IS NULL').get(payload?.eventId,pid,raceId);
  if(!fault) return ack({error:'No active repair challenge.'});
  const q=questions.find(x=>x.id===fault.question_id); const correct=Number(payload?.answer)===q.answer;
  db.prepare('UPDATE faults SET attempts=attempts+1 WHERE id=?').run(fault.id);
  db.prepare('UPDATE results SET incorrect_attempts=incorrect_attempts+? WHERE participant_id=? AND race_id=?').run(correct?0:1,pid,raceId);
  if(correct) { db.prepare('UPDATE faults SET repaired_at=? WHERE id=?').run(Date.now(),fault.id); db.prepare('UPDATE results SET correct_answers=correct_answers+1 WHERE participant_id=? AND race_id=?').run(pid,raceId); }
  ack({correct,feedback:correct?'Repair complete. Systems restored.':'Incorrect diagnosis. The car remains stopped; try again.'}); publish();
 });
 socket.on('race:finish', (_payload,ack=()=>{}) => {
  const pid=socket.data.participantId; if(!pid) return ack({error:'Join the race first.'});
  const race=currentRace(); if(race.status!=='running'||!race.start_at) return ack({error:'Race is not running.'});
  const pending=db.prepare("SELECT 1 FROM faults WHERE participant_id=? AND race_id=? AND repaired_at IS NULL").get(pid,raceId); if(pending) return ack({error:'Resolve the active fault before finishing.'});
  const state=active.get(pid); if(!state||state.nextCheckpoint<8) return ack({error:'Complete all checkpoints before finishing.'});
  const finish=Date.now(); if(finish<race.start_at) return ack({error:'The official race has not started yet.'});
  const elapsed=finish-race.start_at; const upd=db.prepare("UPDATE results SET status='finished',finish_at=?,elapsed_ms=?,final_score=? WHERE participant_id=? AND race_id=? AND status='racing'").run(finish,elapsed,Math.max(0,100000-Math.floor(elapsed/10)),pid,raceId);
  if(!upd.changes) return ack({error:'A result was already recorded.'});
  ack({ok:true,elapsedMs:elapsed}); publish();
 });
 socket.on('host:reset', (payload,ack=()=>{}) => {
  if(!validAdminToken(payload?.token,socket.handshake.headers.host)) return ack({error:'Invalid host token.'});
  // Keep the old row and its dependent records intact. Rename would violate the
  // foreign keys from participants' results and fault events.
  raceId=(process.env.RACE_ID||'main-event')+'-'+Date.now();
  db.prepare("INSERT INTO races(id,status,created_at) VALUES(?, 'lobby', ?)").run(raceId,new Date().toISOString());
  active.clear();
  io.emit('race:reset',{raceId});
  io.emit('state',getState()); ack({ok:true,raceId});
 });
 socket.on('disconnect',()=>{const pid=socket.data.participantId;if(pid)active.delete(pid);});
});
app.get('/api/health',(_req,res)=>res.json({ok:true,raceId,status:currentRace().status}));
app.get('/api/questions',(_req,res)=>res.json(questions.map(({answer,...q})=>q)));
app.get('/api/results.csv',(req,res)=>{
 if(process.env.ADMIN_TOKEN&&req.query.token!==process.env.ADMIN_TOKEN)return res.status(401).send('Unauthorized');
 const data=db.prepare(`SELECT p.id AS "Participant ID",p.name AS "Participant/team name",r.race_id AS "Race ID",r.status AS "Completion status",r.elapsed_ms AS "Official elapsed time (ms)",r.finish_at AS "Finish timestamp",r.final_score AS "Final score",r.faults AS "Fault count",r.correct_answers AS "Correct answers",r.incorrect_attempts AS "Incorrect attempts",COALESCE((SELECT SUM(f.repaired_at-f.triggered_at) FROM faults f WHERE f.participant_id=p.id AND f.race_id=r.race_id),0) AS "Repair duration (ms)",CASE WHEN r.status='finished' THEN (SELECT COUNT(*) FROM results rr WHERE rr.race_id=r.race_id AND rr.status='finished' AND (rr.elapsed_ms<r.elapsed_ms OR (rr.elapsed_ms=r.elapsed_ms AND rr.incorrect_attempts<r.incorrect_attempts) OR (rr.elapsed_ms=r.elapsed_ms AND rr.incorrect_attempts=r.incorrect_attempts AND rr.finish_at<r.finish_at)))+1 ELSE '' END AS "Final rank" FROM results r JOIN participants p ON p.id=r.participant_id WHERE r.race_id=? ORDER BY r.elapsed_ms`).all(raceId);
 const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"'; const csv=data.length?[Object.keys(data[0]).map(esc).join(','),...data.map(row=>Object.values(row).map(esc).join(','))].join('\r\n'):'Participant ID,Participant/team name,Race ID,Completion status,Official elapsed time (ms),Finish timestamp,Final score,Fault count,Correct answers,Incorrect attempts,Repair duration (ms),Final rank';
 res.setHeader('content-type','text/csv; charset=utf-8');res.setHeader('content-disposition','attachment; filename="pitstop-results.csv"');res.send('\ufeff'+csv);
});
app.get('/api/results.xlsx',(req,res)=>{
 if(process.env.ADMIN_TOKEN&&req.query.token!==process.env.ADMIN_TOKEN)return res.status(401).send('Unauthorized');
 const XLSX=require('xlsx'); const csvRows=db.prepare(`SELECT p.id AS "Participant ID",p.name AS "Participant/team name",r.race_id AS "Race ID",r.status AS "Completion status",r.elapsed_ms AS "Official elapsed time (ms)",r.finish_at AS "Finish timestamp",r.final_score AS "Final score",r.faults AS "Fault count",r.correct_answers AS "Correct answers",r.incorrect_attempts AS "Incorrect attempts",COALESCE((SELECT SUM(f.repaired_at-f.triggered_at) FROM faults f WHERE f.participant_id=p.id AND f.race_id=r.race_id),0) AS "Repair duration (ms)",CASE WHEN r.status='finished' THEN (SELECT COUNT(*) FROM results rr WHERE rr.race_id=r.race_id AND rr.status='finished' AND rr.elapsed_ms<r.elapsed_ms)+1 ELSE '' END AS "Final rank" FROM results r JOIN participants p ON p.id=r.participant_id WHERE r.race_id=?`).all(raceId);
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(csvRows),'Results');res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('content-disposition','attachment; filename="pitstop-results.xlsx"');res.send(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
});
const port=Number(process.env.PORT)||3000; server.listen(port,()=>console.log(`Pit Stop Protocol running at http://localhost:${port} (race ${raceId}, DB ${dbFile})`));
