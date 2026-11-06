// オリジナルのお題（自分たちで作るお題）。
// ・形は data/topics.json のお題と同じ（title・axes・words）。id は「c」で始まる文字、custom: true が付く
// ・「マイお題」：ホストや1台で遊ぶ人が、前もって作ってこのスマホに保存しておくお題
// ・軸は、用意した軸からえらぶか、自由に書く

// 文字数の上限（マップや札からはみ出さないように）
export const TITLE_MAX = 12;
export const AXIS_MAX = 6;
export const WORD_MAX = 8;
export const WORD_COUNT = 5;
// マイお題をいくつまで保存するか
export const MY_TOPICS_MAX = 30;

// 用意した軸。縦は「気持ち」、横は「その人の経験」（常識で場所が決まらないように。仕様書の「お題を入れる前の4つのチェック」）
export const AXIS_PRESETS = {
  vertical: [
    ['好き', '苦手'],
    ['やりたい', 'やりたくない'],
    ['欲しい', 'いらない'],
    ['行きたい', '行きたくない'],
    ['食べたい', '食べたくない'],
    ['見たい', '見たくない'],
    ['楽しい', 'めんどう'],
    ['うれしい', 'うれしくない'],
  ],
  horizontal: [
    ['よくやる', 'やらない'],
    ['最近やった', 'やってない'],
    ['最近食べた', '食べてない'],
    ['よく使う', '使わない'],
    ['よく買う', '買わない'],
    ['自分でできる', 'できない'],
    ['経験あり', '経験なし'],
    ['持ってる', '持ってない'],
  ],
};

const MY_KEY = 'atamap.myTopics';

/**
 * 入れた文字から、オリジナルのお題を作る（足りない・長すぎるときは、まちがいの文を返す）。
 * @param {{ title: string, axes: { top: string, bottom: string, left: string, right: string }, words: string[] }} input
 * @param {string} [id] お題の id（なければ新しく作る）
 * @returns {{ topic: object|null, error: string }}
 */
export function buildTopic(input, id = '') {
  const clean = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const title = clean(input.title, TITLE_MAX);
  const axes = {
    top: clean(input.axes?.top, AXIS_MAX),
    bottom: clean(input.axes?.bottom, AXIS_MAX),
    left: clean(input.axes?.left, AXIS_MAX),
    right: clean(input.axes?.right, AXIS_MAX),
  };
  const words = (input.words ?? []).map((w) => clean(w, WORD_MAX));
  if (!title) return { topic: null, error: 'お題の名前を入れてね' };
  if (!axes.top || !axes.bottom) return { topic: null, error: '縦の軸（上と下）を入れてね' };
  if (!axes.left || !axes.right) return { topic: null, error: '横の軸（左と右）を入れてね' };
  const filled = words.filter(Boolean);
  if (filled.length < WORD_COUNT) return { topic: null, error: `ワードをあと${WORD_COUNT - filled.length}つ入れてね` };
  if (new Set(filled).size < filled.length) return { topic: null, error: '同じワードが2つあります' };
  return {
    topic: { id: id || newId(), genre: 'オリジナル', title, axes, words: filled.slice(0, WORD_COUNT), custom: true },
    error: '',
  };
}

/** オリジナルのお題として正しい形か（部屋のデータから読んだときに確かめる） */
export function isCustomTopic(topic) {
  if (!topic || typeof topic !== 'object') return false;
  const { topic: built } = buildTopic(topic, String(topic.id ?? ''));
  return Boolean(built && built.id);
}

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- マイお題（このスマホに保存） ----------

/** 保存してあるマイお題（{ topic, use } の一覧。use は「次のゲームで使う」） */
export function loadMyTopics() {
  try {
    const list = JSON.parse(localStorage.getItem(MY_KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => ({ topic: buildTopic(item?.topic ?? {}, String(item?.topic?.id ?? '')).topic, use: item?.use !== false }))
      .filter((item) => item.topic)
      .slice(0, MY_TOPICS_MAX);
  } catch {
    return [];
  }
}

/** マイお題を保存する */
export function saveMyTopics(list) {
  try {
    localStorage.setItem(MY_KEY, JSON.stringify(list.slice(0, MY_TOPICS_MAX)));
    return true;
  } catch {
    return false;
  }
}

/** 次のゲームで使うマイお題（えらんであるもの） */
export function chosenMyTopics() {
  return loadMyTopics().filter((item) => item.use).map((item) => item.topic);
}

// ---------- 配り方 ----------

/**
 * 「みんなで作る」で、だれのお題をだれに配るか決める。自分で作ったお題は、自分には配らない。
 * @param {string[]} players 主役になる順の、遊ぶ人の id
 * @param {Record<string, object>} made 作った人の id → 作ったお題（作らなかった人はなし）
 * @param {() => number} [random]
 * @returns {Record<string, object|null>} 主役の id → 配るお題（足りないときは null。いつものお題で補う）
 */
export function assignMadeTopics(players, made, random = Math.random) {
  const makers = players.filter((id) => made[id]);
  let best = null;
  // 自分のお題が自分に当たらない並べ方を、何回かためして探す（人数が少ないので、すぐ見つかる）
  for (let tries = 0; tries < 200; tries++) {
    const pool = shuffle(makers, random);
    const result = {};
    let clash = 0;
    for (const id of players) {
      const index = pool.findIndex((maker) => maker !== id);
      if (index < 0) {
        result[id] = null;
        if (pool.length) clash += 1;
        continue;
      }
      result[id] = made[pool.splice(index, 1)[0]];
    }
    if (!best || clash < best.clash) best = { result, clash };
    if (clash === 0) break;
  }
  return best?.result ?? {};
}

export function shuffle(list, random = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
