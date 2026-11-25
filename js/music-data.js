const NOTE_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const GERMAN_NAMES = ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'B', 'H'];
const PITCH_CLASSES = ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'B', 'H'];

export const TONES = Array.from({ length: 37 }, (_, index) => {
  const midiNumber = 48 + index;
  const pitchClass = midiNumber % 12;
  const octave = Math.floor(midiNumber / 12) - 1;
  const internationalName = `${NOTE_NAMES[pitchClass]}${octave}`;
  return { midiNumber, internationalName, germanName: GERMAN_NAMES[pitchClass], pitchClass, octave, sampleFilename: `${internationalName}.mp3` };
});

export const DIFFICULTIES = {
  easy: { label: 'Easy', minMidi: 60, maxMidi: 71, preferNatural: true, askRoot: false, inversions: [0], scaleDirections: ['up'], distractorDistance: [1, 2, 5] },
  medium: { label: 'Medium', minMidi: 48, maxMidi: 72, preferNatural: false, askRoot: true, inversions: [0, 1], scaleDirections: ['up', 'up-down'], distractorDistance: [1, 2, 3, 5] },
  hard: { label: 'Hard', minMidi: 48, maxMidi: 84, preferNatural: false, askRoot: true, inversions: [0, 1, 2], scaleDirections: ['up', 'up-down'], distractorDistance: [1, 2, 3, 4] }
};

// Add new scale definitions here; generators and answer labels consume this table.
export const SCALES = {
  major: { label: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11, 12] },
  naturalMinor: { label: 'Natural minor', intervals: [0, 2, 3, 5, 7, 8, 10, 12] },
  harmonicMinor: { label: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11, 12] },
  melodicMinor: { label: 'Melodic minor', intervals: [0, 2, 3, 5, 7, 9, 11, 12] }
};

// Add new triad definitions here; inversion handling is shared by all entries.
export const CHORDS = {
  major: { label: 'Major', intervals: [0, 4, 7] },
  minor: { label: 'Minor', intervals: [0, 3, 7] },
  diminished: { label: 'Diminished', intervals: [0, 3, 6] },
  augmented: { label: 'Augmented', intervals: [0, 4, 8] }
};

export const SAMPLE_MAPS = {
  // These are the actual source pitches included in audio/, not every supported playback pitch.
  piano: [48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84],
  trumpet: [48, 51, 55, 58, 62, 65, 69, 72]
};

export function getToneByMidi(midiNumber) { return TONES.find((tone) => tone.midiNumber === midiNumber) ?? null; }
export function getToneByTechnicalName(name) { return TONES.find((tone) => tone.internationalName === name) ?? null; }
export function transposeTone(toneOrMidi, semitones) {
  const midi = typeof toneOrMidi === 'number' ? toneOrMidi : toneOrMidi?.midiNumber;
  return Number.isInteger(midi) ? getToneByMidi(midi + semitones) : null;
}
export function formatGermanNote(toneOrMidi, includeOctave = false) {
  const tone = typeof toneOrMidi === 'number' ? getToneByMidi(toneOrMidi) : toneOrMidi;
  return tone ? `${PITCH_CLASSES[tone.pitchClass]}${includeOctave ? tone.octave : ''}` : 'Unknown note';
}
export function formatNoteName(toneOrMidi, includeOctave = false) {
  const tone = typeof toneOrMidi === 'number' ? getToneByMidi(toneOrMidi) : toneOrMidi;
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  return tone ? `${names[tone.pitchClass]}${includeOctave ? tone.octave : ''}` : 'Unknown note';
}
export function getTonesForDifficulty(difficulty) {
  const config = DIFFICULTIES[difficulty];
  if (!config) return [];
  return TONES.filter((tone) => tone.midiNumber >= config.minMidi && tone.midiNumber <= config.maxMidi && (!config.preferNatural || [0, 2, 4, 5, 7, 9, 11].includes(tone.pitchClass)));
}
export function getAllTonesForDifficulty(difficulty) {
  const config = DIFFICULTIES[difficulty];
  return config ? TONES.filter((tone) => tone.midiNumber >= config.minMidi && tone.midiNumber <= config.maxMidi) : [];
}
export function createScale(rootMidi, scaleType, direction = 'up') {
  const definition = SCALES[scaleType];
  if (!definition || !getToneByMidi(rootMidi)) return [];
  const intervals = definition.intervals;
  const ascending = intervals.map((interval) => rootMidi + interval);
  if (ascending.some((midi) => !getToneByMidi(midi))) return [];
  if ((direction === 'down' || direction === 'up-down') && scaleType === 'melodicMinor') {
    const naturalDescending = SCALES.naturalMinor.intervals.slice(1, -1).reverse().map((interval) => rootMidi + interval);
    return direction === 'down' ? [...naturalDescending, rootMidi] : [...ascending, ...naturalDescending, rootMidi];
  }
  if (direction === 'up-down') return [...ascending, ...ascending.slice(1, -1).reverse()];
  if (direction === 'down') return ascending.reverse();
  return ascending;
}
export function createChord(rootMidi, chordType, inversion = 0) {
  const definition = CHORDS[chordType];
  if (!definition || !Number.isInteger(inversion) || inversion < 0 || inversion > 2) return [];
  const notes = definition.intervals.map((interval) => rootMidi + interval).sort((a, b) => a - b);
  for (let index = 0; index < inversion; index += 1) notes.push(notes.shift() + 12);
  return notes.every((midi) => getToneByMidi(midi)) ? notes : [];
}
export function isToneAvailable(midiNumber) { return getToneByMidi(midiNumber) !== null; }
export function getSampleFilename(toneOrMidi) {
  const tone = typeof toneOrMidi === 'number' ? getToneByMidi(toneOrMidi) : toneOrMidi;
  return tone?.sampleFilename ?? null;
}
export function getRequiredSampleFilenames(question) {
  return [...new Set((question?.playbackNotes ?? []).map(getSampleFilename).filter(Boolean))];
}
export function getSampleSources(instrument, midiNumber) {
  const candidates = SAMPLE_MAPS[instrument];
  if (!candidates) return [];
  return candidates.map((sourceMidi) => ({ tone: getToneByMidi(sourceMidi), difference: midiNumber - sourceMidi }))
    .filter((entry) => entry.tone && Math.abs(entry.difference) <= 3)
    .sort((a, b) => Math.abs(a.difference) - Math.abs(b.difference));
}
export function findSampleSource(instrument, midiNumber) { return getSampleSources(instrument, midiNumber)[0] ?? null; }
export function hasConfiguredSampleMapping(instrument, midiNumber) { return findSampleSource(instrument, midiNumber) !== null; }
export function allRequiredTonesAvailable(notes) { return Array.isArray(notes) && notes.length > 0 && notes.every(isToneAvailable); }