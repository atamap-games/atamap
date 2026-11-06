// 部屋（各自のスマホで遊ぶとき）のデータの形と、その手伝い。画面の部品は使わない。
//
// rooms/{部屋の番号}
//   meta    : { hostUid, createdAt, status: 'lobby'|'playing'|'closed', timeLimit }   … ホストだけが書く
//   players : { [uid]: { name, joinedAt, online } }                                    … 本人が書く
//   state   : { phase, order, mains, roundIndex, mainUid, wordIndex, deadline, gameNo } … ホストだけが書く
//             phase は 'make' → 'round' → 'guess' → 'reveal' → 'summary' →（次の主役）… → 'end'
//   topics  : { [uid]: お題の id }                                                     … ホストが配り、引き直しは本人が書く
//   maps    : { [uid]: { topicId, rerolled, timeUp, done, placements } }               … 本人が書く
//   guesses : { [主役の uid]: { [uid]: { done, timeUp, placements } } }                … 本人が書く
//
// placements は [{ w: ワード, x, y }]。置いていないワードは x と y を入れない。

import { PLAYER_COLORS, MIN_PLAYERS, MAX_PLAYERS } from './game.js';

export { MIN_PLAYERS, MAX_PLAYERS };

// 部屋の番号に使う文字（見まちがえやすい 0・O・1・I は使わない）
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

/** 部屋の番号をひとつ作る */
export function makeCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return code;
}

/** 入力された部屋の番号を整える（小文字は大文字に、空白はとる）。形がおかしければ空文字 */
export function normalizeCode(text) {
  const code = String(text ?? '').toUpperCase().replace(/\s/g, '');
  return new RegExp(`^[${CODE_CHARS}]{${CODE_LENGTH}}$`).test(code) ? code : '';
}

/** ワードの置き場所を、保存する形にする */
export function encodePlacements(placements) {
  return placements.map(({ word, pos }) => (pos ? { w: word, x: pos.x, y: pos.y } : { w: word }));
}

/** 保存した形から、ワードの置き場所に戻す */
export function decodePlacements(saved) {
  const list = Array.isArray(saved) ? saved : Object.values(saved ?? {});
  return list.map((p) => ({ word: p.w, pos: typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null }));
}

/** 部屋に入っている人を、入った順に並べる */
export function playersInOrder(room) {
  return Object.entries(room?.players ?? {})
    .map(([uid, p]) => ({ uid, ...p }))
    .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
}

/**
 * 部屋のデータを、点数の計算や答え合わせの画面で使うゲームの形（game.js と同じ形）にする。
 * プレイヤーの順番と色は、ゲームを始めたときの順番（state.order）で決まる。
 */
export function toGame(room) {
  const order = room?.state?.order ?? playersInOrder(room).map((p) => p.uid);
  const players = order.map((uid, index) => ({
    id: uid,
    name: room.players?.[uid]?.name ?? '（退出）',
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
  }));
  const maps = {};
  for (const [uid, map] of Object.entries(room?.maps ?? {})) {
    if (map?.done) maps[uid] = { topicId: map.topicId, placements: decodePlacements(map.placements), rerolled: Boolean(map.rerolled) };
  }
  const guesses = {};
  for (const [mainId, byGuesser] of Object.entries(room?.guesses ?? {})) {
    guesses[mainId] = {};
    for (const [uid, guess] of Object.entries(byGuesser ?? {})) {
      if (guess?.done) guesses[mainId][uid] = decodePlacements(guess.placements);
    }
  }
  // 主役にならなかった人（マップを作らなかった人）は、主役の順番から外す
  const mains = room?.state?.mains ?? order;
  return { players, maps, guesses, timeLimit: room?.meta?.timeLimit ?? 0, mains };
}

/**
 * ゲームのはじめに、全員にちがうお題を配る。
 * @returns {Record<string, number>} uid → お題の id
 */
export function dealTopics(uids, topics, random = Math.random) {
  const pool = [...topics];
  const result = {};
  for (const uid of uids) {
    const index = Math.floor(random() * pool.length);
    result[uid] = pool.splice(index, 1)[0].id;
  }
  return result;
}

/** 引き直しで選ぶお題（ほかの人のお題と、今のお題は選ばない） */
export function pickRerollTopic(room, uid, topics, random = Math.random) {
  const used = new Set(Object.values(room?.topics ?? {}));
  const candidates = topics.filter((t) => !used.has(t.id));
  const pool = candidates.length ? candidates : topics.filter((t) => t.id !== room?.topics?.[uid]);
  return pool[Math.floor(random() * pool.length)];
}

/** 予想する人（主役以外の、ゲームに参加している人） */
export function guessersOf(room, mainUid) {
  return (room?.state?.order ?? []).filter((uid) => uid !== mainUid);
}
