import { CHORDS, DIFFICULTIES, SCALES, allRequiredTonesAvailable, createChord, createScale, formatNoteName, getAllTonesForDifficulty, getToneByMidi, hasConfiguredSampleMapping } from './music-data.js';

let questionSequence = 0;
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const shuffled = (items) => [...items].sort(() => Math.random() - 0.5);
const stableId = (mode, metadata) => `${mode}:${metadata.rootMidi ?? metadata.midiNumber}:${metadata.type ?? ''}:${metadata.inversion ?? ''}:${metadata.direction ?? ''}`;

function displayNote(midi, settings, includeOctave = false) {
  const notation = settings.instrument === 'trumpet' ? settings.trumpetNotation ?? 'bb' : settings.pianoNotation ?? 'concert';
  const writtenMidi = midi + (notation === 'bb' ? 2 : 0);
  return formatNoteName({ pitchClass: writtenMidi % 12, octave: Math.floor(writtenMidi / 12) - 1 }, includeOctave);
}

function answerLabel(mode, rootMidi, type, askRoot, settings) {
  const root = displayNote(rootMidi, settings);
  const title = mode === 'scale' ? SCALES[type].label : CHORDS[type].label;
  return askRoot ? `${root} ${title}` : title;
}

function optionSet(mode, rootMidi, type, difficulty, settings) {
  const config = DIFFICULTIES[difficulty];
  const askRoot = config.askRoot;
  const table = mode === 'scale' ? SCALES : CHORDS;
  const result = [{ id: `${type}:${askRoot ? rootMidi : 'type'}`, label: answerLabel(mode, rootMidi, type, askRoot, settings), type, rootMidi, correct: true }];
  for (const alternate of Object.keys(table).filter((key) => key !== type)) {
    result.push({ id: `${alternate}:${askRoot ? rootMidi : 'type'}`, label: answerLabel(mode, rootMidi, alternate, askRoot, settings), type: alternate, rootMidi, correct: false });
    if (result.length === 3) break;
  }
  return shuffled(result).map(({ correct, ...option }) => option);
}

function makeNoteQuestion(settings) {
  const config = DIFFICULTIES[settings.difficulty];
  const pool = getAllTonesForDifficulty(settings.difficulty).filter((tone) => hasConfiguredSampleMapping(settings.instrument, tone.midiNumber) && (!config.preferNatural || [0, 2, 4, 5, 7, 9, 11].includes(tone.pitchClass)));
  const tone = pick(pool);
  const correct = { id: String(tone.midiNumber), label: displayNote(tone.midiNumber, settings, true), midiNumber: tone.midiNumber };
  const distractors = [];
  for (const distance of shuffled(config.distractorDistance)) {
    for (const midi of [tone.midiNumber - distance, tone.midiNumber + distance]) {
      const candidate = getToneByMidi(midi);
      if (candidate && !distractors.some((entry) => entry.midiNumber === midi)) distractors.push({ id: String(midi), label: displayNote(midi, settings, true), midiNumber: midi });
      if (distractors.length === 2) break;
    }
    if (distractors.length === 2) break;
  }
  const answers = shuffled([correct, ...distractors]);
  return { id: `question-${++questionSequence}`, mode: 'note', instrument: settings.instrument, difficulty: settings.difficulty, correctAnswer: correct, answerOptions: answers, playbackNotes: [tone.midiNumber], playbackType: 'single', metadata: { midiNumber: tone.midiNumber, label: correct.label } };
}

