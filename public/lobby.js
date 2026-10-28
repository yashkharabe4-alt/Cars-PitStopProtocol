(() => {
  let supabase = null;
  let raceChannel = null;
  const api = async (route, { method = 'GET', body, participantId = sessionStorage.getItem('pitstopParticipantId'), token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (participantId) headers['X-Participant-Id'] = participantId;
    const participantToken = sessionStorage.getItem('pitstopSessionToken');
    if (participantToken) headers['X-Participant-Token'] = participantToken;
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api/${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const type = response.headers.get('content-type') || '';
    const result = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(result?.error || result || `Request failed (${response.status})`);
    return result;
  };
  window.pitstopApi = api;
  const supabaseReady = api('config', { participantId: null }).then(config => {
    if (!window.supabase?.createClient) throw new Error('Supabase browser library did not load.');
    supabase = window.supabase.createClient(config.supabaseUrl, config.publishableKey);
    return supabase;
  }).catch(error => { console.error('Supabase setup:', error.message); return null; });
  window.pitstopSubscribeRace = async raceId => {
    await supabaseReady;
    if (!supabase || !raceId) return;
    if (raceChannel) await supabase.removeChannel(raceChannel);
    raceChannel = supabase.channel(`race:${raceId}`).on('broadcast', { event: '*' }, ({ event, payload }) => {
      if (event === 'state') window.dispatchEvent(new CustomEvent('pitstop:state', { detail: payload }));
      else if (event === 'race:open') window.dispatchEvent(new CustomEvent('pitstop:race:open', { detail: payload }));
      else if (event === 'driverStart') window.dispatchEvent(new CustomEvent('pitstop:driverStart', { detail: payload }));
      else if (event === 'race:ended') window.dispatchEvent(new CustomEvent('pitstop:race:ended', { detail: payload }));
      else if (event === 'race:final') window.dispatchEvent(new CustomEvent('pitstop:race:final', { detail: payload }));
    }).subscribe(status => {
      const el = $('connection'); if (el) { el.textContent = status === 'SUBSCRIBED' ? 'LIVE' : 'CONNECTING'; el.classList.toggle('online', status === 'SUBSCRIBED'); }
    });
  };
  const $ = id => document.getElementById(id);
  const button = $('joinButton'), error = $('joinError'), nameInput = $('teamName'), leadName = $('leadName'), leadPhone = $('leadPhone');
  let lastFinalBoard = null;
  function displayOfficialResults(data) {
    if (data?.race?.status !== 'finished') return;
    $('finishPanel').hidden = false;
    $('finishPanel').classList.remove('personal-result');
    $('finishCaption').textContent = 'RACE STATUS · FINAL STANDINGS';
    const results = Array.isArray(data.race.results) ? data.race.results : [];
    $('finishMessage').textContent = results.length ? 'Final score, race time, and repair answers for every driver.' : 'Results are not available yet. Refresh shortly to load the final standings.';
    $('finishResults').innerHTML = results.map(row => {
      const elapsed = row.elapsedMs == null ? 'Did not finish' : `${(row.elapsedMs / 1000).toFixed(1)} sec`;
      const status = row.status === 'finished' ? 'FINISHED' : 'DID NOT FINISH';
      const safeName = String(row.name || 'Driver').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      return `<li><span class="finish-rank">${row.rank}.</span><span class="finish-driver">${safeName}<small>${status} · ${elapsed} · ✓ ${row.correctAnswers} correct · ✕ ${row.incorrectAnswers} incorrect</small></span><strong>${Number(row.score).toLocaleString()} pts</strong></li>`;
    }).join('');
  }
  window.addEventListener('pitstop:race:ended', event => {
    const result = event.detail;
    if (!result || result.participantId !== sessionStorage.getItem('pitstopParticipantId')) return;
    window.showPitstopPersonalResult?.(result);
  });
  const quiz = [
    ['A car travels at 72 km/h for 25 minutes. How far does it travel?', ['18 km', '24 km', '30 km', '36 km'], 2],
    ['What is 15% of 200?', ['15', '25', '30', '35'], 2],
    ['A 1.2 km circuit is completed 5 times. What distance is covered?', ['5 km', '6 km', '6.2 km', '7 km'], 1],
    ['Four notebooks cost ₹120. At the same price each, what do seven cost?', ['₹180', '₹200', '₹210', '₹240'], 2],
    ['Find the next number: 2, 6, 12, 20, 30, __', ['38', '40', '42', '44'], 2],
    ['If 6 workers finish a task in 8 days, how long would 12 equally fast workers take?', ['2 days', '4 days', '6 days', '16 days'], 1],
    ['What is the average of 12, 15, 18, and 23?', ['16', '17', '18', '19'], 1],
    ['A bag has 3 red and 5 blue balls. What is the chance of drawing a red ball?', ['3/8', '5/8', '1/3', '1/2'], 0],
    ['A number is increased by 20% from 150. What is the new number?', ['170', '175', '180', '190'], 2],
    ['Find the next number: 3, 9, 27, 81, __', ['162', '189', '216', '243'], 3]
  ];
  let quizIndex = 0, score = 0, qualified = false, submittingQualification = false, answerLockTimer = null;
  const eliminatedAnswers = quiz.map(() => new Set());
  let selectedColor = '#e83e32';
  function showQuestion(feedback = '') {
    const [question, options] = quiz[quizIndex];
    $('quizProgress').textContent = `QUESTION ${quizIndex + 1} / ${quiz.length}`;
    $('quizQuestion').textContent = question;
    $('quizOptions').innerHTML = options.map((option, i) => `<label class="quiz-option${eliminatedAnswers[quizIndex].has(i) ? ' answer-eliminated' : ''}"><input type="radio" name="quizAnswer" value="${i}" ${eliminatedAnswers[quizIndex].has(i) ? 'disabled' : ''}><span>${String.fromCharCode(65 + i)}. ${option}${eliminatedAnswers[quizIndex].has(i) ? ' · ELIMINATED' : ''}</span></label>`).join('');
    $('quizFeedback').textContent = feedback;
  }
  function submitAnswer() {
    if (submittingQualification) return;
    const selected = document.querySelector('input[name="quizAnswer"]:checked');
    if (!selected) { $('quizFeedback').textContent = 'Select an answer to continue.'; return; }
    const isCorrect = Number(selected.value) === quiz[quizIndex][2];
    if (!isCorrect) {
      eliminatedAnswers[quizIndex].add(Number(selected.value));
      showQuestion('Incorrect. That option is locked out. Wait 10 seconds before trying another answer.');
      const submit = $('quizSubmit'), options = $('quizOptions');
      submit.disabled = true; options.querySelectorAll('input').forEach(input => input.disabled = true);
      let seconds = 10;
      submit.textContent = `WAIT ${seconds}s`;
      clearInterval(answerLockTimer);
      answerLockTimer = setInterval(() => {
        seconds--;
        if (seconds > 0) { submit.textContent = `WAIT ${seconds}s`; $('quizFeedback').textContent = `Incorrect option eliminated. You can try another answer in ${seconds} seconds.`; return; }
        clearInterval(answerLockTimer); answerLockTimer = null;
        options.querySelectorAll('input').forEach(input => { input.disabled = eliminatedAnswers[quizIndex].has(Number(input.value)); });
        submit.disabled = false; submit.textContent = 'LOCK ANSWER ↗';
        $('quizFeedback').textContent = 'Choose a different option. The incorrect choice remains locked.';
      }, 1000);
      return;
    }
    score++;
    quizIndex++;
    if (quizIndex < quiz.length) { showQuestion('Correct! Your answer is recorded. Continue with the next question.'); return; }
    submittingQualification = true;
    $('quizSubmit').disabled = true;
    $('quizOverlay').hidden = true;
    $('loadingOverlay').hidden = false;
    $('loadingMessage').textContent = 'Submitting your qualifying result…';
    api('qualify', { method: 'POST', body: { score, raceId: sessionStorage.getItem('pitstopRaceId') } }).then(result => {
      qualified = true;
      if (result.waiting) $('loadingMessage').textContent = result.started ? 'QUALIFIED · YOUR RACE IS STARTING' : 'QUALIFIED · WAITING FOR THE ORGANIZER TO START THE RACE';
    }).catch(err => {
        submittingQualification = false;
        $('loadingOverlay').hidden = true;
        $('quizOverlay').hidden = false;
        $('quizSubmit').disabled = false;
        quizIndex = quiz.length - 1;
        showQuestion();
        $('quizFeedback').textContent = err.message || 'Server did not respond. Select LOCK ANSWER to retry submitting your score.';
    });
  }
  function join() {
    const name = nameInput.value.trim(); error.textContent = '';
    if (!name) { error.textContent = 'Enter your team name.'; nameInput.focus(); return; }
    if (!leadName.value.trim()) { error.textContent = 'Enter your team lead name.'; leadName.focus(); return; }
    if (leadPhone.value.replace(/\D/g, '').length < 7) { error.textContent = 'Enter a valid team lead phone number.'; leadPhone.focus(); return; }
    button.disabled = true; button.textContent = 'ENTERING GARAGE…';
    api('join', { method: 'POST', body: { teamName: name, leadName: leadName.value.trim(), phone: leadPhone.value.trim(), carColor: selectedColor } }).then(async result => {
      button.disabled = false; button.textContent = 'ENTER GARAGE ↗';
      sessionStorage.setItem('pitstopParticipantId', result.participantId);
      sessionStorage.setItem('pitstopSessionToken', result.sessionToken);
      sessionStorage.setItem('pitstopRaceId', result.raceId);
      await window.pitstopSubscribeRace(result.raceId);
      if (result.raceStatus === 'running') {
        button.disabled = true; button.textContent = 'REJOINING RACE…';
        window.dispatchEvent(new CustomEvent('pitstop:joined', { detail: result }));
        $('joinOverlay').style.display = 'none'; $('app').classList.remove('garage-mode');
        api('resume', { method: 'POST', body: { participantId: result.participantId, raceId: result.raceId } }).then(resumed => {
          $('repairPanel').style.display = 'block'; window.dispatchEvent(new CustomEvent('pitstop:resume', { detail: resumed }));
          if (resumed.status === 'ready') { $('quizOverlay').hidden = false; quizIndex = 0; score = 0; showQuestion(); }
        }).catch(err => { error.textContent = err.message || 'Could not reconnect to this race.'; button.disabled = false; button.textContent = 'ENTER THE GARAGE ↗'; $('joinOverlay').style.display = 'grid';
        });
        return;
      }
      button.disabled = true; button.textContent = 'OPENING THE GARAGE…';
      $('joinOverlay').classList.add('garage-launching');
      window.dispatchEvent(new CustomEvent('pitstop:joined', { detail: result }));
      setTimeout(() => {
        $('app').classList.remove('garage-mode');
        $('joinOverlay').style.display = 'none'; $('joinOverlay').classList.remove('garage-launching');
        $('repairPanel').style.display = 'none';
        $('showroomOverlay').hidden = false;
        window.dispatchEvent(new CustomEvent('pitstop:showroom'));
        button.disabled = false; button.textContent = 'ENTER THE GARAGE ↗';
      }, 1400);
    }).catch(err => { button.disabled = false; button.textContent = 'ENTER GARAGE ↗'; error.textContent = err.message || 'Could not join. Check Supabase setup and try again.'; });
  }
  window.addEventListener('pointermove', event => {
    const x = `${Math.round((event.clientX / innerWidth - .5) * 20)}px`;
    const y = `${Math.round((.5 - event.clientY / innerHeight) * 14)}px`;
    $('showroomOverlay').style.setProperty('--look-x', x);
    $('showroomOverlay').style.setProperty('--look-y', y);
  });
  button.addEventListener('click', join); [nameInput, leadName, leadPhone].forEach(input => input.addEventListener('keydown', e => { if (e.key === 'Enter') join(); }));
  document.querySelectorAll('.showroom-colors button').forEach(choice => choice.addEventListener('click', () => { selectedColor = choice.dataset.color; document.documentElement.style.setProperty('--team-color', selectedColor); document.querySelectorAll('.showroom-colors button').forEach(b => b.classList.toggle('selected', b === choice)); window.dispatchEvent(new CustomEvent('pitstop:color', { detail: { color: selectedColor } })); api('color', { method: 'POST', body: { carColor: selectedColor } }).catch(err => console.warn('Could not save car color:', err)); }));
  $('showroomContinue').addEventListener('click', () => { $('showroomOverlay').hidden = true; $('repairPanel').style.display = 'block'; $('quizOverlay').hidden = false; quizIndex = 0; score = 0; clearInterval(answerLockTimer); answerLockTimer = null; eliminatedAnswers.forEach(set => set.clear()); $('quizSubmit').disabled = false; $('quizSubmit').textContent = 'LOCK ANSWER ↗'; showQuestion(); window.dispatchEvent(new CustomEvent('pitstop:track')); });
  $('quizSubmit').addEventListener('click', submitAnswer);
  $('quizOptions').addEventListener('keydown', e => { if (e.key === 'Enter') submitAnswer(); });
  $('adminOpen').addEventListener('click', () => { $('adminOverlay').hidden = false; });
  $('finishRaceControl').addEventListener('click', () => { $('adminOverlay').hidden = false; });
  $('adminClose').addEventListener('click', () => { $('adminOverlay').hidden = true; });
  const adminAction = (event, message) => {
    const token = $('adminToken').value.trim();
    $('adminMessage').textContent = message;
    const route = event === 'host:start' ? 'admin/start' : 'admin/stop';
    api(route, { method: 'POST', token }).then(result => { $('adminMessage').textContent = result.message || 'Command completed.'; }).catch(err => { $('adminMessage').textContent = err.message; });
  };
  $('adminStart').addEventListener('click', () => adminAction('host:start', 'Starting race…'));
  $('adminStop').addEventListener('click', () => adminAction('host:stop', 'Ending the event…'));
  let adminUnlocked = false;
  const exportButtons = [$('exportExcel'), $('exportCsv')];
  function validateAdminToken() {
    const token=$('adminToken').value.trim();
    adminUnlocked=false;
    exportButtons.forEach(button=>button.disabled=true);
    if(!token){$('adminMessage').textContent='Enter the admin token to unlock exports.';return;}
    api('admin/validate',{method:'POST',token}).then(result=>{
      adminUnlocked=Boolean(result.ok);
      $('adminMessage').textContent='Admin token accepted. Exports are unlocked when the race ends.';
      exportButtons.forEach(button=>button.disabled=!adminUnlocked||!raceIsFinished);
    }).catch(err=>{adminUnlocked=false;$('adminMessage').textContent=err.message;});
  }
  let raceIsFinished = false;
  $('adminToken').addEventListener('input',validateAdminToken);
  $('adminToken').addEventListener('blur',validateAdminToken);
  const downloadResults = async format => {
    const token=$('adminToken').value.trim();if(!token||!adminUnlocked){$('adminMessage').textContent='Enter and validate the admin token first.';return;}
    $('adminMessage').textContent='Preparing '+format.toUpperCase()+' results…';
    try{const response=await fetch('/api/results.'+format,{headers:{Authorization:'Bearer '+token}});if(!response.ok){const data=await response.json().catch(()=>null);$('adminMessage').textContent=data?.error||'Could not download results.';return;}const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=format==='xlsx'?'pitstop-results.xlsx':'pitstop-results.csv';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);$('adminMessage').textContent=format.toUpperCase()+' results downloaded.';}catch(err){$('adminMessage').textContent='Could not download results: '+err.message;}
  };
  $('exportExcel').addEventListener('click',()=>downloadResults('xlsx'));
  $('exportCsv').addEventListener('click',()=>downloadResults('csv'));
  const handleState = data => {
    const race = data?.race;
    if (race?.id && race.id !== subscribedRaceId) { subscribedRaceId = race.id; window.pitstopSubscribeRace(race.id); }
    raceIsFinished=race?.status==='finished';
    if(raceIsFinished)lastFinalBoard={raceId:race.id,race};else lastFinalBoard=null;
    if (race) {
      $('adminMessage').textContent = `Race status: ${String(race.status).toUpperCase()}`;
      $('raceStatusTitle').textContent=race.status==='finished'?'Race ended':race.status==='running'?'Race in progress':'Awaiting start';
      if (race.status === 'finished') { displayOfficialResults({race}); window.showPitstopFinishedGarage?.(); }
      $('adminStart').disabled = race.status !== 'lobby';
      $('adminStop').disabled = race.status !== 'running';
      $('exportExcel').disabled=!adminUnlocked||!raceIsFinished;$('exportCsv').disabled=!adminUnlocked||!raceIsFinished;
    }
  };
  window.addEventListener('pitstop:state', event => handleState(event.detail));
  window.addEventListener('pitstop:race:open', () => { if (qualified) $('loadingMessage').textContent = 'RACE OPEN · YOUR START IS COMING UP'; });
  window.addEventListener('pitstop:race:final', event => { raceIsFinished=true;lastFinalBoard = event.detail; window.showPitstopFinishedGarage?.(); api('state').then(displayOfficialResults).catch(err => { $('finishMessage').textContent=`Could not load final results: ${err.message}`; }); $('raceStatusTitle').textContent='Race ended'; exportButtons.forEach(button=>button.disabled=!adminUnlocked); });
  let subscribedRaceId = null;
  const savedRaceId = sessionStorage.getItem('pitstopRaceId');
  if (savedRaceId && sessionStorage.getItem('pitstopParticipantId')) window.pitstopSubscribeRace(savedRaceId);
  api('state').then(handleState).catch(err => { $('adminMessage').textContent = err.message || 'Could not reach the API. Configure Supabase first.'; });
  setInterval(() => { api('state').then(handleState).catch(err => console.warn('Could not refresh race state:', err)); }, 15000);
  supabaseReady.then(client => { if (!client) { const el=$('connection'); if(el){el.textContent='SETUP REQUIRED';el.classList.remove('online');} } });
  window.addEventListener('error', event => { if (event.message && !qualified) error.textContent = `Game display error: ${event.message}.`; });
  window.addEventListener('unhandledrejection', event => { const message=event.reason?.message||String(event.reason||'3D module failed to load'); if(!qualified) error.textContent=`Game startup error: ${message}.`; console.error('Pit Stop Protocol startup error:',event.reason); });
})();




