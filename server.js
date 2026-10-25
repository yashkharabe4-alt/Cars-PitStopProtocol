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
const db = new Database(dbFile);db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS races(id TEXT PRIMARY KEY, status TEXT NOT NULL, start_at INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS faults(id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id), race_id TEXT NOT NULL REFERENCES races(id), fault_type TEXT NOT NULL, question_id TEXT NOT NULL, triggered_at INTEGER NOT NULL, repaired_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id), race_id TEXT NOT NULL REFERENCES races(id), status TEXT NOT NULL, start_at INTEGER NOT NULL, finish_at INTEGER, elapsed_ms INTEGER, faults INTEGER NOT NULL DEFAULT 0, correct_answers INTEGER NOT NULL DEFAULT 0, incorrect_attempts INTEGER NOT NULL DEFAULT 0, final_score INTEGER NOT NULL DEFAULT 0, UNIQUE(participant_id, race_id));
`);
try { db.exec("ALTER TABLE participants ADD COLUMN car_color TEXT NOT NULL DEFAULT '#ff5934'"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
let raceId = process.env.RACE_ID || 'main-event';
db.prepare("INSERT OR IGNORE INTO races(id,status,created_at) VALUES(?, 'lobby', ?)").run(raceId, new Date().toISOString());
if(db.prepare('SELECT 1 FROM participants LIMIT 1').get()||db.prepare("SELECT 1 FROM races WHERE id=? AND status!='lobby'").get(raceId)){raceId=`${process.env.RACE_ID||'main-event'}-${Date.now()}`;db.prepare("INSERT INTO races(id,status,created_at) VALUES(?, 'lobby', ?)").run(raceId,new Date().toISOString());}
const active = new Map();
let raceEndTimer=null,raceEndsAt=null,nextGridStartAt=null;
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
 return db.prepare(`SELECT p.id participant_id,p.name,p.car_color,r.race_id,r.status,r.elapsed_ms,r.finish_at,r.final_score,r.faults,r.correct_answers,r.incorrect_attempts FROM results r JOIN participants p ON p.id=r.participant_id WHERE r.race_id=? ORDER BY CASE WHEN r.status='finished' THEN 0 ELSE 1 END, r.final_score DESC, r.elapsed_ms ASC, r.incorrect_attempts ASC, r.finish_at ASC`).all(raceId).map((x,i)=>({...x,rank:x.status==='finished'?i+1:null}));
}
function publish() { io.to(raceId).emit('leaderboard', rows()); }
function cleanName(s) { return String(s||'').trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,32); }
function getState() { return {race:currentRace(), leaderboard:rows(), participants:db.prepare("SELECT p.id,p.name,r.status FROM participants p JOIN results r ON r.participant_id=p.id WHERE r.race_id=? ORDER BY p.created_at").all(raceId)}; }
function finalizeRace(){const race=currentRace();if(!race||race.status!=='running')return;db.prepare("UPDATE results SET status='dnf' WHERE race_id=? AND status IN ('ready','racing')").run(raceId);db.prepare("UPDATE races SET status='finished' WHERE id=?").run(raceId);const finalRows=rows();io.to(raceId).emit('race:final',{raceId,leaderboard:finalRows});publish();io.to(raceId).emit('state',getState());}
function freshRace(){raceId=`main-event-${Date.now()}`;db.prepare("INSERT INTO races(id,status,created_at) VALUES(?, 'lobby', ?)").run(raceId,new Date().toISOString());clearTimeout(raceEndTimer);raceEndsAt=null;nextGridStartAt=null;active.clear();for(const client of io.sockets.sockets.values()){for(const room of [...client.rooms])if(room!==client.id)client.leave(room);client.join(raceId);}io.emit('race:reset',{raceId});io.to(raceId).emit('state',getState());}
function openRace(){const race=currentRace();if(race.status!=='lobby')return;const startAt=Date.now()+2000,duration=Math.max(60,Math.min(1800,Number(process.env.RACE_DURATION_SECONDS)||300)),endsAt=raceEndsAt=startAt+duration*1000;db.prepare("UPDATE races SET status='running',start_at=? WHERE id=? AND status='lobby'").run(startAt,raceId);const ready=[...active.entries()].filter(([,s])=>s.raceId===raceId&&s.qualifyAt).sort((a,b)=>a[1].qualifyAt-b[1].qualifyAt);ready.forEach(([pid,state],index)=>{const driverStart=startAt+index*4000;state.startAt=driverStart;state.nextCheckpoint=0;db.prepare("UPDATE results SET status='racing',start_at=?,final_score=? WHERE participant_id=? AND race_id=?").run(driverStart,state.qualifyingScore*100,pid,raceId);io.to(state.socketId).emit('race:driverStart',{startAt:driverStart,endsAt,color:state.color});});nextGridStartAt=startAt+ready.length*4000;io.to(raceId).emit('race:open',{startAt,endsAt,raceId,staggerSeconds:4});io.to(raceId).emit('state',getState());clearTimeout(raceEndTimer);raceEndTimer=setTimeout(()=>finalizeRace(),Math.max(0,endsAt-Date.now()));}
function startQualifiedDrivers(){const race=currentRace();if(race.status!=='running')return;const ready=[...active.entries()].filter(([,s])=>s.raceId===raceId&&s.qualifyAt&&!s.startAt).sort((a,b)=>a[1].qualifyAt-b[1].qualifyAt);let next=Math.max(Date.now()+1000,race.start_at||0,nextGridStartAt||0);for(const [pid,state] of ready){state.startAt=next;state.nextCheckpoint=0;db.prepare("UPDATE results SET status='racing',start_at=?,final_score=? WHERE participant_id=? AND race_id=?").run(next,state.qualifyingScore*100,pid,raceId);io.to(state.socketId).emit('race:driverStart',{startAt:next,endsAt:raceEndsAt,color:state.color});next+=4000;}nextGridStartAt=next;}
function requireAdmin(payload){return Boolean(process.env.ADMIN_TOKEN)&&String(payload?.token||'')===process.env.ADMIN_TOKEN;}
io.on('connection', socket => {
 socket.join(raceId);
 socket.emit('state', getState());
 socket.on('join', (payload, ack=()=>{}) => {
  const name=cleanName(payload?.name); if(!name) return ack({error:'Enter a name (up to 32 characters).'});
  if(currentRace().status==='finished')freshRace();
  const race=currentRace();
  const allowedColors=['#e83e32','#2588d8','#f3c52f'];const color=allowedColors.includes(String(payload?.carColor||'').toLowerCase())?String(payload.carColor).toLowerCase():'#e83e32';const id=uuid(); db.prepare('INSERT INTO participants(id,name,created_at,car_color) VALUES(?,?,?,?)').run(id,name,new Date().toISOString(),color);
  active.set(id,{socketId:socket.id,raceId,color,qualifyingScore:0,qualifyAt:null,nextCheckpoint:0,startAt:null});socket.data.participantId=id;socket.join(raceId);db.prepare("INSERT INTO results(id,participant_id,race_id,status,start_at,final_score) VALUES(?,?,?,'ready',0,0)").run(uuid(),id,raceId);
  ack({participantId:id, raceId, carColor:color}); io.to(raceId).emit('state',getState());
 });
 socket.on('driver:qualify',(payload,ack=()=>{})=>{const pid=socket.data.participantId,state=pid&&active.get(pid),race=currentRace();if(!state||race.status==='finished')return ack({error:'This race has ended. Re-enter the garage for the next race.'});if(state.qualifyAt)return ack({error:'Quiz already submitted.'});state.qualifyingScore=Math.max(0,Math.min(3,Number(payload?.score)||0));state.qualifyAt=Date.now();db.prepare('UPDATE results SET final_score=? WHERE participant_id=? AND race_id=?').run(state.qualifyingScore*100,pid,raceId);if(race.status==='running')startQualifiedDrivers();ack({ok:true,waiting:true});publish();io.to(raceId).emit('state',getState());});
 socket.on('host:start',(payload,ack=()=>{})=>{if(!requireAdmin(payload))return ack({error:'Invalid admin token.'});if(currentRace().status!=='lobby')return ack({error:'Race is not in the lobby.'});openRace();startQualifiedDrivers();ack({ok:true,message:'Race started; qualified drivers are being gridded.'});});
 socket.on('host:stop',(payload,ack=()=>{})=>{if(!requireAdmin(payload))return ack({error:'Invalid admin token.'});if(currentRace().status!=='running')return ack({error:'There is no running race to end.'});clearTimeout(raceEndTimer);finalizeRace();ack({ok:true,message:'Race ended and official results displayed.'});});
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
  if(!state||race.status!=='running'||!state.startAt) return ack({error:'Race is not active.'});
  const index=Number(payload?.index), now=Date.now();
  if(!Number.isInteger(index)||index!==state.nextCheckpoint||index<0||index>7) return ack({error:'Checkpoint is out of sequence.'});
  const minLap=30000, expected=state.startAt+index*minLap/8;
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
  db.prepare('UPDATE faults SET repaired_at=? WHERE id=?').run(Date.now(),fault.id);if(correct)db.prepare('UPDATE results SET correct_answers=correct_answers+1 WHERE participant_id=? AND race_id=?').run(pid,raceId);
  ack({correct,feedback:correct?'Repair complete. Systems restored.':'Incorrect diagnosis. One attempt used; vehicle speed is limited.'});publish();
 });
 socket.on('race:finish', (_payload,ack=()=>{}) => {
  const pid=socket.data.participantId; if(!pid) return ack({error:'Join the race first.'});
  const race=currentRace(); if(race.status!=='running'||!race.start_at) return ack({error:'Race is not running.'});
  const pending=db.prepare("SELECT 1 FROM faults WHERE participant_id=? AND race_id=? AND repaired_at IS NULL").get(pid,raceId); if(pending) return ack({error:'Resolve the active fault before finishing.'});
  const state=active.get(pid); if(!state||state.nextCheckpoint<8) return ack({error:'Complete all checkpoints before finishing.'});
  const finish=Date.now(); if(finish<race.start_at) return ack({error:'The official race has not started yet.'});
  const elapsed=finish-state.startAt; const upd=db.prepare("UPDATE results SET status='finished',finish_at=?,elapsed_ms=?,final_score=? WHERE participant_id=? AND race_id=? AND status='racing'").run(finish,elapsed,Math.max(0,state.qualifyingScore*100+100000-Math.floor(elapsed/10)),pid,raceId);
  if(!upd.changes) return ack({error:'A result was already recorded.'});
  ack({ok:true,elapsedMs:elapsed,waitingOfficial:true});publish();io.to(raceId).emit('state',getState());
 });
 socket.on('disconnect',()=>{const pid=socket.data.participantId;if(pid)active.delete(pid);});
});
app.get('/api/health',(_req,res)=>res.json({ok:true,raceId,status:currentRace().status}));
app.get('/api/questions',(_req,res)=>res.json(questions.map(({answer,...q})=>q)));
app.get('/api/results.csv',(req,res)=>{
 if(process.env.ADMIN_TOKEN&&req.query.token!==process.env.ADMIN_TOKEN)return res.status(401).send('Unauthorized');
 if(currentRace().status!=='finished')return res.status(409).send('Official results are available after the race timer ends.');
 const data=db.prepare(`SELECT p.id AS "Participant ID",p.name AS "Participant/team name",r.race_id AS "Race ID",r.status AS "Completion status",r.elapsed_ms AS "Official elapsed time (ms)",r.finish_at AS "Finish timestamp",r.final_score AS "Final score",r.faults AS "Fault count",r.correct_answers AS "Correct answers",r.incorrect_attempts AS "Incorrect attempts",COALESCE((SELECT SUM(f.repaired_at-f.triggered_at) FROM faults f WHERE f.participant_id=p.id AND f.race_id=r.race_id),0) AS "Repair duration (ms)",CASE WHEN r.status='finished' THEN (SELECT COUNT(*) FROM results rr WHERE rr.race_id=r.race_id AND rr.status='finished' AND (rr.elapsed_ms<r.elapsed_ms OR (rr.elapsed_ms=r.elapsed_ms AND rr.incorrect_attempts<r.incorrect_attempts) OR (rr.elapsed_ms=r.elapsed_ms AND rr.incorrect_attempts=r.incorrect_attempts AND rr.finish_at<r.finish_at)))+1 ELSE '' END AS "Final rank" FROM results r JOIN participants p ON p.id=r.participant_id WHERE r.race_id=? ORDER BY CASE WHEN r.status='finished' THEN 0 ELSE 1 END,r.final_score DESC,r.elapsed_ms ASC`).all(raceId);
 const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"'; const csv=data.length?[Object.keys(data[0]).map(esc).join(','),...data.map(row=>Object.values(row).map(esc).join(','))].join('\r\n'):'Participant ID,Participant/team name,Race ID,Completion status,Official elapsed time (ms),Finish timestamp,Final score,Fault count,Correct answers,Incorrect attempts,Repair duration (ms),Final rank';
 res.setHeader('content-type','text/csv; charset=utf-8');res.setHeader('content-disposition','attachment; filename="pitstop-results.csv"');res.send('\ufeff'+csv);
});
app.get('/api/results.xlsx',(req,res)=>{
 if(process.env.ADMIN_TOKEN&&req.query.token!==process.env.ADMIN_TOKEN)return res.status(401).send('Unauthorized');
 if(currentRace().status!=='finished')return res.status(409).send('Official results are available after the race timer ends.');
 const XLSX=require('xlsx'); const csvRows=db.prepare(`SELECT p.id AS "Participant ID",p.name AS "Participant/team name",r.race_id AS "Race ID",r.status AS "Completion status",r.elapsed_ms AS "Official elapsed time (ms)",r.finish_at AS "Finish timestamp",r.final_score AS "Final score",r.faults AS "Fault count",r.correct_answers AS "Correct answers",r.incorrect_attempts AS "Incorrect attempts",COALESCE((SELECT SUM(f.repaired_at-f.triggered_at) FROM faults f WHERE f.participant_id=p.id AND f.race_id=r.race_id),0) AS "Repair duration (ms)",CASE WHEN r.status='finished' THEN (SELECT COUNT(*) FROM results rr WHERE rr.race_id=r.race_id AND rr.status='finished' AND rr.elapsed_ms<r.elapsed_ms)+1 ELSE '' END AS "Final rank" FROM results r JOIN participants p ON p.id=r.participant_id WHERE r.race_id=? ORDER BY CASE WHEN r.status='finished' THEN 0 ELSE 1 END,r.final_score DESC,r.elapsed_ms ASC`).all(raceId);
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(csvRows),'Results');res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('content-disposition','attachment; filename="pitstop-results.xlsx"');res.send(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
});
const port=Number(process.env.PORT)||3000; server.listen(port,()=>console.log(`Pit Stop Protocol running at http://localhost:${port} (race ${raceId}, DB ${dbFile})`));
