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

/** 主役のとき、ほかの人がその人のマップで取れた点の合計（低いほど読まれにくい） */
export function pointsGivenAsMain(game) {
  const result = {};
  for (const main of game.players) {
    if (!game.maps[main.id] || !game.guesses[main.id]) continue;
    result[main.id] = Object.values(roundPoints(game, main.id)).reduce((a, b) => a + b, 0);
  }
  return result;
}

/** A が B のマップを予想して取った点（B が主役のラウンドでの A の点） */
export function pointsGuessing(game, guesserId, mainId) {
  if (!game.maps[mainId] || !game.guesses[mainId]) return 0;
  return roundPoints(game, mainId)[guesserId] ?? 0;
}

/**
 * 最後の表彰。同じ点ならどちらも受賞。
 * - 以心伝心王：予想の合計点がいちばん高い人
 * - ミステリアス賞：主役のとき、みんなの点がいちばん低かった人（いちばん読めない人）
 * - ベストペア：A が B を当てた点と B が A を当てた点の合計がいちばん高い2人
 * - 今日のズレ大賞：主役の答えとみんなの予想がいちばん離れたワード（距離の平均）
 */
export function awards(game) {
  const totals = totalPoints(game);
  const topTotal = Math.max(...Object.values(totals));
  const telepathy = { playerIds: Object.keys(totals).filter((id) => totals[id] === topTotal), points: topTotal };

  const given = pointsGivenAsMain(game);
  const lowGiven = Math.min(...Object.values(given));
  const mysterious = { playerIds: Object.keys(given).filter((id) => given[id] === lowGiven), points: lowGiven };

  const pairs = [];
  for (let i = 0; i < game.players.length; i++) {
    for (let j = i + 1; j < game.players.length; j++) {
      const a = game.players[i].id;
      const b = game.players[j].id;
      pairs.push({ playerIds: [a, b], points: pointsGuessing(game, a, b) + pointsGuessing(game, b, a) });
    }
  }
  const topPair = Math.max(...pairs.map((p) => p.points));
  const bestPair = { pairs: pairs.filter((p) => p.points === topPair).map((p) => p.playerIds), points: topPair };

  let zure = null;
  for (const main of game.players) {
    if (!game.maps[main.id] || !game.guesses[main.id]) continue;
    const miss = biggestMiss(game, main.id);
    if (miss && (!zure || miss.average > zure.average)) zure = { mainId: main.id, word: miss.word, average: miss.average };
  }

  return { telepathy, mysterious, bestPair, zure };
}
