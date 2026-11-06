// ワードごとの置き場所の記録と、「全員がほぼ同じ場所に置いたワード」探し（お題の入れ替えに使う）。
//
// stats/{お題の id}/{自動の番号} = { p: [[x, y], ...（お題のワードの順に5つ）], at: 記録した時刻 }
// 記録するのは「自分のマップ」（主役の答え）だけ。時間切れで真ん中に置いたことになったマップは、本当の置き場所ではないので記録しない。

// この枚数より少ないお題は、まだ調べない
export const MIN_MAPS = 3;
// 全員の置き場所が、まとまりの中心からこの距離の中に入っていたら「ほぼ同じ場所」とする
export const SAME_RADIUS = 15;

/**
 * ゲームのマップを記録する。
 * @param {object} net net.js の connect() で得たもの
 * @param {{ topicId: number, placements: object[], timeUp?: boolean }[]} maps 自分のマップの一覧
 * @param {object[]} topics お題の一覧
 */
export async function recordMaps(net, maps, topics) {
  const writes = [];
  for (const map of maps) {
    if (map.timeUp) continue;
    const topic = topics.find((t) => t.id === map.topicId);
    if (!topic) continue;
    const p = topic.words.map((word) => {
      const pos = map.placements.find((x) => x.word === word)?.pos;
      return pos ? [round1(pos.x), round1(pos.y)] : null;
    });
    if (p.some((xy) => !xy)) continue;
    writes.push(net.push(`stats/${topic.id}`, { p, at: net.serverTime() }));
  }
  await Promise.all(writes);
  return writes.length;
}

/**
 * 記録から、全員がほぼ同じ場所に置いたワードを探す。
 * @param {object|null} stats Firebase の stats の中身
 * @param {object[]} topics お題の一覧
 * @returns {{ maps: number, topics: number, checked: number, found: object[] }}
 *   found は { topic, word, count, spread（中心からいちばん遠い点までの距離）, center } の一覧（spread の小さい順）
 */
export function findSameSpots(stats, topics, { minMaps = MIN_MAPS, radius = SAME_RADIUS } = {}) {
  let maps = 0;
  let topicCount = 0;
  let checked = 0;
  const found = [];
  for (const [topicId, entries] of Object.entries(stats ?? {})) {
    const topic = topics.find((t) => String(t.id) === topicId);
    const records = Object.values(entries ?? {}).map((e) => toPoints(e?.p)).filter((p) => p.length === 5);
    if (!topic || !records.length) continue;
    maps += records.length;
    topicCount += 1;
    if (records.length < minMaps) continue;
    checked += 1;
    topic.words.forEach((word, i) => {
      const points = records.map((r) => r[i]);
      const center = {
        x: points.reduce((sum, pt) => sum + pt.x, 0) / points.length,
        y: points.reduce((sum, pt) => sum + pt.y, 0) / points.length,
      };
      const spread = Math.max(...points.map((pt) => Math.hypot(pt.x - center.x, pt.y - center.y)));
      if (spread <= radius) found.push({ topic, word, count: points.length, spread, center });
    });
  }
  found.sort((a, b) => a.spread - b.spread);
  return { maps, topics: topicCount, checked, found };
}

function toPoints(p) {
  const list = Array.isArray(p) ? p : Object.values(p ?? {});
  return list
    .map((xy) => (Array.isArray(xy) ? xy : Object.values(xy ?? {})))
    .filter((xy) => xy.length === 2 && xy.every((v) => typeof v === 'number'))
    .map(([x, y]) => ({ x, y }));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
