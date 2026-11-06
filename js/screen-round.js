// 主役の発表（ラウンドのはじめ）。主役のお題と5つのワードを全員に見せる（置き場所は秘密）。
import { showScreen, el } from './ui.js';
import { createMap } from './mapview.js';

const screen = document.querySelector('[data-screen="round"]');
const part = (name) => screen.querySelector(`[data-round="${name}"]`);

let resolveCurrent = null;

/**
 * @param {object} options
 * @param {{ name: string, color: string }} options.main 主役
 * @param {object} options.topic 主役のお題
 * @param {number} options.round 何ラウンド目か
 * @param {number} options.rounds 全部で何ラウンドか
 * @param {boolean} [options.canAdvance] このスマホで「予想をはじめる」を押せるか（部屋で遊ぶときはホストだけ）
 * @param {boolean} [options.isMe] このスマホの人が主役か（部屋で遊ぶとき）
 */
export function showRound({ main, topic, round, rounds, canAdvance = true, isMe = false }) {
  part('step').textContent = `ラウンド ${round}/${rounds}`;
  const go = part('go');
  go.disabled = !canAdvance;
  go.textContent = canAdvance ? '予想をはじめる' : 'ホストがはじめます';
  screen.querySelector('.guide').textContent = isMe ? 'あなたが主役！みんなの予想を待とう' : '主役の頭の中を、みんなで当てよう！';
  part('name').textContent = main.name;
  screen.style.setProperty('--player-color', main.color);
  part('genre').textContent = topic.genre;
  part('title').textContent = topic.title;
  part('map').replaceChildren(createMap(topic, 'map--static map--preview'));
  part('words').replaceChildren(...topic.words.map((word) => el('span', 'chip chip--static', word)));
  showScreen('round');
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}

export const roundActions = {
  'round-go': () => {
    const resolve = resolveCurrent;
    resolveCurrent = null;
    resolve?.();
  },
};
