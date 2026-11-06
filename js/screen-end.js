// 最終結果。予想で取った点の合計で順位を出す。
import { showScreen, el } from './ui.js';
import { totalPoints } from './score.js';

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
  const list = el('ol', `ranking${rows.length > 5 ? ' ranking--two' : ''}`);
  list.append(...rows);
  part('body').replaceChildren(list);
  showScreen('end');
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
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
