// 主役がマップを作っているあいだの、ほかの人の画面（部屋で遊ぶとき）。
// 主役の名前と、お題・5つのワードを先に見せる（置き場所は秘密）。予想を考えはじめられるので、テンポがよくなる。
import { showScreen, el } from './ui.js';
import { createMap } from './mapview.js';
import { createTimer } from './timer.js';
import { popIn, burstAt, bump } from './fx.js';

const screen = document.querySelector('[data-screen="round"]');
const part = (name) => screen.querySelector(`[data-round="${name}"]`);

let shownKey = '';
let shownTopic = null;
let timer = null;
let timerDeadline = null;
let skipHandler = null;

/**
 * 主役がマップを作っているあいだの画面を出す（部屋のデータが変わるたびに呼んでよい）。
 * @param {object} options
 * @param {string} options.key ラウンドを見分ける文字（変わったら、名前の演出をやり直す）
 * @param {{ name: string, color: string }} options.main 主役
 * @param {object} options.topic 主役のお題（引き直すと変わる）
 * @param {number} options.round 何ラウンド目か
 * @param {number} options.rounds 全部で何ラウンドか
 * @param {number|null} options.remaining 残り時間（秒）。null なら制限なし
 * @param {number|null} options.deadline 締め切り（同じなら、時間を数え直さない）
 * @param {number} options.total 制限時間の全体（秒）
 * @param {boolean} options.canSkip 「この主役をとばす」を押せるか（ホストで、主役がいないとき）
 * @param {() => void} options.onSkip 「この主役をとばす」を押したとき
 */
export function showMaking({ key, main, topic, round, rounds, remaining, deadline, total, canSkip, onSkip }) {
  const fresh = shownKey !== key;
  shownKey = key;
  skipHandler = onSkip;
  part('step').textContent = `ラウンド ${round}/${rounds}`;
  part('name').textContent = main.name;
  screen.style.setProperty('--player-color', main.color);

  // お題（主役が引き直すと変わる）
  if (fresh || shownTopic?.id !== topic.id) {
    shownTopic = topic;
    part('genre').textContent = topic.genre;
    part('title').textContent = topic.title;
    part('map').replaceChildren(createMap(topic, 'map--static map--preview'));
    const chips = topic.words.map((word) => el('span', 'chip chip--static', word));
    part('words').replaceChildren(...chips);
    chips.forEach((chip, i) => popIn(chip, { delay: (fresh ? 500 : 0) + i * 70 }));
  }

  const go = part('go');
  go.disabled = !canSkip;
  go.textContent = canSkip ? 'この主役をとばす' : '主役のロックを待っています';

  // 残り時間
  if (deadline !== timerDeadline) {
    timerDeadline = deadline;
    timer?.stop();
    timer = null;
    const box = part('timer');
    box.hidden = remaining === null;
    if (remaining !== null) {
      timer = createTimer({
        seconds: Math.max(0, remaining),
        pausable: false,
        onTick: (left) => {
          part('seconds').textContent = left;
          box.style.setProperty('--left', String(Math.min(1, left / (total || 90))));
          box.classList.toggle('is-hurry', left <= 10);
          if (left <= 10) bump(part('seconds'));
        },
        onEnd: () => {},
      });
    }
  }

  showScreen('round');
  if (fresh) {
    // 演出：主役の名前がどーんと出て、まわりに星がはじける
    const name = part('name').parentElement;
    popIn(name, { delay: 150, from: 'scale(2.2)' });
    window.setTimeout(() => burstAt(name, { count: 14, spread: 80, stars: true }), 450);
  }
}

/** 画面を離れるときの後片づけ */
export function stopMaking() {
  timer?.stop();
  timer = null;
  timerDeadline = null;
  shownKey = '';
  shownTopic = null;
}

export const roundActions = {
  'round-go': () => skipHandler?.(),
};
