// お題（data/topics.json）を読み込む部品

// このファイルの場所から data/topics.json の場所を決める（GitHub Pages でも同じように動く）
const TOPICS_URL = new URL('../data/topics.json', import.meta.url);

let cache = null;

/**
 * お題をすべて読み込む。2回目からは読み込み済みのものを返す。
 * 1つのお題の形：
 *   { id, genre, title,
 *     axes: { top, bottom, left, right },  // 縦の上・下、横の左・右の言葉
 *     words: [ワード5つ] }
 * @returns {Promise<Array>} お題の一覧
 */
export async function loadTopics() {
  if (cache) return cache;

  const response = await fetch(TOPICS_URL);
  if (!response.ok) {
    throw new Error(`お題を読み込めませんでした（${response.status}）`);
  }
  const data = await response.json();
  const topics = data.topics.filter(isValidTopic);
  if (topics.length !== data.topics.length) {
    console.warn(`形がおかしいお題を ${data.topics.length - topics.length} 個とばしました`);
  }
  cache = topics;
  return topics;
}

// お題の形が正しいかを確かめる（軸の言葉が4つと、ちがうワードが5つ）
function isValidTopic(topic) {
  const axes = topic?.axes;
  const words = topic?.words;
  return Boolean(
    topic.title &&
    axes && ['top', 'bottom', 'left', 'right'].every((key) => typeof axes[key] === 'string' && axes[key]) &&
    Array.isArray(words) && words.length === 5 && new Set(words).size === 5,
  );
}
