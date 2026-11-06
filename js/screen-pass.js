// スマホを次の人に渡す画面。前の人の画面を見せないために、あいだにはさむ。
import { showScreen } from './ui.js';
import { popIn } from './fx.js';

const screen = document.querySelector('[data-screen="pass"]');
const part = (name) => screen.querySelector(`[data-pass="${name}"]`);

let resolveCurrent = null;

/**
 * 「〇〇さんの番」と出して、その人が「はじめる」を押すまで待つ。
 * @param {object} options
 * @param {{ name: string, color: string }} options.player 次の人
 * @param {string} options.step 上に出す、今どこか（例：「マップ作り 2/4」）
 * @param {string} options.text 何をする番か
 * @param {string} [options.note] 小さく添える注意
 */
export function showPass({ player, step, text, note = '' }) {
  part('step').textContent = step;
  part('name').textContent = player.name;
  screen.style.setProperty('--player-color', player.color);
  part('text').textContent = text;
  part('note').textContent = note;
  showScreen('pass');
  popIn(part('name').parentElement, { delay: 120, from: 'scale(0.3) rotate(-10deg)' });
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}

export const passActions = {
  'pass-go': () => {
    const resolve = resolveCurrent;
    resolveCurrent = null;
    resolve?.();
  },
};
