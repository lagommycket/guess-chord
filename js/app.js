import { getAllTonesForDifficulty, formatNoteName, findSampleSource, getRequiredSampleFilenames } from './music-data.js';
import { createQuestion, getNextQuestion, checkAnswer } from './game-engine.js';
import { initializeAudio, setMasterVolume, playSingleNote, playScale, playChord, playArpeggio, stopAllSounds, checkRequiredSamples, getAudioDebugState } from './audio-engine.js';
import { loadData, saveData, defaultStatistics, createExport, parseImport, STORAGE_VERSION } from './storage.js';
import { recordAnswer, formatAccuracy } from './statistics.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const viewIds = ['home-view', 'game-view', 'samples-view', 'stats-view', 'error-view'];
const modeLabels = { note: 'Single note', scale: 'Scale', chord: 'Chord' };
const instrumentLabels = { piano: 'Piano', trumpet: 'Trumpet' };
const difficultyLabels = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const debugEnabled = new URLSearchParams(location.search).get('debug') === 'true';
const loaded = loadData();
let state = loaded.data;
let currentQuestion = null;
let answered = false;
let busy = false;
let audioReady = false;
let questionToken = 0;
let gameCorrect = 0;
let gameAnswered = 0;
let settingsChangedDuringDialog = false;
let settingsReturnFocus = null;
let skipSettingsCloseUpdate = false;
let lastError = null;
let sampleResults = new Map();

setMasterVolume(state.settings.volume);

function showView(id) {
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
  const panel = $('#debug-panel');
  panel.hidden = false;
  const summary = {
    question: currentQuestion, settings: state.settings, audio: getAudioDebugState(),
    requiredSamples: currentQuestion ? getRequiredSampleFilenames(currentQuestion) : [],
    playbackToken: questionToken, lastAudioError: getAudioDebugState().lastAudioError,
    lastError, localStorageVersion: STORAGE_VERSION
  };
  $('#debug-output').textContent = JSON.stringify(summary, null, 2);
}

function setBusy(value, message = '') {
  busy = value;
  $('#audio-status').textContent = message || (value ? 'Loading samples …' : '');
  $('#play-question').disabled = value;
  $('#answer-options').querySelectorAll('button').forEach((button) => { button.disabled = !audioReady || answered; });
}

function playbackOptions() {
  return { humanize: state.settings.humanize, volumeVariation: state.settings.volumeVariation };
}

