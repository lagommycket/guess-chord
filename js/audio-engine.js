import { getSampleSources, getToneByMidi } from './music-data.js';

const INSTRUMENT_LABELS = { piano: 'Piano', trumpet: 'Trumpet' };
const SAMPLE_ROOTS = { piano: './audio/piano/', trumpet: './audio/trumpet/' };
const bufferCache = new Map();
const pendingLoads = new Map();
const activeSources = new Set();
const requestedMappingDebug = [];
let audioContext = null;
let masterGain = null;
let masterVolume = 0.75;
let playbackToken = 0;
let lastAudioError = null;

function samplePath(instrument, filename) {
  if (!SAMPLE_ROOTS[instrument]) throw new Error(`Unknown instrument folder: ${instrument}`);
  return `${SAMPLE_ROOTS[instrument]}${filename}`;
}

export async function initializeAudio() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('This browser does not support the Web Audio API.');
    audioContext = new Context();
    masterGain = audioContext.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(audioContext.destination);
  }
  await resumeAudio();
  return audioContext;
}

export async function resumeAudio() {
  if (!audioContext) return initializeAudio();
  if (audioContext.state === 'suspended') await audioContext.resume();
  if (audioContext.state !== 'running') throw new Error('Audio playback is blocked. Please try pressing Play again.');
  return audioContext;
}

export function setMasterVolume(value) {
  masterVolume = Math.max(0, Math.min(1, Number(value) || 0));
  if (audioContext && masterGain) masterGain.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.015);
}

export async function loadSample(instrument, filename) {
  const path = samplePath(instrument, filename);
  const cacheKey = `${instrument}:${filename}`;
  if (bufferCache.has(cacheKey)) return bufferCache.get(cacheKey);
  if (pendingLoads.has(cacheKey)) return pendingLoads.get(cacheKey);
  const promise = (async () => {
    await initializeAudio();
    let response;
    try { response = await fetch(path); }
    catch (error) { throw new Error(`Network error loading ${path}: ${error.message}`); }
    if (!response.ok) throw new Error(`Audio file is missing (${response.status}): ${path}`);
    const data = await response.arrayBuffer();
    let decoded;
    try { decoded = await audioContext.decodeAudioData(data); }
    catch (error) { throw new Error(`Unsupported or invalid audio format: ${path} (${error.message})`); }
    bufferCache.set(cacheKey, decoded);
    return decoded;
  })();
  pendingLoads.set(cacheKey, promise);
  try { return await promise; }
  catch (error) { lastAudioError = error.message; throw error; }
  finally { pendingLoads.delete(cacheKey); }
}

async function resolveSample(instrument, requestedMidi) {
  const requestedTone = getToneByMidi(requestedMidi);
  if (!requestedTone) throw new Error(`Requested note ${requestedMidi} is outside C3-C6.`);
  const candidates = getSampleSources(instrument, requestedMidi);
  if (!candidates.length) throw new Error(`No configured source sample within three semitones of ${requestedTone.internationalName} (${INSTRUMENT_LABELS[instrument] ?? instrument}).`);
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
      return { buffer, mapping, playbackRate, debugEntry, requestedTone };
    } catch (error) { lastError = error; }
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
  for (const source of [...activeSources]) {
    try { source.stop(); } catch { /* A source may already have ended. */ }
  }
  return playbackToken;
}

async function scheduleNotes(instrument, notes, options = {}) {
  if (!Array.isArray(notes) || !notes.length) throw new Error('There are no notes to play.');
  const token = stopAllSounds();
  await initializeAudio();
  const resolved = await Promise.all(notes.map((midi) => resolveSample(instrument, midi)));
  if (token !== playbackToken) return false;
  const now = audioContext.currentTime + 0.04;
  const spacing = options.spacing ?? 0;
  const promises = resolved.map((sample, index) => {
    const source = audioContext.createBufferSource();
    const envelope = audioContext.createGain();
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
    activeSources.add(source);
    const ended = new Promise((resolve) => {
      source.onended = () => { activeSources.delete(source); source.disconnect(); envelope.disconnect(); resolve(); };
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
  return { contextState: audioContext?.state ?? 'not-initialized', cachedBuffers: bufferCache.size, pendingLoads: pendingLoads.size,
    activeSources: activeSources.size, playbackToken, lastAudioError, mappings: requestedMappingDebug.slice(-12) };
}