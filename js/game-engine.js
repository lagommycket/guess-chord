import { CHORDS, DIFFICULTIES, SCALES, allRequiredTonesAvailable, createChord, createScale, formatNoteName, getAllTonesForDifficulty, getToneByMidi, hasConfiguredSampleMapping } from './music-data.js';

let questionSequence = 0;
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const shuffled = (items) => [...items].sort(() => Math.random() - 0.5);
const stableId = (mode, metadata) => `${mode}:${metadata.rootMidi ?? metadata.midiNumber}:${metadata.type ?? ''}:${metadata.inversion ?? ''}:${metadata.direction ?? ''}`;

function answerLabel(mode, rootMidi, type, askRoot) {
  const root = formatNoteName(rootMidi);
  const title = mode === 'scale' ? SCALES[type].label : CHORDS[type].label;
  return askRoot ? `${root} ${title}` : title;
}

function optionSet(mode, rootMidi, type, difficulty) {
  const config = DIFFICULTIES[difficulty];
  const askRoot = config.askRoot;
  const table = mode === 'scale' ? SCALES : CHORDS;
  const result = [{ id: `${type}:${askRoot ? rootMidi : 'type'}`, label: answerLabel(mode, rootMidi, type, askRoot), type, rootMidi, correct: true }];
  for (const alternate of Object.keys(table).filter((key) => key !== type)) {
    result.push({ id: `${alternate}:${askRoot ? rootMidi : 'type'}`, label: answerLabel(mode, rootMidi, alternate, askRoot), type: alternate, rootMidi, correct: false });
    if (result.length === 3) break;
  }
  return shuffled(result).map(({ correct, ...option }) => option);
}

function makeNoteQuestion(settings) {
  const config = DIFFICULTIES[settings.difficulty];
  const pool = getAllTonesForDifficulty(settings.difficulty).filter((tone) => hasConfiguredSampleMapping(settings.instrument, tone.midiNumber) && (!config.preferNatural || [0, 2, 4, 5, 7, 9, 11].includes(tone.pitchClass)));
  const tone = pick(pool);
  const correct = { id: String(tone.midiNumber), label: formatNoteName(tone, true), midiNumber: tone.midiNumber };
  const distractors = [];
  for (const distance of shuffled(config.distractorDistance)) {
    for (const midi of [tone.midiNumber - distance, tone.midiNumber + distance]) {
      const candidate = getToneByMidi(midi);
      if (candidate && !distractors.some((entry) => entry.midiNumber === midi)) distractors.push({ id: String(midi), label: formatNoteName(candidate, true), midiNumber: midi });
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
    const correctAnswer = { id: `${type}:${difficulty.askRoot ? root.midiNumber : 'type'}`, label: answerLabel(mode, root.midiNumber, type, difficulty.askRoot), type, rootMidi: root.midiNumber };
    const answerOptions = optionSet(mode, root.midiNumber, type, settings.difficulty);
    return { id: `question-${++questionSequence}`, mode, instrument: settings.instrument, difficulty: settings.difficulty, correctAnswer, answerOptions, playbackNotes, playbackType: mode === 'scale' ? 'scale' : settings.chordPlayback, metadata: { rootMidi: root.midiNumber, type, inversion, direction, label: correctAnswer.label } };
  }
  throw new Error(`Could not create a valid ${mode === 'scale' ? 'scale' : 'chord'} question for ${difficulty.label} difficulty within the available pitch range. Change the difficulty or settings.`);
}

export function createQuestion(settings) {
  if (!settings || !['note', 'scale', 'chord'].includes(settings.mode) || !DIFFICULTIES[settings.difficulty]) throw new Error('Invalid settings. Check the exercise mode and difficulty.');
  if (settings.mode === 'note') return makeNoteQuestion(settings);
  return makeHarmonyQuestion(settings, settings.mode);
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
      const options = shuffled([tone, ...shuffled(alternatives.filter((entry) => entry.midiNumber !== tone.midiNumber)).slice(0, 2)]).map((entry) => ({ id: String(entry.midiNumber), label: formatNoteName(entry, true), midiNumber: entry.midiNumber }));
      const correct = options.find((option) => option.midiNumber === tone.midiNumber);
      return { id: `question-${++questionSequence}`, mode: 'note', instrument: settings.instrument, difficulty: settings.difficulty, correctAnswer: correct, answerOptions: options, playbackNotes: [tone.midiNumber], playbackType: 'single', metadata: { midiNumber: tone.midiNumber, label: correct.label } };
    }
  }
  return latest ?? createQuestion(settings);
}