(() => {
  const socket = window.pitstopSocket = io();
  const $ = id => document.getElementById(id);
  const button = $('joinButton'), error = $('joinError'), nameInput = $('driverName');
  const quiz = [
    ['Which structure follows FIFO order?', ['Stack', 'Queue', 'Tree', 'Graph'], 1],
    ['What does a red flag mean in a race?', ['Pit lane open', 'Race stopped', 'Last lap', 'Fastest lap'], 1],
    ['Which light is the usual signal to start?', ['Green', 'Blue', 'Yellow', 'White'], 0]
  ];
  let quizIndex = 0, score = 0, qualified = false, submittingQualification = false;
  const color = $('carColor');
  document.querySelectorAll('.color-choice').forEach(choice => choice.addEventListener('click', () => {
    document.querySelectorAll('.color-choice').forEach(item => { item.classList.remove('selected'); item.setAttribute('aria-pressed', 'false'); });
    choice.classList.add('selected'); choice.setAttribute('aria-pressed', 'true');
    color.value = choice.dataset.color;
    $('previewCar').style.setProperty('--car-color', color.value);
    window.dispatchEvent(new CustomEvent('pitstop:color', { detail: { color: color.value } }));
  }));
  function showQuestion(feedback = '') {
    const [question, options] = quiz[quizIndex];
    $('quizProgress').textContent = `QUESTION ${quizIndex + 1} / ${quiz.length}`;
    $('quizQuestion').textContent = question;
    $('quizOptions').innerHTML = options.map((option, i) => `<label class="quiz-option"><input type="radio" name="quizAnswer" value="${i}"><span>${String.fromCharCode(65 + i)}. ${option}</span></label>`).join('');
    $('quizFeedback').textContent = feedback;
  }
  function submitAnswer() {
    if (submittingQualification) return;
    const selected = document.querySelector('input[name="quizAnswer"]:checked');
    if (!selected) { $('quizFeedback').textContent = 'Select an answer to continue.'; return; }
    const isCorrect = Number(selected.value) === quiz[quizIndex][2];
    if (isCorrect) score++;
    quizIndex++;
    if (quizIndex < quiz.length) {
      showQuestion(isCorrect
        ? 'Correct! Your answer is recorded. Continue with the next question.'
        : 'Not quite. Your answer is recorded. Continue with the next question.');
      return;
    }
    submittingQualification = true;
    $('quizSubmit').disabled = true;
    $('quizOverlay').hidden = true;
    $('loadingOverlay').hidden = false;
    $('loadingMessage').textContent = 'Submitting your qualifying result…';
    socket.timeout(8000).emit('driver:qualify', { score }, (timeoutErr, result) => {
      if (timeoutErr || result?.error) {
        submittingQualification = false;
        $('loadingOverlay').hidden = true;
        $('quizOverlay').hidden = false;
        $('quizSubmit').disabled = false;
        quizIndex = quiz.length - 1;
        showQuestion();
        $('quizFeedback').textContent = result?.error || 'Server did not respond. Select LOCK ANSWER to retry submitting your score.';
        return;
      }
      qualified = true;
      if (result.waiting) $('loadingMessage').textContent = 'QUALIFIED · waiting for the organizer to start the race';
    });
  }
  function join() {
    const name = nameInput.value.trim(); error.textContent = '';
    if (!name) { error.textContent = 'Enter your team or driver name.'; nameInput.focus(); return; }
    button.disabled = true; button.textContent = 'ENTERING GARAGE…';
    socket.timeout(8000).emit('join', { name, carColor: color.value }, (timeoutErr, result) => {
      button.disabled = false; button.textContent = 'ENTER GARAGE ↗';
      if (timeoutErr) { error.textContent = 'No server response. Check npm start and refresh.'; return; }
      if (result?.error) { error.textContent = result.error; return; }
      button.disabled = true; button.textContent = 'OPENING THE GARAGE…';
      $('joinOverlay').classList.add('garage-launching');
      window.dispatchEvent(new CustomEvent('pitstop:joined', { detail: result }));
      setTimeout(() => {
        $('app').classList.remove('garage-mode');
        $('joinOverlay').style.display = 'none'; $('joinOverlay').classList.remove('garage-launching');
        $('repairPanel').style.display = 'block';
        $('quizOverlay').hidden = false; quizIndex = 0; score = 0; showQuestion();
        button.disabled = false; button.textContent = 'CONFIRM CAR ↗';
      }, 1400);
    });
  }
  button.addEventListener('click', join); nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('quizSubmit').addEventListener('click', submitAnswer);
  $('quizOptions').addEventListener('keydown', e => { if (e.key === 'Enter') submitAnswer(); });
  $('adminOpen').addEventListener('click', () => { $('adminOverlay').hidden = false; });
  $('adminClose').addEventListener('click', () => { $('adminOverlay').hidden = true; });
  const adminAction = (event, message) => {
    const token = $('adminToken').value.trim();
    $('adminMessage').textContent = message;
    socket.timeout(8000).emit(event, { token }, (timeoutErr, result) => {
      $('adminMessage').textContent = timeoutErr ? 'No server response. Check that the server is running.' : result?.error || result?.message || 'Command completed.';
    });
  };
  $('adminStart').addEventListener('click', () => adminAction('host:start', 'Starting race…'));
  $('adminStop').addEventListener('click', () => adminAction('host:stop', 'Ending race…'));
  $('adminResults').addEventListener('click', () => {
    $('adminOverlay').hidden = true;
    if (!lastFinalBoard) { $('adminOverlay').hidden = false; $('adminMessage').textContent = 'No official results are available yet.'; return; }
    $('finishPanel').hidden = false;
    window.dispatchEvent(new CustomEvent('pitstop:final', { detail: lastFinalBoard }));
  });
  socket.on('state', data => {
    const race = data?.race;
    if (race) {
      $('adminMessage').textContent = `Race status: ${String(race.status).toUpperCase()} · ${data.participants?.length || 0} drivers`;
      $('adminStart').disabled = race.status !== 'lobby';
      $('adminStop').disabled = race.status !== 'running';
      $('adminResults').disabled = race.status !== 'finished';
    }
  });
  socket.on('connect', () => { const el = $('connection'); if (el) { el.textContent = 'LIVE'; el.classList.add('online'); } $('adminMessage').textContent = 'Connected to race server.'; });
  socket.on('disconnect', () => { const el = $('connection'); if (el) { el.textContent = 'OFFLINE'; el.classList.remove('online'); } });
  socket.on('race:open', () => { if (qualified) $('loadingMessage').textContent = 'EVENT OPEN · Your grid slot will launch shortly'; });
  let lastFinalBoard = null;
  socket.on('race:final', data => { lastFinalBoard = data; $('finishPanel').hidden = false; window.dispatchEvent(new CustomEvent('pitstop:final', { detail: data })); });
  window.addEventListener('error', event => { if (event.message && !qualified) error.textContent = `Game display error: ${event.message}.`; });
})();