function makeHarmonyQuestion(settings, mode) {
  const types = Object.keys(mode === 'scale' ? SCALES : CHORDS);
  const difficulty = DIFFICULTIES[settings.difficulty];
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const root = pick(getAllTonesForDifficulty(settings.difficulty).filter((tone) => hasConfiguredSampleMapping(settings.instrument, tone.midiNumber)));
    const type = pick(types);
    let direction = 'up';
    if (mode === 'scale' && settings.scaleDirection !== 'random' && difficulty.scaleDirections.includes(settings.scaleDirection)) direction = settings.scaleDirection;
    if (mode === 'scale' && settings.difficulty === 'hard' && settings.scaleDirection === 'random') direction = pick(difficulty.scaleDirections);
    const inversion = mode === 'chord' ? pick(difficulty.inversions) : 0;
    const playbackNotes = mode === 'scale' ? createScale(root.midiNumber, type, direction) : createChord(root.midiNumber, type, inversion);
    if (!allRequiredTonesAvailable(playbackNotes) || !playbackNotes.every((midi) => hasConfiguredSampleMapping(settings.instrument, midi))) continue;
    const correctAnswer = { id: `${type}:${difficulty.askRoot ? root.midiNumber : 'type'}`, label: answerLabel(mode, root.midiNumber, type, difficulty.askRoot, settings), type, rootMidi: root.midiNumber };
    const answerOptions = optionSet(mode, root.midiNumber, type, settings.difficulty, settings);
    return { id: `question-${++questionSequence}`, mode, instrument: settings.instrument, difficulty: settings.difficulty, correctAnswer, answerOptions, playbackNotes, playbackType: mode === 'scale' ? 'scale' : settings.chordPlayback, metadata: { rootMidi: root.midiNumber, type, inversion, direction, label: correctAnswer.label } };
  }
  throw new Error(`Could not create a valid ${mode === 'scale' ? 'scale' : 'chord'} question for ${difficulty.label} difficulty within the available pitch range. Change the difficulty or settings.`);
}

export function createQuestion(settings) {
  if (!settings || !['note', 'scale', 'chord'].includes(settings.mode) || !DIFFICULTIES[settings.difficulty]) throw new Error('Invalid settings. Check the exercise mode and difficulty.');
  if (settings.mode === 'note') return makeNoteQuestion(settings);
  return makeHarmonyQuestion(settings, settings.mode);
}

export function createTrainingSession(settings) {
  if (!settings || !['note', 'scale', 'chord'].includes(settings.mode) || !DIFFICULTIES[settings.difficulty] || !SCALES[settings.trainingScale] || !Number.isInteger(settings.trainingRoot) || settings.trainingRoot < 0 || settings.trainingRoot > 11) throw new Error('Choose a valid training set.');
  const notation = settings.instrument === 'trumpet' ? settings.trumpetNotation ?? 'bb' : settings.pianoNotation ?? 'concert';
  let root = 60 + settings.trainingRoot - (notation === 'bb' ? 2 : 0);
  if (root < 48) root += 12;
  if (settings.instrument === 'trumpet' && root > 63) root -= 12;
  if (settings.mode === 'chord' && root > (settings.instrument === 'trumpet' ? 59 : 68)) root -= 12;
  let items;
  if (settings.mode === 'note') {
    items = SCALES[settings.trainingScale].intervals.slice(0, -1).map((interval) => ({ id: `note:${root + interval}`, midiNumber: root + interval }));
  } else {
    const table = settings.mode === 'scale' ? SCALES : CHORDS;
    items = Object.keys(table).map((type) => ({ id: `${settings.mode}:${root}:${type}`, rootMidi: root, type }));
  }
  for (const item of items) {
    const notes = settings.mode === 'note' ? [item.midiNumber] : settings.mode === 'scale' ? createScale(item.rootMidi, item.type) : createChord(item.rootMidi, item.type);
    if (!notes.length || !notes.every((midi) => hasConfiguredSampleMapping(settings.instrument, midi))) throw new Error('This set is outside the available sample range. Choose another key or instrument.');
  }
  return { items, queue: shuffled(items), rootMidi: root, mode: settings.mode, scale: settings.trainingScale, total: items.length, mastered: 0, attempts: 0 };
}

