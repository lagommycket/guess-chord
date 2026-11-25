import { getSampleSources, getToneByMidi } from './music-data.js';

const INSTRUMENT_LABELS = { piano: 'Piano', trumpet: 'Trumpet' };
const SAMPLE_ROOTS = { piano: './audio/piano/', trumpet: './audio/trumpet/' };
const audioBufferCache = new Map();
const loadingPromises = new Map();
const activeAudioBufferSourceNodes = new Set();
const requestedMappingDebug = [];
let audioContext = null;
let audioReadyPromise = null;
let masterGain = null;
let masterVolume = 0.75;
let playbackToken = 0;
let lastAudioError = null;
let iosAudioUnlocked = false;
let audioNeedsResume = false;
let usedWebkitAudioContext = false;
let masterGainConnected = false;
let lastRequestedSampleURL = null;
let lastSuccessfullyDecodedSample = null;
let lastPlaybackStartTime = null;
let lastSampleFailure = null;

document.addEventListener('visibilitychange', () => {
  if (document.hidden && audioContext) interruptAudio();
  else if (audioContext && audioContext.state !== 'running') audioNeedsResume = true;
});

window.addEventListener('pagehide', () => {
  if (!audioContext || audioContext.state === 'closed') return;
  interruptAudio();
});

function interruptAudio() {
  audioNeedsResume = true;
  iosAudioUnlocked = false;
  stopAllSounds();
  window.dispatchEvent(new Event('audio-interrupted'));
}

function unlockIOSAudio(context) {
  if (iosAudioUnlocked) return;
  const buffer = context.createBuffer(1, 1, 22050);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => source.disconnect();
  source.start(0);
  iosAudioUnlocked = true;
}

function samplePath(instrument, filename) {
  if (!SAMPLE_ROOTS[instrument]) throw new Error(`Unknown instrument folder: ${instrument}`);
  return `${SAMPLE_ROOTS[instrument]}${filename}`;
}

export function isIOSWebKit() {
  const userAgent = navigator.userAgent ?? '';
  return /iPad|iPhone|iPod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function ensureAudioReady() {
  if (audioReadyPromise) return audioReadyPromise;
  audioReadyPromise = createAudioReadyContext();
  try { return await audioReadyPromise; }
  finally { audioReadyPromise = null; }
}

async function createAudioReadyContext() {
  let resumePromise = null;
  if (navigator.audioSession) {
    try { navigator.audioSession.type = 'playback'; }
    catch (error) { console.info('[Audio] Playback session unavailable:', error); }
  }
  if (audioContext?.state === 'closed') {
    audioContext = null;
    masterGain = null;
    masterGainConnected = false;
    iosAudioUnlocked = false;
  }
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support the Web Audio API.');
    usedWebkitAudioContext = !window.AudioContext && Boolean(window.webkitAudioContext);
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(audioContext.destination);
    masterGainConnected = true;
    const context = audioContext;
    context.addEventListener('statechange', () => {
      if (context === audioContext && context.state !== 'running') interruptAudio();
    });
  }
  if (audioContext.state !== 'running' && audioContext.state !== 'closed') {
    audioNeedsResume = true;
    try { resumePromise = audioContext.resume(); }
    catch (error) { lastAudioError = error.message; throw new Error('Audio is suspended. Tap Play to resume audio.'); }
  }
  try { unlockIOSAudio(audioContext); }
  catch (error) { lastAudioError = error.message; throw new Error('Could not unlock audio. Tap Play and try again.'); }
  if (resumePromise) {
    try { await resumePromise; }
    catch (error) { lastAudioError = error.message; throw new Error('Audio is suspended. Tap Play to resume audio.'); }
  }
  if (audioContext.state !== 'running') {
    audioNeedsResume = true;
    throw new Error(`Audio is not running (${audioContext.state}). Tap Play to resume audio.`);
  }
  audioNeedsResume = false;
  return audioContext;
}

export const initializeAudio = ensureAudioReady;
export const resumeAudio = ensureAudioReady;

export function setMasterVolume(value) {
  masterVolume = Math.max(0, Math.min(1, Number(value) || 0));
  if (audioContext && masterGain) masterGain.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.015);
}

