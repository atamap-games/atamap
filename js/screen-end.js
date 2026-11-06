// 最終結果。4つの賞と、予想で取った点の合計の順位を出す。
import { showScreen, el } from './ui.js';
import { totalPoints, awards } from './score.js';
import { playerById } from './game.js';

const screen = document.querySelector('[data-screen="end"]');
const part = (name) => screen.querySelector(`[data-end="${name}"]`);

let resolveCurrent = null;

/**
 * @param {object} options
 * @param {object} options.game ゲーム
 * @returns {Promise<'again'|'home'>} 次にすること
 */
export function showEnd({ game }) {
  const totals = totalPoints(game);
  const sorted = [...game.players].sort((a, b) => totals[b.id] - totals[a.id]);
  // 同じ点なら同じ順位
  let rank = 0;
  let last = null;
  const rows = sorted.map((player, index) => {
    if (totals[player.id] !== last) {
      rank = index + 1;
      last = totals[player.id];
    }
    const row = el('li', `rank-row${rank === 1 ? ' rank-row--top' : ''}`);
    row.style.setProperty('--player-color', player.color);
    row.append(el('span', 'rank-row__rank', `${rank}位`), el('span', 'rank-row__name', player.name), el('span', 'rank-row__points', `${totals[player.id]}点`));
    return row;
  });
  const list = el('ol', `ranking${rows.length > 3 ? ' ranking--two' : ''}`);
  list.append(...rows);
  part('body').replaceChildren(renderAwards(game), list);
  showScreen('end');
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}

// 受賞した人の名前。3人以上が同点なら「〇人が同点」とまとめる
function winnerNames(game, ids) {
  if (ids.length >= 3) return `${ids.length}人が同点`;
  return ids.map((id) => playerById(game, id).name).join('・');
}

function renderAwards(game) {
  const { telepathy, mysterious, bestPair, zure } = awards(game);
  const pairText = bestPair.pairs.length >= 2
    ? `${bestPair.pairs.length}組が同点`
    : bestPair.pairs[0].map((id) => playerById(game, id).name).join('＆');
  const cards = [
    {
      key: 'telepathy',
      title: '以心伝心王',
      winner: telepathy.points > 0 ? winnerNames(game, telepathy.playerIds) : '該当なし',
      note: telepathy.points > 0 ? `予想で合計${telepathy.points}点` : 'だれも当たらず',
    },
    {
      key: 'mysterious',
      title: 'ミステリアス賞',
      winner: winnerNames(game, mysterious.playerIds),
      note: `みんなが取れたのは${mysterious.points}点`,
    },
    {
      key: 'pair',
      title: 'ベストペア',
      winner: bestPair.points > 0 ? pairText : '該当なし',
      note: bestPair.points > 0 ? `おたがいに${bestPair.points}点` : 'おたがい当たらず',
    },
    {
      key: 'zure',
      title: '今日のズレ大賞',
      winner: zure ? `「${zure.word}」` : '該当なし',
      note: zure ? `${playerById(game, zure.mainId).name}さん・平均${Math.round(zure.average)}ズレ` : '',
    },
  ];
  const list = el('ul', 'awards');
  list.append(...cards.map(({ key, title, winner, note }) => {
    const card = el('li', `award award--${key}`);
    card.append(el('p', 'award__title', title), el('p', 'award__winner', winner), el('p', 'award__note', note));
    return card;
  }));
  return list;
}

function finish(value) {
  const resolve = resolveCurrent;
  resolveCurrent = null;
  resolve?.(value);
}

export const endActions = {
  'end-again': () => finish('again'),
  'end-home': () => finish('home'),
};
