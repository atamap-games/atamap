// 1回のゲームの中身（だれが、どのお題で、どこに置いたか）。画面の部品は使わない。
// あとでスマホ同士をつなぐときも、この形のまま Firebase に入れられるようにしておく。

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const NAME_MAX = 8;
// マップ作りと予想の制限時間（秒）。仮の値で、試遊で決め直す
export const TIME_LIMIT = 90;

// プレイヤーごとの色（白い地の上で見分けやすいもの）
export const PLAYER_COLORS = ['#2F6FDB', '#1E8F55', '#C2410C', '#7C3AED', '#DB2777', '#0E7490', '#A16207', '#4B5563'];

/**
 * 新しいゲームを作る。
 * @param {string[]} names 遊ぶ人の名前（この順番で主役を回す）
 * @param {object} [options]
 * @param {number} [options.timeLimit] 制限時間（秒）。0 なら制限なし
 */
export function createGame(names, { timeLimit = TIME_LIMIT } = {}) {
  return {
    timeLimit,
    players: names.map((name, index) => ({ id: `p${index + 1}`, name, color: PLAYER_COLORS[index % PLAYER_COLORS.length] })),
    // プレイヤーの id → { topicId, placements: [{ word, pos }], rerolled }
    maps: {},
    // 主役の id → { 予想した人の id → [{ word, pos }] }
    guesses: {},
  };
}

/** id からプレイヤーを探す */
export function playerById(game, id) {
  return game.players.find((p) => p.id === id);
}

/** ほかの人がもう使っているお題の id */
export function usedTopicIds(game, exceptPlayerId) {
  return Object.entries(game.maps)
    .filter(([playerId]) => playerId !== exceptPlayerId)
    .map(([, map]) => map.topicId);
}

/**
 * まだだれも使っていないお題を1つ選ぶ。
 * @param {object} game ゲーム
 * @param {object[]} topics お題の一覧
 * @param {number[]} [alsoExclude] ほかに選ばないお題の id
 * @param {() => number} [random] 0以上1未満の数を返す関数
 */
export function dealTopic(game, topics, alsoExclude = [], random = Math.random) {
  const used = new Set([...usedTopicIds(game), ...alsoExclude]);
  const candidates = topics.filter((t) => !used.has(t.id));
  const pool = candidates.length ? candidates : topics;
  return pool[Math.floor(random() * pool.length)];
}

/** 自分のマップ（主役のときの答え）を入れる */
export function setMap(game, playerId, { topicId, placements, rerolled = false, timeUp = false }) {
  game.maps[playerId] = { topicId, placements: placements.map(copyPlacement), rerolled, timeUp };
}

/** 主役のマップを予想する人の一覧（主役の次の人から順に） */
export function guessersFor(game, mainId) {
  const index = game.players.findIndex((p) => p.id === mainId);
  return [...game.players.slice(index + 1), ...game.players.slice(0, index)];
}

/** 予想を入れる */
export function setGuess(game, mainId, guesserId, placements) {
  game.guesses[mainId] ??= {};
  game.guesses[mainId][guesserId] = placements.map(copyPlacement);
}

function copyPlacement({ word, pos }) {
  return { word, pos: pos ? { x: pos.x, y: pos.y } : null };
}
