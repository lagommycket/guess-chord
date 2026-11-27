import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingSession, createTrainingQuestion, recordTrainingResult, checkAnswer, relabelQuestion } from '../js/game-engine.js';
import { hasConfiguredSampleMapping } from '../js/music-data.js';
import { validateData, createExport, parseImport } from '../js/storage.js';

const defaults = validateData(null).settings;

test('C major contains seven notes and missed notes return until mastered', () => {
  const session = createTrainingSession(defaults);
  assert.deepEqual(session.items.map((item) => item.midiNumber), [60, 62, 64, 65, 67, 69, 71]);
  const missed = createTrainingQuestion(defaults, session);
  recordTrainingResult(session, missed, false);
  assert.equal(session.mastered, 0);
  assert.equal(session.queue.length, 7);
  assert.equal(session.queue.at(-1).id, missed.trainingItemId);
  let repeated = false;
  while (session.queue.length) {
    const question = createTrainingQuestion(defaults, session);
    if (question.trainingItemId === missed.trainingItemId) repeated = true;
    recordTrainingResult(session, question, true);
  }
  assert.equal(repeated, true);
  assert.equal(session.mastered, 7);
  assert.equal(session.attempts, 8);
  assert.equal(createTrainingQuestion(defaults, session), null);
});

test('B-flat notation changes labels without changing sounding notes', () => {
  const settings = { ...defaults, instrument: 'trumpet', trumpetNotation: 'bb' };
  const session = createTrainingSession(settings);
  assert.equal(session.rootMidi, 58);
  session.queue = [session.items[0]];
  const written = createTrainingQuestion(settings, session);
  assert.equal(written.correctAnswer.label, 'C4');
  const concert = relabelQuestion(written, { ...settings, trumpetNotation: 'concert' });
  assert.equal(concert.correctAnswer.label, 'Bb3');
  assert.deepEqual(concert.playbackNotes, written.playbackNotes);
  assert.equal(concert.correctAnswer.id, written.correctAnswer.id);
});

test('all keys and modes generate playable sets for both instruments and notations', () => {
  for (const instrument of ['piano', 'trumpet']) {
    for (const notation of ['bb', 'concert']) {
      for (const mode of ['note', 'scale', 'chord']) {
        for (const difficulty of ['easy', 'medium', 'hard']) {
          for (let trainingRoot = 0; trainingRoot < 12; trainingRoot += 1) {
            for (const trainingScale of ['major', 'naturalMinor', 'harmonicMinor', 'melodicMinor']) {
              const settings = { ...defaults, instrument, mode, difficulty, trainingRoot, trainingScale, pianoNotation: notation, trumpetNotation: notation, scaleDirection: 'random' };
              const session = createTrainingSession(settings);
              assert.equal(session.total, mode === 'note' ? 7 : 4);
              while (session.queue.length) {
                const originalRandom = Math.random;
                let question;
                try {
                  for (const randomValue of [0, 0.5, 0.999]) {
                    Math.random = () => randomValue;
                    question = createTrainingQuestion(settings, session);
                    assert.equal(question.answerOptions.length, 3);
                    assert.ok(question.playbackNotes.length > 0);
                    assert.ok(question.playbackNotes.every((midi) => hasConfiguredSampleMapping(instrument, midi)));
                    assert.ok(checkAnswer(question, question.answerOptions.find((option) => option.id === question.correctAnswer.id)));
                    assert.ok(question.answerOptions.every((option) => !option.label.includes('Unknown')));
                  }
                } finally { Math.random = originalRandom; }
                recordTrainingResult(session, question, true);
              }
              assert.equal(session.mastered, session.total);
            }
          }
        }
      }
    }
  }
});

test('existing saved data retains statistics and gains practice defaults', () => {
  const data = validateData({ version: 1, settings: { instrument: 'trumpet' }, statistics: { totalQuestions: 3 } });
  assert.equal(data.settings.trainingRoot, 0);
  assert.equal(data.settings.trainingScale, 'major');
  assert.equal(data.settings.trumpetNotation, 'bb');
  assert.equal(data.statistics.totalQuestions, 3);
  assert.equal(parseImport(JSON.stringify(createExport(data))).settings.trainingScale, 'major');
});