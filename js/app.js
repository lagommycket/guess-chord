import { getAllTonesForDifficulty, formatNoteName, findSampleSource, getRequiredSampleFilenames, SCALES, CHORDS } from './music-data.js';
import { createTrainingSession, createTrainingQuestion, recordTrainingResult, checkAnswer, relabelQuestion } from './game-engine.js?v=1.1.1';
import { ensureAudioReady, loadSample, setMasterVolume, playSingleNote, playScale, playChord, playArpeggio, stopAllSounds, checkRequiredSamples, getAudioDebugState } from './audio-engine.js?v=1.0.3';
import { loadData, saveData, defaultStatistics, createExport, parseImport, STORAGE_VERSION } from './storage.js?v=1.1.1';
import { recordAnswer, formatAccuracy } from './statistics.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const viewIds = ['home-view', 'game-view', 'complete-view', 'samples-view', 'stats-view', 'error-view'];
const APP_VERSION = '1.1.5';
const instrumentLabels = { piano: 'Piano', trumpet: 'Trumpet' };
const debugEnabled = new URLSearchParams(location.search).get('debug') === 'true';
const loaded = loadData();
let state = loaded.data;
let currentQuestion = null;
let answered = false;
let busy = false;
let audioReady = false;
let questionToken = 0;
let gameCorrect = 0;
let trainingSession = null;
let trainingSetName = '';
let settingsChangedDuringDialog = false;
let settingsAtOpen = null;
let settingsReturnFocus = null;
let skipSettingsCloseUpdate = false;
let lastError = null;
let sampleResults = new Map();

setMasterVolume(state.settings.volume);

