// 配信で遊ぶ（見ている人が参加する）ときのデータの形と、点数・順位の計算。画面の部品は使わない。
//
// 配信者がずっと主役。見ている人は、自分のスマホで「配信者ならココらへん」とピンを置く。
// 人数が多くても動くように、見ている人のスマホは、部屋のデータのうち meta・state・自分の分だけを見る。
//
// rooms/{部屋の番号}
//   meta     : { hostUid, createdAt, status, timeLimit, topicMode, type: 'stream', streamer: 配信者の名前 }   … 配信者だけが書く
//   players  : { [配信者の uid]: { name, joinedAt, online } }                       … 配信者だけ
//   viewers  : { [uid]: { name, joinedAt, online } }                                … 見ている人が自分で書く（配信者は外せる）
//   state    : { phase, gameNo, roundNo, wordIndex, answerShown, deadline, closedAt, topic, used }  … 配信者だけが書く
//              phase は 'make'（配信者が置く）→ 'guess'（みんなが予想）→ 'reveal'（答え合わせ）→ 'summary'（このお題の結果）
//              →（次のお題）… → 'end'（ランキング）
//              topic はお題そのもの（見ている人のスマホが、お題の表を読まなくてよいように）
//   maps     : { [配信者の uid]: { gameNo, roundNo, placements, done } }             … 配信者の答え
//   vguesses : { [uid]: { gameNo, roundNo, at, placements } }                            … 見ている人の予想（お題ごとに上書き）
//   scores   : { [uid]: { key, total, round, rank, of } }                           … 配信者がお題の結果で書く
//   custom   : { [お題の id]: お題 }                                                  … 配信者のマイお題
//   kicked   : { [uid]: true }                                                       … 配信者が外した人（もう入れない）
//   meta.hideCode : true のとき、配信用の画面に部屋の番号とQRコードを映さない
import { distance, pointsFor } from './score.js';

// 見ている人の数の上限（Firebase の無料プランは、同時につなげるのが100人まで。配信者の2画面と、ゆとりを引いた数）
export const STREAM_MAX_VIEWERS = 90;
// 配信者の色・見ている人の色
export const STREAMER_COLOR = '#E5007F';
export const VIEWER_COLOR = '#0B7285';

/** 配信用の部屋か */
export function isStreamRoom(meta) {
  return meta?.type === 'stream';
}

/** 今つながっている、見ている人（入った順） */
export function onlineViewers(room) {
  return Object.entries(room?.viewers ?? {})
    .filter(([, v]) => v && v.online !== false)
    .map(([uid, v]) => ({ uid, ...v }))
    .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
}

/** 今のお題を見分ける文字 */
export function roundKey(state) {
  return `${state?.gameNo ?? 0}:${state?.roundNo ?? 0}`;
}

/** 今のお題の、配信者の答え（なければ null） */
export function streamerAnswer(room) {
  const s = room?.state ?? {};
  const map = room?.maps?.[room?.meta?.hostUid];
  if (!map?.done || map.gameNo !== s.gameNo || map.roundNo !== s.roundNo) return null;
  return map.placements ?? [];
}

/** 今のお題の、見ている人の予想（{ uid, name, placements }） */
export function currentGuesses(room) {
  const s = room?.state ?? {};
  return Object.entries(room?.vguesses ?? {})
    // 締め切ったあとに届いた予想は入れない（配信用の画面と点数がずれないように）
    .filter(([, g]) => g && g.gameNo === s.gameNo && g.roundNo === s.roundNo && !(s.closedAt && g.at > s.closedAt))
    .map(([uid, g]) => ({ uid, name: room.viewers?.[uid]?.name ?? '？', placements: listOf(g.placements) }));
}

function listOf(saved) {
  return Array.isArray(saved) ? saved : Object.values(saved ?? {});
}

function posOf(placements, word) {
  const p = listOf(placements).find((item) => item?.w === word);
  return p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null;
}

/**
 * 1つのワードの答え合わせ。
 * @returns {{ answer: object|null, results: { uid: string, name: string, pos: object|null, distance: number|null, points: number }[], near: number, close: number, miss: number }}
 */
