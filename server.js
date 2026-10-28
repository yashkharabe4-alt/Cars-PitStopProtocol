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
for (const [column, definition] of [['lead_name', "TEXT NOT NULL DEFAULT ''"], ['lead_phone', "TEXT NOT NULL DEFAULT ''"]]) { try { db.exec(`ALTER TABLE participants ADD COLUMN ${column} ${definition}`); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; } }
let raceId = process.env.RACE_ID || 'main-event';
db.prepare("INSERT OR IGNORE INTO races(id,status,created_at) VALUES(?, 'lobby', ?)").run(raceId, new Date().toISOString());
if(db.prepare('SELECT 1 FROM participants LIMIT 1').get()||db.prepare("SELECT 1 FROM races WHERE id=? AND status!='lobby'").get(raceId)){raceId=`${process.env.RACE_ID||'main-event'}-${Date.now()}`;db.prepare("INSERT INTO races(id,status,created_at) VALUES(?, 'lobby', ?)").run(raceId,new Date().toISOString());}
const active = new Map();
let raceEndTimer=null,raceEndsAt=null,nextGridStartAt=null;
const questions = [
 {id:'q1',fault:'engine',text:'Two fair dice are rolled. What is the probability that their total is 8?',options:['1/6','5/36','1/9','7/36'],answer:1,difficulty:'medium'},
 {id:'q2',fault:'brake',text:'What does this C code print? int a[]={2,4,6,8}; int s=0; for(int i=0;i<4;i+=2) s+=a[i]; printf("%d",s);',options:['8','10','12','20'],answer:0,difficulty:'medium'},
 {id:'q3',fault:'fuel',text:'A car uses 5.5 L per 100 km. About how much fuel will it use over 720 km?',options:['36.6 L','39.6 L','41.2 L','45 L'],answer:1,difficulty:'medium'},
 {id:'q4',fault:'temperature',text:'A car’s temperature is 92°C and falls by 6°C each minute. What is it after 7 minutes at that rate?',options:['44°C','48°C','50°C','56°C'],answer:2,difficulty:'medium'},
 {id:'q5',fault:'speed',text:'A 180 m train passes a pole in 12 seconds. What is its speed in km/h?',options:['45','54','60','72'],answer:1,difficulty:'medium'},
 {id:'q6',fault:'engine',text:'Find the next number: 3, 8, 18, 38, __',options:['58','68','76','78'],answer:3,difficulty:'medium'},
 {id:'q7',fault:'brake',text:'What does this Python code print? values=[1,2,3,4,5]; print(values[1::2])',options:['[1, 3, 5]','[2, 4]','[2, 3, 4]','[1, 2]'],answer:1,difficulty:'medium'},
 {id:'q8',fault:'fuel',text:'A vehicle travels 150 km using 12 L. At the same rate, how far can it travel with 25 L?',options:['300 km','312.5 km','325 km','337.5 km'],answer:1,difficulty:'medium'},
 {id:'q9',fault:'temperature',text:'Four temperature readings average 75°C. Three are 70°C, 72°C, and 78°C. What is the fourth?',options:['78°C','80°C','82°C','84°C'],answer:1,difficulty:'medium'},
 {id:'q10',fault:'speed',text:'A trip lasts 2 hours: the first hour is driven at 40 km/h and the second at 60 km/h. How far was travelled in total?',options:['90 km','100 km','110 km','120 km'],answer:1,difficulty:'medium'},
 {id:'q11',fault:'engine',text:'What does this C code print? int x=29; x/=4; printf("%d",x);',options:['6','7','7.25','8'],answer:1,difficulty:'medium'},
 {id:'q12',fault:'brake',text:'A sorted list has 64 items. In the worst case, how many comparisons does binary search need?',options:['6','7','32','64'],answer:1,difficulty:'medium'},
 {id:'q13',fault:'fuel',text:'A 25 L mixture uses a fuel-to-additive ratio of 3:2. How many litres are fuel?',options:['10 L','12.5 L','15 L','18 L'],answer:2,difficulty:'medium'},
 {id:'q14',fault:'temperature',text:'A sensor rises from 68°C to 86°C over 6 minutes. What is the average increase per minute?',options:['2°C','3°C','4°C','6°C'],answer:1,difficulty:'medium'},
 {id:'q15',fault:'speed',text:'How many times does this C loop run? for (int i=1; i<10; i+=3)',options:['2','3','4','5'],answer:1,difficulty:'medium'}
];
const faultTypes = ['engine','brake','fuel','temperature','speed'];
const uuid = () => require('crypto').randomUUID();
function currentRace() { return db.prepare('SELECT * FROM races WHERE id=?').get(raceId); }
function rows() {
 return db.prepare(`SELECT p.id participant_id,p.name,p.car_color,r.race_id,r.status,r.elapsed_ms,r.finish_at,r.final_score,r.faults,r.correct_answers,r.incorrect_attempts FROM results r JOIN participants p ON p.id=r.participant_id WHERE r.race_id=? ORDER BY CASE WHEN r.status='finished' THEN 0 ELSE 1 END, r.final_score DESC, r.elapsed_ms ASC, r.incorrect_attempts ASC, r.finish_at ASC`).all(raceId).map((x,i)=>({...x,rank:x.status==='finished'?i+1:null}));
}
function cleanName(s) { return String(s||'').trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,32); }
function getState() { const race=currentRace();return {race:race?{id:race.id,status:race.status,start_at:race.start_at}:null}; }
function finalizeRace(){const race=currentRace();if(!race||race.status!=='running')return;db.prepare("UPDATE results SET status='dnf' WHERE race_id=? AND status IN ('ready','racing')").run(raceId);db.prepare("UPDATE races SET status='finished' WHERE id=?").run(raceId);io.to(raceId).emit('race:final',{raceId});io.to(raceId).emit('state',getState());}
function freshRace(){raceId=`main-event-${Date.now()}`;db.prepare("INSERT INTO races(id,status,created_at) VALUES(?, 'lobby', ?)").run(raceId,new Date().toISOString());clearTimeout(raceEndTimer);raceEndsAt=null;nextGridStartAt=null;active.clear();for(const client of io.sockets.sockets.values()){for(const room of [...client.rooms])if(room!==client.id)client.leave(room);client.join(raceId);}io.emit('race:reset',{raceId});io.to(raceId).emit('state',getState());}
function startDriver(pid,state,delay=0){if(!state||!state.socketId||state.startAt)return;const startAt=Date.now()+delay;state.startAt=startAt;db.prepare("UPDATE results SET status='racing',start_at=?,final_score=? WHERE participant_id=? AND race_id=? AND status='ready'").run(startAt,state.qualifyingScore*100,pid,raceId);io.to(state.socketId).emit('race:driverStart',{startAt,color:state.color});}
function openRace(){const race=currentRace();if(race.status!=='lobby')return;const startAt=Date.now()+2000,duration=Math.max(60,Math.min(7200,Number(process.env.RACE_DURATION_SECONDS)||7200)),endsAt=raceEndsAt=startAt+duration*1000;db.prepare("UPDATE races SET status='running',start_at=? WHERE id=? AND status='lobby'").run(startAt,raceId);for(const [pid,state] of active.entries())if(state.raceId===raceId&&state.qualifyAt)startDriver(pid,state,Math.max(0,startAt-Date.now()));io.to(raceId).emit('race:open',{startAt,endsAt,raceId});io.to(raceId).emit('state',getState());clearTimeout(raceEndTimer);raceEndTimer=setTimeout(()=>finalizeRace(),Math.max(0,endsAt-Date.now()));}
function startQualifiedDrivers(){if(currentRace().status!=='running')return;for(const [pid,state] of active.entries())if(state.raceId===raceId&&state.qualifyAt&&!state.startAt)startDriver(pid,state,1000);}
function requireAdmin(payload){return Boolean(process.env.ADMIN_TOKEN)&&String(payload?.token||'')===process.env.ADMIN_TOKEN;}
function requireAdminRequest(req,res,next){const header=String(req.get('authorization')||'');const token=header.replace(/^Bearer\s+/i,'')||req.query.token||'';if(!requireAdmin({token}))return res.status(401).send('Unauthorized');next();}
io.on('connection', socket => {
 socket.join(raceId);
 socket.emit('state', getState());
 socket.on('join', (payload, ack=()=>{}) => {
  const name=cleanName(payload?.teamName||payload?.name),leadName=cleanName(payload?.leadName),phone=String(payload?.phone||'').trim().replace(/[^+0-9 ()-]/g,'').slice(0,24); if(!name) return ack({error:'Enter your team name.'}); if(!leadName) return ack({error:'Enter the team lead name.'}); if(phone.replace(/\D/g,'').length<7) return ack({error:'Enter a valid team lead phone number.'});
  if(currentRace().status==='finished')freshRace();
  const race=currentRace();
  const allowedColors=['#e83e32','#2588d8','#f3c52f'];const color=allowedColors.includes(String(payload?.carColor||'').toLowerCase())?String(payload.carColor).toLowerCase():'#e83e32';const id=uuid(); db.prepare('INSERT INTO participants(id,name,created_at,car_color,lead_name,lead_phone) VALUES(?,?,?,?,?,?)').run(id,name,new Date().toISOString(),color,leadName,phone);
  active.set(id,{socketId:socket.id,raceId,color,qualifyingScore:0,qualifyAt:null,startAt:null,speedCapKmh:60,speedLocked:false});socket.data.participantId=id;socket.join(raceId);db.prepare("INSERT INTO results(id,participant_id,race_id,status,start_at,final_score) VALUES(?,?,?,'ready',0,0)").run(uuid(),id,raceId);
  ack({participantId:id, raceId, carColor:color,raceStatus:race.status}); io.to(raceId).emit('state',getState());
 });
 socket.on('vehicle:color', (payload, ack=()=>{}) => { const pid=socket.data.participantId,state=pid&&active.get(pid),allowed=['#e83e32','#2588d8','#f3c52f'],color=String(payload?.carColor||'').toLowerCase(); if(!state||!allowed.includes(color))return ack({error:'Choose a listed car color.'}); state.color=color; db.prepare('UPDATE participants SET car_color=? WHERE id=?').run(color,pid); ack({ok:true}); });
 socket.on('driver:qualify',(payload,ack=()=>{})=>{const pid=socket.data.participantId,state=pid&&active.get(pid),race=currentRace();if(!state||race.status==='finished')return ack({error:'This race has ended. Re-enter the garage for the next race.'});if(state.qualifyAt)return ack({error:'Quiz already submitted.'});state.qualifyingScore=Math.max(0,Math.min(10,Number(payload?.score)||0));state.qualifyAt=Date.now();db.prepare('UPDATE results SET final_score=? WHERE participant_id=? AND race_id=?').run(state.qualifyingScore*100,pid,raceId);if(race.status==='running')startQualifiedDrivers();ack({ok:true,waiting:true});io.to(state.socketId).emit('state',getState());});
 socket.on('driver:resume',(payload,ack=()=>{})=>{const pid=String(payload?.participantId||''),state=active.get(pid),race=currentRace();if(!state||state.raceId!==raceId||race.status!=='running')return ack({error:'Your active race session could not be restored. Please rejoin the next race.'});const result=db.prepare('SELECT status,start_at FROM results WHERE participant_id=? AND race_id=?').get(pid,raceId);if(!result||!['ready','racing'].includes(result.status))return ack({error:'Your active race session could not be restored.'});state.socketId=socket.id;socket.data.participantId=pid;socket.join(raceId);const pending=db.prepare('SELECT * FROM faults WHERE participant_id=? AND race_id=? AND repaired_at IS NULL').get(pid,raceId),q=pending&&questions.find(x=>x.id===pending.question_id);let activeFault=null;if(pending&&q){const {answer,...publicQuestion}=q;activeFault={eventId:pending.id,fault:pending.fault_type,question:publicQuestion};}ack({ok:true,raceId,status:result.status,startAt:state.startAt||result.start_at,color:state.color,qualified:Boolean(state.qualifyAt),speedCapKmh:state.speedCapKmh||60,activeFault,retryAt:state.retryAt||null});if(result.status==='racing')socket.emit('race:driverStart',{startAt:state.startAt||result.start_at,color:state.color,resume:true,activeFault,retryAt:state.retryAt||null});});
 socket.on('host:start',(payload,ack=()=>{})=>{if(!requireAdmin(payload))return ack({error:'Invalid admin token.'});if(currentRace().status!=='lobby')return ack({error:'Race is not in the lobby.'});openRace();startQualifiedDrivers();ack({ok:true,message:'Race started; qualified drivers are being gridded.'});});
 socket.on('host:validate',(payload,ack=()=>{})=>{if(!requireAdmin(payload))return ack({error:'Invalid admin token.'});ack({ok:true});});
 socket.on('host:stop',(payload,ack=()=>{})=>{if(!requireAdmin(payload))return ack({error:'Invalid admin token.'});if(currentRace().status!=='running')return ack({error:'There is no running event to end.'});clearTimeout(raceEndTimer);finalizeRace();ack({ok:true,message:'Race ended.'});});
 socket.on('host:results',(payload,ack=()=>{})=>{if(!requireAdmin(payload))return ack({error:'Invalid admin token.'});const race=currentRace();if(race.status!=='finished')return ack({error:'Race has not ended yet.'});ack({raceId, race:{id:race.id,status:race.status}});});
 socket.on('fault:trigger', (payload,ack=()=>{}) => {
  const pid=socket.data.participantId, state=pid&&active.get(pid); if(!state) return ack({error:'Join the race first.'});
  const race=currentRace(); if(race.status!=='running') return ack({error:'Race is not running.'});
  if(state.retryAt&&Date.now()<state.retryAt)return ack({error:'Incorrect answer. Continue in safe mode for '+Math.ceil((state.retryAt-Date.now())/1000)+' more seconds.',retryAt:state.retryAt,speedCapKmh:40});
  const activeFault=db.prepare("SELECT * FROM faults WHERE participant_id=? AND race_id=? AND repaired_at IS NULL").get(pid,raceId);
  if(activeFault){const q=questions.find(x=>x.id===activeFault.question_id);if(!q)return ack({error:'The active repair question could not be loaded.'});const {answer,...publicQuestion}=q;state.speedCapKmh=5;return ack({eventId:activeFault.id,fault:activeFault.fault_type,question:publicQuestion,alreadyActive:true,speedCapKmh:5});}
  const requested=faultTypes.includes(payload?.fault)?payload.fault:faultTypes[Math.floor(Math.random()*faultTypes.length)];
  const already=db.prepare('SELECT question_id FROM faults WHERE participant_id=? AND race_id=?').all(pid,raceId).map(x=>x.question_id);
  const candidates=questions.filter(q=>q.fault===requested&&!already.includes(q.id));
  const pool=candidates.length?candidates:questions.filter(q=>q.fault===requested); const q=pool[Math.floor(Math.random()*pool.length)];
  const eventId=uuid(), now=Date.now();
  db.prepare('INSERT INTO faults(id,participant_id,race_id,fault_type,question_id,triggered_at) VALUES(?,?,?,?,?,?)').run(eventId,pid,raceId,requested,q.id,now);state.speedCapKmh=5;
  db.prepare('UPDATE results SET faults=faults+1 WHERE participant_id=? AND race_id=?').run(pid,raceId);
  const {answer,...publicQuestion}=q; ack({eventId,fault:requested,question:publicQuestion,speedCapKmh:5});
 });
 socket.on('repair:answer', (payload,ack=()=>{}) => {
  const pid=socket.data.participantId; if(!pid) return ack({error:'Join the race first.'});
  const state=active.get(pid);if(state?.retryAt&&Date.now()<state.retryAt)return ack({error:'Incorrect answer. Please wait '+Math.ceil((state.retryAt-Date.now())/1000)+' seconds before trying again.',retryAt:state.retryAt});
  const fault=db.prepare('SELECT * FROM faults WHERE id=? AND participant_id=? AND race_id=? AND repaired_at IS NULL').get(payload?.eventId,pid,raceId);
  if(!fault) return ack({error:'No active repair challenge.'});
  const q=questions.find(x=>x.id===fault.question_id); const correct=Number(payload?.answer)===q.answer;
  const retryAt=Number(payload?.answer)===q.answer?null:Date.now()+25000;
  db.prepare('UPDATE faults SET attempts=attempts+1 WHERE id=?').run(fault.id);
  db.prepare('UPDATE results SET incorrect_attempts=incorrect_attempts+? WHERE participant_id=? AND race_id=?').run(correct?0:1,pid,raceId);
  db.prepare('UPDATE faults SET repaired_at=? WHERE id=?').run(Date.now(),fault.id);if(correct)db.prepare('UPDATE results SET correct_answers=correct_answers+1 WHERE participant_id=? AND race_id=?').run(pid,raceId);
  if(state){state.speedLocked=!correct;state.speedCapKmh=state.speedLocked?40:60;state.retryAt=retryAt;}ack({correct,correctAnswer:q.options[q.answer],speedCapKmh:state?.speedCapKmh||60,retryAt,feedback:correct?'Repair complete. Systems restored.':'Incorrect answer. Wait 25 seconds before continuing; safe mode is active.'});
 });
 socket.on('race:finish', (_payload,ack=()=>{}) => {
  const pid=socket.data.participantId; if(!pid) return ack({error:'Join the race first.'});
  const race=currentRace(); if(race.status!=='running'||!race.start_at) return ack({error:'Race is not running.'});
  const pending=db.prepare("SELECT 1 FROM faults WHERE participant_id=? AND race_id=? AND repaired_at IS NULL").get(pid,raceId); if(pending) return ack({error:'Resolve the active fault before finishing.'});
  const state=active.get(pid); if(!state) return ack({error:'Race session is disconnected. Reconnect to resume.'});
  const finish=Date.now(); if(finish<race.start_at) return ack({error:'The official race has not started yet.'});
  const elapsed=finish-state.startAt; const upd=db.prepare("UPDATE results SET status='finished',finish_at=?,elapsed_ms=?,final_score=? WHERE participant_id=? AND race_id=? AND status='racing'").run(finish,elapsed,Math.max(0,state.qualifyingScore*100+100000-Math.floor(elapsed/10)),pid,raceId);
  if(!upd.changes) return ack({error:'A result was already recorded.'});
  ack({ok:true,elapsedMs:elapsed});socket.emit('race:ended',{elapsedMs:elapsed});
 });
 socket.on('disconnect',()=>{const pid=socket.data.participantId,state=pid&&active.get(pid);if(state?.socketId===socket.id)state.socketId=null;});
});
app.get('/api/health',(_req,res)=>res.json({ok:true,raceId,status:currentRace().status}));
app.get('/api/questions',(_req,res)=>res.json(questions.map(({answer,...q})=>q)));
app.get('/api/results.csv',requireAdminRequest,(req,res)=>{
 if(currentRace().status!=='finished')return res.status(409).send('Exports unlock when the race ends.');
 const data=db.prepare(`SELECT p.id AS "Participant ID",p.name AS "Participant/team name",p.lead_name AS "Team lead",p.lead_phone AS "Team lead phone",r.race_id AS "Race ID",r.status AS "Completion status",r.elapsed_ms AS "Race time (seconds)",r.elapsed_ms AS "Official elapsed time (ms)",r.finish_at AS "Finish timestamp",r.final_score AS "Final score",r.faults AS "Fault count",r.correct_answers AS "Correct answers",r.incorrect_attempts AS "Incorrect attempts",COALESCE((SELECT SUM(f.repaired_at-f.triggered_at) FROM faults f WHERE f.participant_id=p.id AND f.race_id=r.race_id),0) AS "Repair duration (ms)",CASE WHEN r.status='finished' THEN (SELECT COUNT(*) FROM results rr WHERE rr.race_id=r.race_id AND rr.status='finished' AND (rr.elapsed_ms<r.elapsed_ms OR (rr.elapsed_ms=r.elapsed_ms AND rr.incorrect_attempts<r.incorrect_attempts) OR (rr.elapsed_ms=r.elapsed_ms AND rr.incorrect_attempts=r.incorrect_attempts AND rr.finish_at<r.finish_at)))+1 ELSE '' END AS "Final rank" FROM results r JOIN participants p ON p.id=r.participant_id WHERE r.race_id=? ORDER BY CASE WHEN r.status='finished' THEN 0 ELSE 1 END,r.final_score DESC,r.elapsed_ms ASC`).all(raceId).map(row=>({...row,'Race time (seconds)':row['Race time (seconds)']==null?'':row['Race time (seconds)']/1000}));
 const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"'; const csv=data.length?[Object.keys(data[0]).map(esc).join(','),...data.map(row=>Object.values(row).map(esc).join(','))].join('\r\n'):'Participant ID,Participant/team name,Race ID,Completion status,Official elapsed time (ms),Finish timestamp,Final score,Fault count,Correct answers,Incorrect attempts,Repair duration (ms),Final rank';
 res.setHeader('content-type','text/csv; charset=utf-8');res.setHeader('content-disposition','attachment; filename="pitstop-results.csv"');res.send('\ufeff'+csv);
});
app.get('/api/results.xlsx',requireAdminRequest,(req,res)=>{
 if(currentRace().status!=='finished')return res.status(409).send('Exports unlock when the race ends.');
 const XLSX=require('xlsx'); const csvRows=db.prepare(`SELECT p.id AS "Participant ID",p.name AS "Participant/team name",p.lead_name AS "Team lead",p.lead_phone AS "Team lead phone",r.race_id AS "Race ID",r.status AS "Completion status",r.elapsed_ms AS "Race time (seconds)",r.elapsed_ms AS "Official elapsed time (ms)",r.finish_at AS "Finish timestamp",r.final_score AS "Final score",r.faults AS "Fault count",r.correct_answers AS "Correct answers",r.incorrect_attempts AS "Incorrect attempts",COALESCE((SELECT SUM(f.repaired_at-f.triggered_at) FROM faults f WHERE f.participant_id=p.id AND f.race_id=r.race_id),0) AS "Repair duration (ms)",CASE WHEN r.status='finished' THEN (SELECT COUNT(*) FROM results rr WHERE rr.race_id=r.race_id AND rr.status='finished' AND rr.elapsed_ms<r.elapsed_ms)+1 ELSE '' END AS "Final rank" FROM results r JOIN participants p ON p.id=r.participant_id WHERE r.race_id=? ORDER BY CASE WHEN r.status='finished' THEN 0 ELSE 1 END,r.final_score DESC,r.elapsed_ms ASC`).all(raceId).map(row=>({...row,'Race time (seconds)':row['Race time (seconds)']==null?'':row['Race time (seconds)']/1000}));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(csvRows),'Results');res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('content-disposition','attachment; filename="pitstop-results.xlsx"');res.send(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
});
const port=Number(process.env.PORT)||3000; server.listen(port,'0.0.0.0',()=>console.log(`Pit Stop Protocol running at http://localhost:${port} (race ${raceId}, DB ${dbFile})`));
