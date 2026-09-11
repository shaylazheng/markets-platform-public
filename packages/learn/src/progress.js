/* Quiz progress lives in localStorage: a rolling history of scores plus the
   topics the model flagged for review. Both are seeded back into the next quiz. */
const QUIZ_KEY = 'quiz-progress-v1', REVIEW_KEY = 'quiz-review-v1';

const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const loadResults = () => { try { return JSON.parse(localStorage.getItem(QUIZ_KEY)) || []; } catch { return []; } };
export const loadReviewTopics = () => { try { return JSON.parse(localStorage.getItem(REVIEW_KEY)) || []; } catch { return []; } };

export function saveResult(score, total) {
  const r = loadResults();
  r.push({ date: dayStr(new Date()), score, total });
  localStorage.setItem(QUIZ_KEY, JSON.stringify(r.slice(-60)));
}
export function saveReviewTopics(topics) {
  const cur = new Set(loadReviewTopics());
  topics.forEach((t) => cur.add(t));
  localStorage.setItem(REVIEW_KEY, JSON.stringify([...cur].slice(-12)));
}

/* Consecutive days with a quiz, counting back from today or yesterday. */
export function currentStreak(results = loadResults()) {
  const days = new Set(results.map((r) => r.date));
  if (!days.size) return 0;
  const d = new Date();
  if (!days.has(dayStr(d))) {
    d.setDate(d.getDate() - 1);
    if (!days.has(dayStr(d))) return 0;
  }
  let n = 0;
  while (days.has(dayStr(d))) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}

/* The quiz prompt ends its wrap-up with SCORE: / REVIEW_TOPICS: markers. Pull
   them out, persist them, and strip them before the text is shown. */
export function absorbMarkers(content) {
  const scoreM = content.match(/SCORE:\s*(\d+)\s*\/\s*(\d+)/i);
  const revM = content.match(/REVIEW_TOPICS:\s*(.+)/i);
  if (scoreM) saveResult(parseInt(scoreM[1], 10), parseInt(scoreM[2], 10));
  if (revM) saveReviewTopics(revM[1].split(/[;,]/).map((t) => t.trim()).filter(Boolean));
  return {
    text: content.replace(/^\s*SCORE:.*$/im, '').replace(/^\s*REVIEW_TOPICS:.*$/im, '').trim(),
    changed: Boolean(scoreM || revM),
  };
}
