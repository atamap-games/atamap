// 点数の決め方。マップは縦横 0〜100 として、主役のピンと予想のピンの距離だけで決める。
// 距離 10 以内なら 3点（ど真ん中）、20 以内なら 1点（近い）、それより遠ければ 0点（はずれ）。
// 主役は、自分が主役のラウンドでは点をもらわない（予想しないので）。
import { guessersFor } from './game.js';

export const NEAR = 10;
export const CLOSE = 20;

/** 2つの場所の距離（どちらかが無いときは null） */
export function distance(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 距離から点数を決める（置いていないときは 0点） */
export function pointsFor(dist) {
  if (dist === null || dist === undefined) return 0;
  if (dist <= NEAR) return 3;
  if (dist <= CLOSE) return 1;
  return 0;
}

/** 点数の呼び名 */
export function gradeName(points) {
  return points === 3 ? 'ど真ん中' : points === 1 ? '近い' : 'はずれ';
}

/**
 * 1つのワードの答え合わせ。
 * @returns {{ word: string, answer: object, results: { playerId: string, pos: object, distance: number|null, points: number }[] }}
 */
export function wordResult(game, mainId, word) {
  const answer = game.maps[mainId]?.placements.find((p) => p.word === word)?.pos ?? null;
  const guesses = game.guesses[mainId] ?? {};
  const results = guessersFor(game, mainId).map((player) => {
    const pos = guesses[player.id]?.find((p) => p.word === word)?.pos ?? null;
    const dist = distance(answer, pos);
    return { playerId: player.id, pos, distance: dist, points: pointsFor(dist) };
  });
  return { word, answer, results };
}

/** 主役1人ぶん（1ラウンド）の、予想した人ごとの合計点 */
export function roundPoints(game, mainId) {
  const words = game.maps[mainId]?.placements.map((p) => p.word) ?? [];
  const totals = Object.fromEntries(guessersFor(game, mainId).map((p) => [p.id, 0]));
  for (const word of words) {
    for (const r of wordResult(game, mainId, word).results) totals[r.playerId] += r.points;
  }
  return totals;
}

/** 1ラウンドで、主役の答えとみんなの予想がいちばん離れたワード（距離の平均） */
export function biggestMiss(game, mainId) {
  const words = game.maps[mainId]?.placements.map((p) => p.word) ?? [];
  let best = null;
  for (const word of words) {
    const dists = wordResult(game, mainId, word).results.map((r) => r.distance ?? 100);
    const average = dists.reduce((a, b) => a + b, 0) / Math.max(dists.length, 1);
    if (!best || average > best.average) best = { word, average };
  }
  return best;
}

/** ゲーム全体の合計点（予想で取った点の合計） */
export function totalPoints(game) {
  const totals = Object.fromEntries(game.players.map((p) => [p.id, 0]));
  for (const main of game.players) {
    if (!game.maps[main.id] || !game.guesses[main.id]) continue;
    for (const [id, points] of Object.entries(roundPoints(game, main.id))) totals[id] += points;
  }
  return totals;
}
