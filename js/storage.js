export const STORAGE_KEY = 'gehoertraining-data';
export const STORAGE_VERSION = 1;

export const DEFAULT_SETTINGS = {
  mode: 'note', instrument: 'piano', difficulty: 'easy', volume: 0.75,
  scaleDirection: 'up', chordPlayback: 'simultaneous', humanize: false,
  volumeVariation: false, autoPlay: true
};

export function defaultStatistics() {
  return { totalQuestions: 0, correctAnswers: 0, wrongAnswers: 0, currentStreak: 0, bestStreak: 0,
    byMode: { note: { attempts: 0, correct: 0 }, scale: { attempts: 0, correct: 0 }, chord: { attempts: 0, correct: 0 } },
    errorsByNote: {}, errorsByScale: {}, errorsByChord: {}, errorsByInstrument: {}, errorsByDifficulty: {}, lastUsed: null };
}

function validSettings(candidate) {
  if (!candidate || typeof candidate !== 'object') return { ...DEFAULT_SETTINGS };
  const settings = { ...DEFAULT_SETTINGS, ...candidate };
  if (!['note', 'scale', 'chord'].includes(settings.mode)) settings.mode = DEFAULT_SETTINGS.mode;
  if (!['piano', 'trumpet'].includes(settings.instrument)) settings.instrument = DEFAULT_SETTINGS.instrument;
  if (!['easy', 'medium', 'hard'].includes(settings.difficulty)) settings.difficulty = DEFAULT_SETTINGS.difficulty;
  if (!['up', 'up-down', 'random'].includes(settings.scaleDirection)) settings.scaleDirection = DEFAULT_SETTINGS.scaleDirection;
  if (!['simultaneous', 'arpeggio'].includes(settings.chordPlayback)) settings.chordPlayback = DEFAULT_SETTINGS.chordPlayback;
  settings.volume = Number.isFinite(Number(settings.volume)) ? Math.max(0, Math.min(1, Number(settings.volume))) : DEFAULT_SETTINGS.volume;
  for (const key of ['humanize', 'volumeVariation', 'autoPlay']) settings[key] = Boolean(settings[key]);
  return settings;
}

function validStatistics(candidate) {
  const defaults = defaultStatistics();
  if (!candidate || typeof candidate !== 'object') return defaults;
  const result = { ...defaults, ...candidate };
  for (const key of ['totalQuestions', 'correctAnswers', 'wrongAnswers', 'currentStreak', 'bestStreak']) {
    result[key] = Number.isFinite(candidate[key]) && candidate[key] >= 0 ? Math.floor(candidate[key]) : 0;
  }
  result.byMode = { ...defaults.byMode };
  for (const mode of Object.keys(defaults.byMode)) {
    const entry = candidate.byMode?.[mode];
    result.byMode[mode] = { attempts: Number.isFinite(entry?.attempts) ? Math.max(0, Math.floor(entry.attempts)) : 0, correct: Number.isFinite(entry?.correct) ? Math.max(0, Math.floor(entry.correct)) : 0 };
  }
  for (const key of ['errorsByNote', 'errorsByScale', 'errorsByChord', 'errorsByInstrument', 'errorsByDifficulty']) {
    const source = candidate[key];
    result[key] = source && typeof source === 'object' && !Array.isArray(source)
      ? Object.fromEntries(Object.entries(source).filter(([, value]) => Number.isFinite(value) && value >= 0).map(([label, value]) => [label.slice(0, 80), Math.floor(value)]))
      : {};
  }
  result.lastUsed = typeof candidate.lastUsed === 'string' ? candidate.lastUsed : null;
  return result;
}

export function validateData(candidate) {
  return { version: STORAGE_VERSION, settings: validSettings(candidate?.settings), statistics: validStatistics(candidate?.statistics) };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { data: validateData(null), warning: '' };
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return { data: validateData(null), warning: 'Saved data uses an unknown version. Safe defaults have been loaded.' };
    return { data: validateData(parsed), warning: '' };
  } catch (error) {
    return { data: validateData(null), warning: 'Saved data is damaged or unavailable. Safe defaults have been loaded.', error: error.message };
  }
}

export function saveData(data) {
  const validated = validateData(data);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(validated)); return { ok: true, data: validated }; }
  catch (error) { return { ok: false, data: validated, error: 'Could not save data to local browser storage.' }; }
}

export function createExport(data) {
  return { version: STORAGE_VERSION, exportedAt: new Date().toISOString(), settings: validSettings(data.settings), statistics: validStatistics(data.statistics) };
}

export function parseImport(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('The file does not contain valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== STORAGE_VERSION || !parsed.settings || !parsed.statistics) {
    throw new Error('The file does not contain a supported Ear Training data structure.');
  }
  return validateData(parsed);
}