function showView(id) {
  if (id !== 'game-view' && $('#game-view').classList.contains('active')) {
    stopAllSounds();
    questionToken += 1;
    currentQuestion = null;
    trainingSession = null;
  }
  for (const viewId of viewIds) {
    const view = document.getElementById(viewId);
    const active = viewId === id;
    view.hidden = !active;
    view.classList.toggle('active', active);
  }
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

function focusViewHeading(selector) { $(selector)?.focus(); }

function closeSampleCredits(restoreFocus = false) {
  const credits = $('#sample-credits');
  if (credits.hidden) return;
  credits.hidden = true;
  $('#open-sample-credits').setAttribute('aria-expanded', 'false');
  if (restoreFocus && $('#settings-dialog').open) $('#open-sample-credits').focus();
}

function announce(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.hidden = false;
  window.clearTimeout(announce.timer);
  announce.timer = window.setTimeout(() => { toast.hidden = true; }, 5000);
}

function persist() {
  const result = saveData(state);
  state = result.data;
  if (!result.ok) announce(result.error, true);
  updateDebug();
}

function updateHomeControls() {
  for (const [name, value] of Object.entries({ mode: state.settings.mode, instrument: state.settings.instrument, difficulty: state.settings.difficulty })) {
    const input = $(`input[name="home-${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }
  $('#training-root').value = String(state.settings.trainingRoot);
  $('#training-scale').value = state.settings.trainingScale;
  updateSetSummary();
}

function updateSetSummary() {
  const mode = $('input[name="home-mode"]:checked').value;
  const root = $('#training-root').selectedOptions[0].textContent;
  const scale = SCALES[$('#training-scale').value];
  $('#training-scale-field').hidden = mode !== 'note';
  $('#training-set-summary').textContent = mode === 'note' ? `${root} ${scale.label.toLowerCase()} · 7 notes` : `${root} · 4 ${mode === 'scale' ? 'scales' : 'chords'}`;
  $('#training-set-notes').textContent = mode === 'note'
    ? scale.intervals.slice(0, -1).map((interval) => formatNoteName({ pitchClass: (Number($('#training-root').value) + interval) % 12, octave: 4 })).join(' · ')
    : Object.values(mode === 'scale' ? SCALES : CHORDS).map((entry) => entry.label).join(' · ');
}

function openSettings(trigger = document.activeElement) {
  settingsReturnFocus = trigger;
  const form = $('#settings-form');
  for (const [key, value] of Object.entries(state.settings)) {
    const control = form.elements.namedItem(key);
    if (!control) continue;
    if (control.type === 'checkbox') control.checked = value;
    else control.value = String(value);
  }
  $('#volume-output').value = `${Math.round(state.settings.volume * 100)}%`;
  settingsChangedDuringDialog = false;
  settingsAtOpen = { ...state.settings };
  $('#settings-dialog').showModal();
  form.querySelector('button[aria-label]').focus();
}

function updateStatsView() {
  const stats = state.statistics;
  $('#stats-overview').replaceChildren();
  const items = [
    ['Questions answered', stats.totalQuestions], ['Correct', stats.correctAnswers], ['Incorrect', stats.wrongAnswers],
    ['Accuracy', formatAccuracy(stats)], ['Current streak', stats.currentStreak], ['Best streak', stats.bestStreak]
  ];
  for (const [label, value] of items) {
    const item = document.createElement('div');
    item.className = 'stat-card';
    const strong = document.createElement('strong'); strong.textContent = String(value);
    const span = document.createElement('span'); span.textContent = label;
    item.append(strong, span); $('#stats-overview').append(item);
  }
}

function updateDebug() {
  if (!debugEnabled) return;
  const summary = {
    appVersion: APP_VERSION, question: currentQuestion, settings: state.settings, trainingSession, audio: getAudioDebugState(),
    browserUserAgent: navigator.userAgent,
    audioContextSupported: Boolean(window.AudioContext || window.webkitAudioContext),
    webkitAudioContextUsed: getAudioDebugState().usedWebkitAudioContext,
    iosAudioUnlocked: getAudioDebugState().iosAudioUnlocked,
    masterGainConnected: getAudioDebugState().masterGainConnected,
    requiredSamples: currentQuestion ? getRequiredSampleFilenames(currentQuestion) : [],
    playbackToken: questionToken, lastAudioError: getAudioDebugState().lastAudioError,
    lastError, localStorageVersion: STORAGE_VERSION
  };
  $('#debug-output').textContent = JSON.stringify(summary, null, 2);
}

function showAudioFailure(error, message = 'The sound could not be played. Tap Play to try again.') {
  lastError = error.message;
  $('#audio-alert-message').textContent = message;
  $('#audio-alert').hidden = false;
  $('#audio-status').textContent = 'Could not play audio.';
  announce(message, true);
  updateDebug();
}

async function runAudioSystemTest(output) {
  const steps = [];
  let currentStep = 'AudioContext unlock';
  output.textContent = 'Starting audio test …';
  try {
    const context = await ensureAudioReady();
    steps.push('AudioContext created ✓', `AudioContext: ${context.state} ✓`);
    output.textContent = steps.join('\n');
    currentStep = 'Loading and decoding piano C3.mp3';
    await loadSample('piano', 'C3.mp3');
    steps.push('C3.mp3 loaded ✓', 'MP3 decoded ✓');
    output.textContent = steps.join('\n');
    currentStep = 'Playing piano C3.mp3';
    const playback = playSingleNote('piano', 48);
    steps.push('Playback started ✓');
    output.textContent = steps.join('\n');
    await playback;
    steps.push('Playback finished ✓', 'No sound? Check media volume, audio output/Bluetooth, then tap Play again.');
    output.textContent = steps.join('\n');
    updateDebug();
  } catch (error) {
    lastError = error.message;
    steps.push(`${currentStep} failed: ${error.message}`);
    output.textContent = steps.join('\n');
    announce('The audio system test failed. See its status for details.', true);
    updateDebug();
  }
}

function setBusy(value, message = '', playing = false) {
  busy = value;
  $('#audio-status').textContent = message || (value ? 'Loading samples …' : '');
  $('#audio-status').classList.toggle('is-playing', playing);
  $('#play-equalizer').classList.toggle('is-playing', playing);
  $('#play-question').disabled = value;
  $('#answer-options').querySelectorAll('button').forEach((button) => { button.disabled = !audioReady || answered; });
}

function playbackOptions() {
  return { humanize: state.settings.humanize, volumeVariation: state.settings.volumeVariation };
}

function updateNotationIndicator() {
  const button = $('#notation-indicator');
  const notation = state.settings[`${currentQuestion.instrument}Notation`];
  button.textContent = notation === 'bb' ? 'B♭' : 'C';
  button.setAttribute('aria-label', notation === 'bb' ? 'B-flat notation. Switch to concert pitch' : 'Concert pitch. Switch to B-flat notation');
  button.title = notation === 'bb' ? 'Switch to concert pitch' : 'Switch to B-flat notation';
}

function shouldAutoplayQuestion() { return state.settings.autoPlay; }

function updateTrainingProgress() {
  const { mastered, total, attempts, queue } = trainingSession;
  $('#question-progress').textContent = `Attempt ${Math.max(1, attempts + (answered ? 0 : 1))}`;
  $('#round-score').textContent = `${mastered} / ${total} mastered`;
  $('#progress-track').setAttribute('aria-valuemax', String(total));
  $('#progress-track').setAttribute('aria-valuenow', String(mastered));
  $('#progress-fill').style.width = `${mastered / total * 100}%`;
  $('#score-value').textContent = String(mastered);
  $('#rate-value').textContent = String(queue.length);
  $('#streak-value').textContent = String(attempts);
  $('#best-streak-value').textContent = `${attempts ? Math.round(gameCorrect / attempts * 100) : 0}%`;
}

function updateTrainingSetName() {
  const notation = state.settings[`${currentQuestion.instrument}Notation`];
  const root = formatNoteName(trainingSession.rootMidi + (notation === 'bb' ? 2 : 0));
  trainingSetName = trainingSession.mode === 'note' ? `${root} ${SCALES[trainingSession.scale].label.toLowerCase()} · ${trainingSession.total} notes` : `${root} · ${trainingSession.total} ${trainingSession.mode === 'scale' ? 'scales' : 'chords'}`;
  $('#game-context').textContent = `${trainingSetName} · ${instrumentLabels[currentQuestion.instrument]}`;
}

async function playCurrentQuestion() {
  if (!currentQuestion || busy) return;
  const token = questionToken;
  setBusy(true, 'Preparing playback …');
  $('#audio-alert').hidden = true;
  try {
    await ensureAudioReady();
    setBusy(true, 'Playing audio …', true);
    if (currentQuestion.mode === 'note') await playSingleNote(currentQuestion.instrument, currentQuestion.playbackNotes[0]);
    else if (currentQuestion.mode === 'scale') await playScale(currentQuestion.instrument, currentQuestion.playbackNotes, playbackOptions());
    else if (currentQuestion.playbackType === 'arpeggio') await playArpeggio(currentQuestion.instrument, currentQuestion.playbackNotes, playbackOptions());
    else await playChord(currentQuestion.instrument, currentQuestion.playbackNotes, playbackOptions());
    if (token === questionToken) {
      setBusy(false);
      $('#play-question').setAttribute('aria-label', 'Play again');
      updateDebug();
    }
  } catch (error) {
    if (token !== questionToken) return;
    audioReady = false;
    setBusy(false);
    $('#answer-options').querySelectorAll('button').forEach((button) => { button.disabled = true; });
    showAudioFailure(error);
  }
}

function renderAnswers(question) {
  const container = $('#answer-options');
  container.replaceChildren();
  question.answerOptions.forEach((option, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'answer-button'; button.dataset.answerId = option.id;
    button.setAttribute('aria-label', `Answer ${index + 1}: ${option.label}`);
    const number = document.createElement('span'); number.className = 'answer-number'; number.textContent = String(index + 1);
    const label = document.createElement('span'); label.textContent = option.label;
    const notation = document.createElement('span'); notation.className = 'answer-notation-badge'; notation.setAttribute('aria-hidden', 'true');
    notation.textContent = state.settings[`${question.instrument}Notation`] === 'bb' ? 'B♭' : 'C';
    button.append(number, label, notation);
    button.addEventListener('click', () => answerQuestion(option, button));
    container.append(button);
  });
}

async function prepareQuestion(question, shouldAutoplay = false) {
  currentQuestion = question;
  answered = false;
  audioReady = false;
  questionToken += 1;
  const thisToken = questionToken;
  stopAllSounds();
  updateNotationIndicator();
  updateTrainingSetName();
  updateTrainingProgress();
  $('#feedback').hidden = true;
  $('#audio-alert').hidden = true;
  $('#next-question').disabled = true;
  $('#next-question').firstChild.textContent = 'Next ';
  $('#next-question').setAttribute('aria-label', 'Next question');
  $('#play-question').setAttribute('aria-label', 'Play question');
  renderAnswers(question);
  $('#play-question').disabled = true;
  $('#answer-options').querySelectorAll('button').forEach((button) => { button.disabled = true; });
  setBusy(true, 'Checking required samples …');
  updateDebug();
  try {
    const results = await checkRequiredSamples(question.instrument, question.playbackNotes);
    if (thisToken !== questionToken) return;
    const missing = results.find((result) => result.status === 'missing');
    if (missing) {
      const source = missing.sourcePath ? ` Expected source: ${missing.sourceFilename} at ${missing.sourcePath}.` : '';
      const tried = missing.attemptedPaths?.length ? ` Tried: ${missing.attemptedPaths.join(', ')}.` : '';
      lastError = missing.error ?? `No source sample is configured for ${missing.tone.internationalName}.`;
      $('#audio-alert-message').textContent = `${instrumentLabels[question.instrument]}: ${lastError} Requested note path: ${missing.expectedPath}.${source}${tried}`;
      $('#audio-alert').hidden = false;
      $('#audio-status').textContent = 'Sample missing; answers are disabled until audio is available.';
      $('#retry-audio').disabled = false;
      setBusy(false);
      $('#answer-options').querySelectorAll('button').forEach((button) => { button.disabled = true; });
      $('#retry-audio').focus();
      updateDebug();
      return;
    }
    audioReady = true;
    setBusy(false);
    updateDebug();
    if (shouldAutoplay) await playCurrentQuestion();
    if (thisToken === questionToken && !answered) $('#play-question').focus();
  } catch (error) {
    if (thisToken !== questionToken) return;
    lastError = error.message;
    audioReady = false;
    $('#audio-alert-message').textContent = error.message;
    $('#audio-alert').hidden = false;
    setBusy(false);
    updateDebug();
  }
}

async function startTraining() {
  state.settings.mode = $('input[name="home-mode"]:checked').value;
  state.settings.instrument = $('input[name="home-instrument"]:checked').value;
  state.settings.difficulty = $('input[name="home-difficulty"]:checked').value;
  state.settings.trainingRoot = Number($('#training-root').value);
  state.settings.trainingScale = $('#training-scale').value;
  persist();
  gameCorrect = 0;
  try {
    await ensureAudioReady();
    trainingSession = createTrainingSession(state.settings);
    trainingSetName = $('#training-set-summary').textContent;
    showView('game-view');
    focusViewHeading('#game-title');
    await prepareQuestion(createTrainingQuestion(state.settings, trainingSession), shouldAutoplayQuestion());
  } catch (error) { showFatalError(error); }
}

function showFatalError(error) {
  lastError = error.message;
  $('#error-message').textContent = error.message;
  showView('error-view'); updateDebug();
}

function answerQuestion(option, button) {
  if (answered || !audioReady || !currentQuestion || !currentQuestion.answerOptions.some((entry) => entry.id === option.id)) return;
  if (busy) stopAllSounds();
  answered = true;
  setBusy(false);
  const correct = checkAnswer(currentQuestion, option);
  recordTrainingResult(trainingSession, currentQuestion, correct);
  if (correct) gameCorrect += 1;
  state.statistics = recordAnswer(state.statistics, currentQuestion, option, correct);
  persist();
  const buttons = [...$('#answer-options').querySelectorAll('button')];
  buttons.forEach((answerButton) => {
    answerButton.disabled = true;
    const isCorrectAnswer = answerButton.dataset.answerId === currentQuestion.correctAnswer.id;
    if (isCorrectAnswer) {
      answerButton.classList.add('correct');
      answerButton.setAttribute('aria-label', `${answerButton.getAttribute('aria-label')}. Correct answer.`);
    } else {
      answerButton.classList.add('incorrect');
      answerButton.setAttribute('aria-label', `${answerButton.getAttribute('aria-label')}. ${answerButton === button ? 'Your answer, incorrect.' : 'Incorrect answer.'}`);
    }
  });
  const feedback = $('#feedback');
  feedback.className = `feedback ${correct ? 'is-correct' : 'is-wrong'}`;
  feedback.textContent = correct ? 'Correct' : 'Missed';
  feedback.hidden = false;
  $('#next-question').disabled = false;
  if (!trainingSession.queue.length) {
    $('#next-question').firstChild.textContent = 'Finish ';
    $('#next-question').setAttribute('aria-label', 'Finish practice');
  }
  updateTrainingProgress();
  feedback.focus();
  updateDebug();
}

async function nextQuestion() {
  if (!answered || busy) return;
  if (!trainingSession.queue.length) {
    stopAllSounds();
    $('#completion-set').textContent = `${trainingSetName} · ${instrumentLabels[state.settings.instrument]}`;
    $('#completion-mastered').textContent = String(trainingSession.mastered);
    $('#completion-attempts').textContent = String(trainingSession.attempts);
    $('#completion-accuracy').textContent = `${Math.round(gameCorrect / trainingSession.attempts * 100)}%`;
    currentQuestion = null;
    showView('complete-view');
    focusViewHeading('#complete-title');
    return;
  }
  try {
    await ensureAudioReady();
    const next = createTrainingQuestion(state.settings, trainingSession);
    await prepareQuestion(next, shouldAutoplayQuestion());
  } catch (error) { showFatalError(error); }
}

function goSamples() {
  sampleResults.clear();
  $('#sample-instrument').value = state.settings.instrument;
  $('#sample-difficulty').value = state.settings.difficulty;
  renderSampleList();
  showView('samples-view');
  focusViewHeading('#samples-title');
}

function renderSampleList() {
  const instrument = $('#sample-instrument').value;
  const difficulty = $('#sample-difficulty').value;
  const filter = $('#sample-filter').value;
  const list = $('#sample-list'); list.replaceChildren();
  let tones = getAllTonesForDifficulty(difficulty);
  if (filter === 'unchecked') tones = tones.filter((tone) => !sampleResults.has(`${instrument}:${tone.midiNumber}`));
  if (filter === 'available') tones = tones.filter((tone) => ['exact', 'transposed'].includes(sampleResults.get(`${instrument}:${tone.midiNumber}`)?.status));
  if (filter === 'missing') tones = tones.filter((tone) => sampleResults.get(`${instrument}:${tone.midiNumber}`)?.status === 'missing');
  const counts = { exact: 0, transposed: 0, missing: 0 };
  for (const result of sampleResults.values()) if (result.instrument === instrument) counts[result.status] = (counts[result.status] ?? 0) + 1;
  $('#sample-summary').textContent = sampleResults.size ? `${counts.exact} exact · ${counts.transposed} covered by transposition · ${counts.missing} missing` : 'Not checked yet';
  for (const tone of tones) {
    const result = sampleResults.get(`${instrument}:${tone.midiNumber}`);
    const mapping = findSampleSource(instrument, tone.midiNumber);
    const row = document.createElement('article'); row.className = 'sample-row';
    const detail = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `Note ${formatNoteName(tone, true)} · file ${tone.internationalName}`;
    const path = document.createElement('span'); path.className = 'sample-path'; path.textContent = `Expected: ./audio/${instrument}/${tone.sampleFilename}`;
    detail.append(title, path);
    const status = document.createElement('span'); status.className = `sample-status ${result?.status ?? 'unchecked'}`;
    status.textContent = result ? result.status === 'loading' ? 'Loading …' : result.status === 'exact' ? 'Exact sample available' : result.status === 'transposed' ? `Available by transposition (${result.semitoneDifference > 0 ? '+' : ''}${result.semitoneDifference})` : 'Missing' : 'Not checked';
    if (result?.sourceFilename && result.status === 'transposed') {
      const source = document.createElement('span'); source.className = 'sample-path'; source.textContent = `Source sample: ${result.sourceFilename}`;
      detail.append(source);
    }
    const play = document.createElement('button'); play.type = 'button'; play.className = 'secondary-button compact'; play.textContent = 'Play'; play.disabled = !result || result.status === 'missing' || result.status === 'loading';
    play.addEventListener('click', async () => {
      play.disabled = true;
      try { await ensureAudioReady(); await playSingleNote(instrument, tone.midiNumber); }
      catch (error) { announce(error.message, true); }
      finally { play.disabled = false; }
    });
    row.append(detail, status, play); list.append(row);
    if (!result && mapping) status.dataset.expectedSource = mapping.tone.sampleFilename;
  }
}

async function inspectTone(instrument, tone) {
  const key = `${instrument}:${tone.midiNumber}`;
  const result = { instrument, midiNumber: tone.midiNumber, tone, expectedFilename: tone.sampleFilename, status: 'loading' };
  sampleResults.set(key, result); renderSampleList();
  const outcomes = await checkRequiredSamples(instrument, [tone.midiNumber]);
  const outcome = outcomes[0];
  sampleResults.set(key, { ...outcome, instrument });
  renderSampleList();
  return outcome;
}

async function checkAllSamples() {
  const button = $('#check-all-samples');
  button.disabled = true;
  try {
    await ensureAudioReady();
    const instrument = $('#sample-instrument').value;
    const tones = getAllTonesForDifficulty($('#sample-difficulty').value);
    let checked = 0;
    $('#sample-summary').textContent = `Checking 0 of ${tones.length} notes …`;
    for (const tone of tones) {
      await inspectTone(instrument, tone);
      checked += 1;
      $('#sample-summary').textContent = `Checking ${checked} of ${tones.length} notes …`;
    }
    renderSampleList();
  } catch (error) {
    lastError = error.message;
    $('#sample-summary').textContent = `Audio test failed: ${error.message}`;
    updateDebug();
  } finally { button.disabled = false; }
}

function applySettingsFromForm(target) {
  const form = $('#settings-form');
  const previous = { ...state.settings };
  for (const key of Object.keys(state.settings)) {
    const control = form.elements.namedItem(key);
    if (!control) continue;
    state.settings[key] = control.type === 'checkbox' ? control.checked : control.type === 'range' ? Number(control.value) : control.value;
  }
  setMasterVolume(state.settings.volume);
  updateHomeControls(); persist();
  if (target === 'play' && currentQuestion && Object.keys(state.settings).some((key) => previous[key] !== state.settings[key])) settingsChangedDuringDialog = true;
}

function updateSettingsControl(control) {
  const key = control.name;
  if (!key) return;
  state.settings[key] = control.type === 'checkbox' ? control.checked : control.type === 'range' ? Number(control.value) : control.value;
  if (key === 'volume') $('#volume-output').value = `${Math.round(state.settings.volume * 100)}%`;
  if (key === 'volume') setMasterVolume(state.settings.volume);
  settingsChangedDuringDialog = true;
  updateHomeControls(); persist();
}

function showStats() { updateStatsView(); showView('stats-view'); focusViewHeading('#stats-title'); }

function exportStatistics() {
  const blob = new Blob([JSON.stringify(createExport(state), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url;
  link.download = `ear-training-statistics-${new Date().toISOString().slice(0, 10)}.json`;
  link.click(); URL.revokeObjectURL(url);
  $('#stats-message').textContent = 'Statistics exported.';
}

async function importStatistics(file) {
  if (!file) return;
  try {
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') throw new Error('Please select a JSON file.');
    const imported = parseImport(await file.text());
    if (!window.confirm('Imported settings and statistics will replace the data currently saved in this browser. Continue?')) return;
    state = imported; persist(); updateHomeControls(); updateStatsView();
    $('#stats-message').textContent = 'Data imported successfully.';
  } catch (error) { $('#stats-message').textContent = error.message; }
  finally { $('#import-file').value = ''; }
}

function resetStatistics() {
  if (!window.confirm('Are you sure you want to reset all statistics? This cannot be undone.')) return;
  state.statistics = defaultStatistics(); persist(); updateStatsView();
  $('#stats-message').textContent = 'Statistics reset.';
}

$('#start-training').addEventListener('click', startTraining);
$('#restart-training').addEventListener('click', startTraining);
$('#change-training').addEventListener('click', goHome);
$('#training-root').addEventListener('change', (event) => { state.settings.trainingRoot = Number(event.target.value); updateSetSummary(); persist(); });
$('#training-scale').addEventListener('change', (event) => { state.settings.trainingScale = event.target.value; updateSetSummary(); persist(); });
$$('input[name^="home-"]').forEach((input) => input.addEventListener('change', () => { state.settings[input.name.slice(5)] = input.value; updateSetSummary(); persist(); }));
$('#nav-settings').addEventListener('click', (event) => openSettings(event.currentTarget));
$('#settings-form').addEventListener('submit', (event) => event.preventDefault());
$('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-done').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-dialog').addEventListener('cancel', (event) => {
  if ($('#sample-credits').hidden) return;
  event.preventDefault();
  closeSampleCredits(true);
});
$('#settings-dialog').addEventListener('close', async () => {
  closeSampleCredits();
  if (!skipSettingsCloseUpdate && settingsChangedDuringDialog && currentQuestion && $('#game-view').classList.contains('active')) {
    if (['mode', 'instrument', 'difficulty'].some((key) => settingsAtOpen[key] !== state.settings[key])) await startTraining();
    else if (['pianoNotation', 'trumpetNotation'].some((key) => settingsAtOpen[key] !== state.settings[key])) refreshQuestionLabels();
  }
  skipSettingsCloseUpdate = false;
  if ($('#samples-view').classList.contains('active')) focusViewHeading('#samples-title');
  else if ($('#stats-view').classList.contains('active')) focusViewHeading('#stats-title');
  else if (settingsReturnFocus?.isConnected) settingsReturnFocus.focus();
});
$('#settings-form').addEventListener('change', (event) => updateSettingsControl(event.target));
$('#settings-form').addEventListener('input', (event) => { if (event.target.name === 'volume') updateSettingsControl(event.target); });
$('#settings-samples').addEventListener('click', () => { skipSettingsCloseUpdate = true; $('#settings-dialog').close(); goSamples(); });
$('#settings-statistics').addEventListener('click', () => { skipSettingsCloseUpdate = true; $('#settings-dialog').close(); showStats(); });
$('#open-sample-credits').addEventListener('click', () => {
  $('#sample-credits').hidden = false;
  $('#open-sample-credits').setAttribute('aria-expanded', 'true');
  $('#close-sample-credits').focus();
});
$('#close-sample-credits').addEventListener('click', () => closeSampleCredits(true));
$('#sample-credits').addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  closeSampleCredits(true);
});
$('#play-question').addEventListener('click', playCurrentQuestion);
function refreshQuestionLabels() {
  currentQuestion = relabelQuestion(currentQuestion, state.settings);
  for (const [index, option] of currentQuestion.answerOptions.entries()) {
    const button = $('#answer-options').querySelectorAll('button')[index];
    button.querySelector('span:nth-child(2)').textContent = option.label;
    button.querySelector('.answer-notation-badge').textContent = state.settings[`${currentQuestion.instrument}Notation`] === 'bb' ? 'B♭' : 'C';
    let label = `Answer ${index + 1}: ${option.label}`;
    if (button.classList.contains('correct')) label += '. Correct answer.';
    else if (button.classList.contains('incorrect')) label += '. Your answer, incorrect.';
    button.setAttribute('aria-label', label);
  }
  if (answered) {
    const correct = !$('#feedback').classList.contains('is-wrong');
    $('#feedback').textContent = correct ? `✓ Correct. ${currentQuestion.correctAnswer.label}` : `✕ Incorrect. The correct answer is ${currentQuestion.correctAnswer.label}.`;
  }
  updateNotationIndicator();
  const notation = state.settings[`${currentQuestion.instrument}Notation`];
  state.settings.trainingRoot = (trainingSession.rootMidi + (notation === 'bb' ? 2 : 0)) % 12;
  $('#training-root').value = String(state.settings.trainingRoot);
  updateSetSummary();
  updateTrainingSetName();
  persist();
}
$('#notation-indicator').addEventListener('click', () => {
  if (!currentQuestion) return;
  const key = `${currentQuestion.instrument}Notation`;
  state.settings[key] = state.settings[key] === 'bb' ? 'concert' : 'bb';
  refreshQuestionLabels();
});
$('#retry-audio').addEventListener('click', async () => {
  if (!currentQuestion || busy) return;
  try {
    await ensureAudioReady();
    setBusy(true, 'Retrying …');
    await prepareQuestion(currentQuestion, shouldAutoplayQuestion());
  } catch (error) { showAudioFailure(error); }
});
$('#go-samples-from-error').addEventListener('click', goSamples);
$('#next-question').addEventListener('click', nextQuestion);
function goHome() { showView('home-view'); focusViewHeading('#home-title'); }

$('.brand').addEventListener('click', (event) => { event.preventDefault(); goHome(); });
$('#exit-game').addEventListener('click', goHome);
$('#open-samples').addEventListener('click', goSamples);
$('#samples-back').addEventListener('click', goHome);
$('#sample-instrument').addEventListener('change', () => { sampleResults.clear(); renderSampleList(); });
$('#sample-difficulty').addEventListener('change', renderSampleList);
$('#sample-filter').addEventListener('change', renderSampleList);
$('#check-all-samples').addEventListener('click', checkAllSamples);
$('#test-audio-system').addEventListener('click', () => runAudioSystemTest($('#audio-system-status')));
$('#debug-test-audio').addEventListener('click', () => runAudioSystemTest($('#debug-test-status')));
$('#show-debug').addEventListener('click', () => {
  const panel = $('#debug-panel');
  panel.hidden = !panel.hidden;
  $('#show-debug').setAttribute('aria-expanded', String(!panel.hidden));
  $('#show-debug').setAttribute('aria-label', panel.hidden ? 'Show debug panel' : 'Hide debug panel');
  $('#show-debug').title = panel.hidden ? 'Show debug panel' : 'Hide debug panel';
  if (!panel.hidden) updateDebug();
});
$('#hide-debug').addEventListener('click', () => {
  $('#debug-panel').hidden = true;
  $('#show-debug').setAttribute('aria-expanded', 'false');
  $('#show-debug').setAttribute('aria-label', 'Show debug panel');
  $('#show-debug').title = 'Show debug panel';
});
$('#nav-stats').addEventListener('click', showStats);
$('#stats-back').addEventListener('click', goHome);
$('#export-stats').addEventListener('click', exportStatistics);
$('#import-stats').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (event) => importStatistics(event.target.files[0]));
$('#reset-stats').addEventListener('click', resetStatistics);
$('#error-settings').addEventListener('click', (event) => openSettings(event.currentTarget));
$('#error-home').addEventListener('click', () => showView('home-view'));
$('#copy-debug').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#debug-output').textContent); announce('Debug information copied.'); }
  catch { announce('Could not copy. Select the debug text manually.', true); }
});

window.addEventListener('audio-interrupted', () => {
  if (!currentQuestion || !audioReady || !busy || !$('#game-view').classList.contains('active')) return;
  questionToken += 1;
  setBusy(false);
  $('#audio-status').textContent = 'Audio paused. Tap Play to continue.';
  announce('Audio paused. Tap Play to continue.', true);
  updateDebug();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#sample-credits').hidden) {
    event.preventDefault();
    event.stopPropagation();
    closeSampleCredits(true);
    return;
  }
  if (event.key === 'Escape' && $('#settings-dialog').open) {
    event.preventDefault();
    $('#settings-dialog').close();
    return;
  }
  const active = document.activeElement;
  const editing = active.matches('input, textarea, select, [contenteditable="true"]');
  const dialogOpen = $('#settings-dialog').open;
  if (editing || dialogOpen || event.altKey || event.ctrlKey || event.metaKey) return;
  if (!$('#game-view').classList.contains('active')) return;
  if (event.code === 'Space') { event.preventDefault(); if (!busy) playCurrentQuestion(); return; }
  if (event.key === 'Enter' && answered) { event.preventDefault(); nextQuestion(); return; }
  if (['1', '2', '3'].includes(event.key) && !answered) {
    event.preventDefault();
    const button = $('#answer-options').querySelectorAll('button')[Number(event.key) - 1];
    if (button && !button.disabled) button.click();
  }
}, true);

updateHomeControls();
$('#app-version').textContent = `v${APP_VERSION}`;
$('#app-version').setAttribute('aria-label', `Version ${APP_VERSION}`);
state.statistics.lastUsed = new Date().toISOString();
persist();
if (loaded.warning) announce(loaded.warning, true);
if (debugEnabled) {
  document.body.classList.add('debug-enabled');
  $('#show-debug').hidden = false;
  updateDebug();
}