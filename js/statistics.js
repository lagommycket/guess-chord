import { defaultStatistics } from './storage.js';

export function getAccuracy(statistics) {
  return statistics.totalQuestions === 0 ? 0 : (statistics.correctAnswers / statistics.totalQuestions) * 100;
}

export function recordAnswer(statistics, question, selectedAnswer, correct) {
  const next = structuredClone(statistics ?? defaultStatistics());
  next.totalQuestions += 1;
  next.byMode[question.mode].attempts += 1;
  if (correct) {
    next.correctAnswers += 1;
    next.byMode[question.mode].correct += 1;
    next.currentStreak += 1;
    next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
  } else {
    next.wrongAnswers += 1;
    next.currentStreak = 0;
    const buckets = question.mode === 'note' ? next.errorsByNote : question.mode === 'scale' ? next.errorsByScale : next.errorsByChord;
    const key = String(question.metadata?.label ?? question.correctAnswer.label ?? 'Unbekannt');
    buckets[key] = (buckets[key] ?? 0) + 1;
    next.errorsByInstrument[question.instrument] = (next.errorsByInstrument[question.instrument] ?? 0) + 1;
    next.errorsByDifficulty[question.difficulty] = (next.errorsByDifficulty[question.difficulty] ?? 0) + 1;
    void selectedAnswer;
  }
  next.lastUsed = new Date().toISOString();
  return next;
}

export function formatAccuracy(statistics) { return `${Math.round(getAccuracy(statistics))}%`; }