export async function loadSample(instrument, filename) {
  const path = samplePath(instrument, filename);
  lastRequestedSampleURL = path;
  const cacheKey = `${instrument}:${filename}`;
  if (audioBufferCache.has(cacheKey)) return audioBufferCache.get(cacheKey);
  if (loadingPromises.has(cacheKey)) return loadingPromises.get(cacheKey);
  if (!audioContext || !masterGainConnected) throw new Error('Tap Start or Play to unlock audio before loading samples.');
  const promise = (async () => {
    let response;
    try { response = await fetch(path); }
    catch (error) { throw new Error(`Network error loading ${path}: ${error.message}`); }
    if (!response.ok) throw new Error(`Audio file is missing (${response.status}): ${path}`);
    const data = await response.arrayBuffer();
    let decoded;
    try { decoded = await decodeAudioData(audioContext, data); }
    catch (error) { throw new Error(`Unsupported or invalid audio format: ${path} (${error.message})`); }
    audioBufferCache.set(cacheKey, decoded);
    lastSuccessfullyDecodedSample = path;
    return decoded;
  })();
  loadingPromises.set(cacheKey, promise);
  try { return await promise; }
  catch (error) { lastAudioError = error.message; throw error; }
  finally { loadingPromises.delete(cacheKey); }
}

function decodeAudioData(context, data) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (buffer) => { if (!settled) { settled = true; resolve(buffer); } };
    const fail = (error) => { if (!settled) { settled = true; reject(error); } };
    try {
      const result = context.decodeAudioData(data.slice(0), succeed, fail);
      if (result && typeof result.then === 'function') result.then(succeed, fail);
    } catch (error) { fail(error); }
  });
}

async function resolveSample(instrument, requestedMidi) {
  const requestedTone = getToneByMidi(requestedMidi);
  if (!requestedTone) throw new Error(`Requested note ${requestedMidi} is outside C3-C6.`);
  const candidates = getSampleSources(instrument, requestedMidi);
  if (!candidates.length) {
    const error = new Error(`No configured source sample within three semitones of ${requestedTone.internationalName} (${INSTRUMENT_LABELS[instrument] ?? instrument}).`);
    lastSampleFailure = { instrument, requestedNote: requestedTone.internationalName, sourceSample: null, semitoneDifference: null, path: null, message: error.message };
    throw error;
  }
  let lastError;
  const attemptedPaths = [];
  let lastMapping = null;
  for (const mapping of candidates) {
    lastMapping = mapping;
    attemptedPaths.push(samplePath(instrument, mapping.tone.sampleFilename));
    try {
      const buffer = await loadSample(instrument, mapping.tone.sampleFilename);
      const playbackRate = Math.pow(2, mapping.difference / 12);
      const debugEntry = { instrument, requestedTone: requestedTone.internationalName, sourceSample: mapping.tone.sampleFilename, semitoneDifference: mapping.difference, playbackRate };
      requestedMappingDebug.push(debugEntry);
      if (requestedMappingDebug.length > 40) requestedMappingDebug.shift();
      lastSampleFailure = null;
      return { buffer, mapping, playbackRate, debugEntry, requestedTone };
    } catch (error) {
      lastError = error;
      lastSampleFailure = { instrument, requestedNote: requestedTone.internationalName, sourceSample: mapping.tone.sampleFilename,
        semitoneDifference: mapping.difference, path: samplePath(instrument, mapping.tone.sampleFilename), message: error.message };
    }
  }
  lastError.sampleMapping = lastMapping;
  lastError.attemptedPaths = attemptedPaths;
  throw lastError;
}

export async function checkRequiredSamples(instrument, notes) {
  const results = [];
  for (const midi of notes) {
    const tone = getToneByMidi(midi);
    if (!tone) continue;
    const mappings = getSampleSources(instrument, midi);
    const entry = { midiNumber: midi, tone, expectedFilename: tone.sampleFilename, expectedPath: samplePath(instrument, tone.sampleFilename), status: 'missing', sourceFilename: mappings[0]?.tone.sampleFilename ?? null, semitoneDifference: mappings[0]?.difference ?? null };
    if (!mappings.length) { results.push(entry); continue; }
    try {
      const resolved = await resolveSample(instrument, midi);
      entry.sourceFilename = resolved.mapping.tone.sampleFilename;
      entry.semitoneDifference = resolved.mapping.difference;
      entry.status = resolved.mapping.difference === 0 ? 'exact' : 'transposed';
    } catch (error) {
      entry.error = error.message;
      entry.sourceFilename = error.sampleMapping?.tone.sampleFilename ?? entry.sourceFilename;
      entry.semitoneDifference = error.sampleMapping?.difference ?? entry.semitoneDifference;
      entry.sourcePath = error.sampleMapping ? samplePath(instrument, error.sampleMapping.tone.sampleFilename) : null;
      entry.attemptedPaths = error.attemptedPaths ?? [];
    }
    results.push(entry);
  }
  return results;
}