async function playCurrentQuestion() {
  if (!currentQuestion || busy) return;
  const token = questionToken;
  setBusy(true, 'Preparing playback …');
  $('#audio-alert').hidden = true;
  try {
    await initializeAudio();
    setBusy(true, 'Playing audio …');
    if (currentQuestion.mode === 'note') await playSingleNote(currentQuestion.instrument, currentQuestion.playbackNotes[0]);
    else if (currentQuestion.mode === 'scale') await playScale(currentQuestion.instrument, currentQuestion.playbackNotes, playbackOptions());
    else if (currentQuestion.playbackType === 'arpeggio') await playArpeggio(currentQuestion.instrument, currentQuestion.playbackNotes, playbackOptions());
    else await playChord(currentQuestion.instrument, currentQuestion.playbackNotes, playbackOptions());
    if (token === questionToken) {
      setBusy(false);
      $('#play-question').setAttribute('aria-label', 'Play again');
      $('#play-caption').textContent = 'Play again';
    }
  } catch (error) {
    if (token !== questionToken) return;
    lastError = error.message;
    audioReady = false;
    $('#audio-alert-message').textContent = `${error.message} Check the sample file or test available samples.`;
    $('#audio-alert').hidden = false;
    $('#audio-status').textContent = 'Could not load audio.';
    setBusy(false);
    $('#answer-options').querySelectorAll('button').forEach((button) => { button.disabled = true; });
    announce(`${instrumentLabels[currentQuestion.instrument]}: ${error.message}`, true);
    updateDebug();
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
    const result = document.createElement('span'); result.className = 'answer-result'; result.setAttribute('aria-hidden', 'true');
    button.append(number, label, result);
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
  $('#game-context').textContent = `${modeLabels[question.mode]} · ${instrumentLabels[question.instrument]} · ${difficultyLabels[question.difficulty]}`.toLocaleUpperCase('en-US');
  $('#question-progress').textContent = `Question ${gameAnswered + 1}`;
  $('#round-score').textContent = `${gameCorrect} correct`;
  $('#progress-fill').style.width = `${Math.min(100, gameAnswered % 10 * 10)}%`;
  $('#feedback').hidden = true;
  $('#audio-alert').hidden = true;
  $('#next-question').disabled = true;
  $('#play-caption').textContent = question.mode === 'note' ? 'Listen to the note' : question.mode === 'scale' ? 'Listen to the scale' : question.playbackType === 'arpeggio' ? 'Listen to the arpeggio' : 'Listen to the chord';
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
    if (shouldAutoplay) await playCurrentQuestion();
    if (thisToken === questionToken) $('#play-question').focus();
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
  persist();
  gameCorrect = 0; gameAnswered = 0;
  try {
    await initializeAudio();
    showView('game-view');
    focusViewHeading('#game-title');
    await prepareQuestion(createQuestion(state.settings), state.settings.autoPlay);
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
  gameAnswered += 1;
  if (correct) gameCorrect += 1;
  state.statistics = recordAnswer(state.statistics, currentQuestion, option, correct);
  persist();
  const buttons = [...$('#answer-options').querySelectorAll('button')];
  buttons.forEach((answerButton) => {
    answerButton.disabled = true;
    if (answerButton.dataset.answerId === currentQuestion.correctAnswer.id) {
      answerButton.classList.add('correct');
      answerButton.querySelector('.answer-result').textContent = correct ? 'Correct' : 'Correct answer';
      answerButton.setAttribute('aria-label', `${answerButton.getAttribute('aria-label')}. Correct answer.`);
    }
    if (answerButton === button && !correct) {
      answerButton.classList.add('incorrect');
      answerButton.querySelector('.answer-result').textContent = 'Your answer';
      answerButton.setAttribute('aria-label', `${answerButton.getAttribute('aria-label')}. Your answer, incorrect.`);
    }
  });
  const feedback = $('#feedback');
  feedback.className = `feedback ${correct ? 'is-correct' : 'is-wrong'}`;
  feedback.textContent = correct ? `✓ Correct. ${currentQuestion.correctAnswer.label}` : `✕ Incorrect. The correct answer is ${currentQuestion.correctAnswer.label}.`;
  feedback.hidden = false;
  $('#next-question').disabled = false;
  $('#score-value').textContent = String(gameCorrect);
  $('#rate-value').textContent = formatAccuracy(state.statistics);
  $('#streak-value').textContent = String(state.statistics.currentStreak);
  $('#best-streak-value').textContent = String(state.statistics.bestStreak);
  $('#round-score').textContent = `${gameCorrect} correct`;
  feedback.focus();
  updateDebug();
}

async function nextQuestion() {
  if (!answered || busy) return;
  try {
    const next = getNextQuestion(state.settings, currentQuestion);
    await prepareQuestion(next, state.settings.autoPlay);
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
      try { await initializeAudio(); await playSingleNote(instrument, tone.midiNumber); }
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
  button.disabled = false;
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
$('#nav-settings').addEventListener('click', (event) => openSettings(event.currentTarget));
$('#settings-dialog').addEventListener('cancel', (event) => {
  if ($('#sample-credits').hidden) return;
  event.preventDefault();
  closeSampleCredits(true);
});
$('#settings-dialog').addEventListener('close', async () => {
  closeSampleCredits();
  if (!skipSettingsCloseUpdate && settingsChangedDuringDialog && currentQuestion && $('#game-view').classList.contains('active')) {
    try { await prepareQuestion(createQuestion(state.settings), state.settings.autoPlay); }
    catch (error) { showFatalError(error); }
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
$('#retry-audio').addEventListener('click', async () => {
  if (!currentQuestion || busy) return;
  setBusy(true, 'Retrying …');
  const current = currentQuestion;
  await prepareQuestion(current, true);
});
$('#go-samples-from-error').addEventListener('click', goSamples);
$('#next-question').addEventListener('click', nextQuestion);
function goHome() { showView('home-view'); focusViewHeading('#home-title'); }

$('#exit-game').addEventListener('click', () => { stopAllSounds(); currentQuestion = null; goHome(); });
$('#open-samples').addEventListener('click', goSamples);
$('#samples-back').addEventListener('click', goHome);
$('#sample-instrument').addEventListener('change', () => { sampleResults.clear(); renderSampleList(); });
$('#sample-difficulty').addEventListener('change', renderSampleList);
$('#sample-filter').addEventListener('change', renderSampleList);
$('#check-all-samples').addEventListener('click', checkAllSamples);
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
  if (['1', '2', '3'].includes(event.key) && !answered && !busy) {
    event.preventDefault();
    const button = $('#answer-options').querySelectorAll('button')[Number(event.key) - 1];
    if (button && !button.disabled) button.click();
  }
}, true);

updateHomeControls();
state.statistics.lastUsed = new Date().toISOString();
persist();
$('#score-value').textContent = '0';
$('#rate-value').textContent = formatAccuracy(state.statistics);
$('#streak-value').textContent = String(state.statistics.currentStreak);
$('#best-streak-value').textContent = String(state.statistics.bestStreak);
if (loaded.warning) announce(loaded.warning, true);
if (debugEnabled) updateDebug();