export function createTrainingQuestion(settings, session) {
  const item = session.queue[0];
  if (!item) return null;
  const difficulty = DIFFICULTIES[settings.difficulty];
  if (settings.mode === 'note') {
    const correct = { id: String(item.midiNumber), label: displayNote(item.midiNumber, settings, true), midiNumber: item.midiNumber };
    const candidates = shuffled(session.items.filter((entry) => entry.id !== item.id));
    if (settings.difficulty === 'easy') candidates.sort((first, second) => Math.abs(second.midiNumber - item.midiNumber) - Math.abs(first.midiNumber - item.midiNumber));
    if (settings.difficulty === 'hard') candidates.sort((first, second) => Math.abs(first.midiNumber - item.midiNumber) - Math.abs(second.midiNumber - item.midiNumber));
    const distractors = candidates.slice(0, 2).map((entry) => ({ id: String(entry.midiNumber), label: displayNote(entry.midiNumber, settings, true), midiNumber: entry.midiNumber }));
    return { id: `question-${++questionSequence}`, trainingItemId: item.id, mode: 'note', instrument: settings.instrument, difficulty: settings.difficulty, correctAnswer: correct, answerOptions: shuffled([correct, ...distractors]), playbackNotes: [item.midiNumber], playbackType: 'single', metadata: { midiNumber: item.midiNumber, label: correct.label } };
  }
  let direction = 'up';
  if (settings.mode === 'scale' && difficulty.scaleDirections.includes(settings.scaleDirection)) direction = settings.scaleDirection;
  else if (settings.mode === 'scale' && settings.difficulty === 'hard' && settings.scaleDirection === 'random') direction = pick(difficulty.scaleDirections);
  const inversion = settings.mode === 'chord' ? pick(difficulty.inversions) : 0;
  const playbackNotes = settings.mode === 'scale' ? createScale(item.rootMidi, item.type, direction) : createChord(item.rootMidi, item.type, inversion);
  const correctAnswer = { id: `${item.type}:${difficulty.askRoot ? item.rootMidi : 'type'}`, label: answerLabel(settings.mode, item.rootMidi, item.type, difficulty.askRoot, settings), type: item.type, rootMidi: item.rootMidi };
  return { id: `question-${++questionSequence}`, trainingItemId: item.id, mode: settings.mode, instrument: settings.instrument, difficulty: settings.difficulty, correctAnswer, answerOptions: optionSet(settings.mode, item.rootMidi, item.type, settings.difficulty, settings), playbackNotes, playbackType: settings.mode === 'scale' ? 'scale' : settings.chordPlayback, metadata: { rootMidi: item.rootMidi, type: item.type, inversion, direction, label: correctAnswer.label } };
}

export function recordTrainingResult(session, question, correct) {
  if (!session.queue.length || session.queue[0].id !== question.trainingItemId) throw new Error('The question does not match the current training set.');
  const item = session.queue.shift();
  session.attempts += 1;
  if (correct) session.mastered += 1;
  else session.queue.push(item);
  return session;
}

export function relabelQuestion(question, settings) {
  const options = question.answerOptions.map((option) => ({
    ...option,
    label: question.mode === 'note' ? displayNote(option.midiNumber, settings, true)
      : answerLabel(question.mode, option.rootMidi, option.type, DIFFICULTIES[question.difficulty].askRoot, settings)
  }));
  const correctAnswer = options.find((option) => option.id === question.correctAnswer.id);
  return { ...question, answerOptions: options, correctAnswer, metadata: { ...question.metadata, label: correctAnswer.label } };
}

export function checkAnswer(question, selectedAnswer) {
  return Boolean(question && selectedAnswer && question.correctAnswer.id === selectedAnswer.id);
}

export function getNextQuestion(settings, previousQuestion) {
  let latest = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const question = createQuestion(settings);
    latest = question;
    if (stableId(question.mode, question.metadata) !== stableId(previousQuestion?.mode ?? '', previousQuestion?.metadata ?? {})) return question;
  }
  if (previousQuestion?.mode === 'note') {
    const alternatives = getAllTonesForDifficulty(settings.difficulty).filter((tone) => tone.midiNumber !== previousQuestion.metadata.midiNumber && hasConfiguredSampleMapping(settings.instrument, tone.midiNumber));
    if (alternatives.length) {
      const tone = pick(alternatives);
      const options = shuffled([tone, ...shuffled(alternatives.filter((entry) => entry.midiNumber !== tone.midiNumber)).slice(0, 2)]).map((entry) => ({ id: String(entry.midiNumber), label: displayNote(entry.midiNumber, settings, true), midiNumber: entry.midiNumber }));
      const correct = options.find((option) => option.midiNumber === tone.midiNumber);
      return { id: `question-${++questionSequence}`, mode: 'note', instrument: settings.instrument, difficulty: settings.difficulty, correctAnswer: correct, answerOptions: options, playbackNotes: [tone.midiNumber], playbackType: 'single', metadata: { midiNumber: tone.midiNumber, label: correct.label } };
    }
  }
  return latest ?? createQuestion(settings);
}