export function streamWordResult(answerPlacements, guesses, word) {
  const answer = posOf(answerPlacements, word);
  const results = guesses.map((g) => {
    const pos = posOf(g.placements, word);
    const d = distance(answer, pos);
    return { uid: g.uid, name: g.name, pos, distance: d, points: pointsFor(d) };
  });
  return {
    answer,
    results,
    near: results.filter((r) => r.points === 3).length,
    close: results.filter((r) => r.points === 1).length,
    miss: results.filter((r) => r.points === 0).length,
  };
}

/** このお題で、見ている人それぞれが取った点（{ uid: 点 }） */
export function streamRoundPoints(answerPlacements, guesses, words) {
  const totals = Object.fromEntries(guesses.map((g) => [g.uid, 0]));
  for (const word of words) {
    for (const r of streamWordResult(answerPlacements, guesses, word).results) totals[r.uid] += r.points;
  }
  return totals;
}

/**
 * 点の高い順に並べて、順位を付ける（同じ点は同じ順位）。
 * @param {{ uid: string, name: string, total: number }[]} list
 * @returns {{ uid: string, name: string, total: number, rank: number }[]}
 */
export function rankByTotal(list, key = 'total') {
  const sorted = [...list].sort((a, b) => b[key] - a[key] || (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
  let rank = 0;
  let last = null;
  return sorted.map((item, i) => {
    if (item[key] !== last) {
      rank = i + 1;
      last = item[key];
    }
    return { ...item, rank };
  });
}

/**
 * お題の結果を出すときに、配信者が書く点数（scores）を作る。
 * これまでの合計に、このお題の点を足す。このお題で予想しなかった人も、これまでの点があれば順位に入れる。
 * @returns {object} scores/{uid} に書く値
 */
export function nextScores(room) {
  const s = room.state ?? {};
  const key = roundKey(s);
  const words = s.topic?.words ?? [];
  const answer = streamerAnswer(room) ?? [];
  const points = streamRoundPoints(answer, currentGuesses(room), words);
  const before = room.scores ?? {};
  const uids = new Set([...Object.keys(points), ...Object.keys(before).filter((uid) => before[uid]?.game === s.gameNo)]);
  const list = [...uids].map((uid) => {
    const old = before[uid]?.game === s.gameNo ? before[uid] : null;
    // もう同じお題の点を足していたら（配信者が開き直したときなど）、足し直さない
    const base = old?.key === key ? old.total - old.round : old?.total ?? 0;
    const round = points[uid] ?? 0;
    return { uid, total: base + round, round, joinedAt: room.viewers?.[uid]?.joinedAt ?? 0 };
  });
  const ranked = rankByTotal(list);
  const values = {};
  for (const r of ranked) values[r.uid] = { key, game: s.gameNo, total: r.total, round: r.round, rank: r.rank, of: ranked.length };
  return values;
}

/** ランキングの表（名前つき。点の高い順） */
export function rankingOf(room) {
  const s = room?.state ?? {};
  const list = Object.entries(room?.scores ?? {})
    .filter(([, v]) => v && v.game === s.gameNo)
    .map(([uid, v]) => ({ uid, name: room.viewers?.[uid]?.name ?? '？', total: v.total, round: v.round, rank: v.rank }));
  return list.sort((a, b) => a.rank - b.rank || b.round - a.round);
}

/** このお題のランキング（このお題で取った点の高い順） */
export function roundRankingOf(room) {
  return rankByTotal(rankingOf(room), 'round');
}

/**
 * 次のお題を選ぶ。マイお題（custom）でまだ使っていないものがあれば、それから。なければ、いつものお題でまだ使っていないもの。
 * @param {object[]} topics いつものお題
 * @param {object[]} mine マイお題（配信者が選んだもの）
 * @param {Array<number|string>} used このゲームで使ったお題の id
 */
export function pickStreamTopic(topics, mine, used, random = Math.random) {
  const usedSet = new Set(used ?? []);
  const freshMine = mine.filter((t) => !usedSet.has(t.id));
  if (freshMine.length) return freshMine[Math.floor(random() * freshMine.length)];
  const fresh = topics.filter((t) => !usedSet.has(t.id));
  const pool = fresh.length ? fresh : topics;
  return pool[Math.floor(random() * pool.length)];
}