export function stopAllSounds() {
  playbackToken += 1;
  for (const source of [...activeAudioBufferSourceNodes]) {
    try { source.stop(); } catch { /* A source may already have ended. */ }
  }
  return playbackToken;
}

async function scheduleNotes(instrument, notes, options = {}) {
  if (!Array.isArray(notes) || !notes.length) throw new Error('There are no notes to play.');
  const context = await ensureAudioReady();
  const token = stopAllSounds();
  const resolved = await Promise.all(notes.map((midi) => resolveSample(instrument, midi)));
  if (token !== playbackToken) return false;
  if (context.state !== 'running') throw new Error('Audio was interrupted. Tap Play to continue.');
  const now = context.currentTime + 0.04;
  lastPlaybackStartTime = now;
  const spacing = options.spacing ?? 0;
  const promises = resolved.map((sample, index) => {
    const source = context.createBufferSource();
    const envelope = context.createGain();
    const startOffset = options.humanize ? Math.random() * 0.015 : 0;
    const startAt = now + (options.simultaneous ? startOffset : index * spacing);
    const rate = sample.playbackRate;
    const duration = Math.min(sample.buffer.duration / rate, options.noteDuration ?? Infinity);
    const attack = 0.005;
    const release = Math.min(0.04, Math.max(0.005, duration / 2));
    const peakVariation = options.volumeVariation ? 0.95 + Math.random() * 0.1 : 1;
    source.buffer = sample.buffer;
    source.playbackRate.value = rate;
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.linearRampToValueAtTime(peakVariation, startAt + attack);
    envelope.gain.setValueAtTime(peakVariation, Math.max(startAt + attack, startAt + duration - release));
    envelope.gain.linearRampToValueAtTime(0.0001, startAt + duration);
    source.connect(envelope);
    envelope.connect(masterGain);
    activeAudioBufferSourceNodes.add(source);
    const ended = new Promise((resolve) => {
      source.onended = () => { activeAudioBufferSourceNodes.delete(source); source.disconnect(); envelope.disconnect(); resolve(); };
    });
    source.start(startAt);
    source.stop(startAt + duration + 0.005);
    return ended;
  });
  await Promise.all(promises);
  return token === playbackToken;
}

export function playSingleNote(instrument, midiNumber) {
  return scheduleNotes(instrument, [midiNumber]);
}

export function playScale(instrument, notes, options = {}) {
  return scheduleNotes(instrument, notes, { ...options, spacing: 0.45, noteDuration: 0.4 });
}

export function playChord(instrument, notes, options = {}) {
  return scheduleNotes(instrument, notes, { ...options, simultaneous: true });
}

export function playArpeggio(instrument, notes, options = {}) {
  return scheduleNotes(instrument, notes, { ...options, spacing: 0.25, noteDuration: 0.22 });
}

export function getAudioDebugState() {
  return {
    contextState: audioContext?.state ?? 'not-initialized',
    audioContextSupported: Boolean(window.AudioContext || window.webkitAudioContext),
    usedWebkitAudioContext,
    iosAudioUnlocked,
    audioNeedsResume,
    masterGainConnected,
    audioSessionType: navigator.audioSession?.type ?? 'unsupported',
    cachedBuffers: audioBufferCache.size,
    loadingSamples: [...loadingPromises.keys()],
    activeSources: activeAudioBufferSourceNodes.size,
    playbackToken,
    lastRequestedSampleURL,
    lastSuccessfullyDecodedSample,
    lastPlaybackStartTime,
    visibilityState: document.visibilityState,
    lastSampleFailure,
    lastAudioError,
    mappings: requestedMappingDebug.slice(-12)
  };
}