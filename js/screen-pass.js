// スマホを次の人に渡す画面。前の人の画面を見せないために、あいだにはさむ。
import { showScreen, el } from './ui.js';
import { popIn, burstAt, shake, reduced } from './fx.js';
import { sfx } from './sound.js';

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
 * @param {object} [options.topic] 大きく発表するお題（主役の番・予想の番）
 * @param {string} [options.topicLabel] お題の札の文字（例：「お題」「あおいさんのお題」）
 */
export function showPass({ player, step, text, note = '', topic = null, topicLabel = 'お題' }) {
  part('step').textContent = step;
  part('name').textContent = player.name;
  // 名前が長いときは、1行に収まるように文字を小さくする（css/style.css の --name-len）
  part('name').parentElement.style.setProperty('--name-len', String(Math.max(3, [...player.name].length)));
  screen.style.setProperty('--player-color', player.color);
  part('text').textContent = text;
  part('note').textContent = note;
  const card = part('topic');
  card.hidden = !topic;
  if (topic) fillTopicCard(card, topic, topicLabel);
  showScreen('pass');
  popIn(part('name').parentElement, { delay: 120, from: 'scale(0.3) rotate(-10deg)' });
  if (topic) announceTopic(card, { delay: 450 });
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

/**
 * お題の札（「お題」の札・ジャンル・大きなお題の名前）を作る。部屋で遊ぶときの、マップ作りのはじめの発表でも使う。
 * @param {HTMLElement} card 入れ物（.topic-card）
 * @param {object} topic お題
 * @param {string} label 札の文字
 */
export function fillTopicCard(card, topic, label) {
  const title = el('p', 'topic-card__title', topic.title);
  // お題の名前が長いときは、1行に収まるように小さくする
  title.style.setProperty('--len', String(Math.max(5, [...topic.title].length)));
  card.replaceChildren(
    el('p', 'topic-card__label', label),
    el('p', 'topic-card__genre', topic.genre),
    title,
  );
}

/**
 * お題の札を「デデン！」と出す（大きいところから、どんっと落ちてきて、ゆれる）。
 * @param {HTMLElement} card お題の札
 * @param {object} [options]
 * @param {number} [options.delay] 出すまでの時間（ミリ秒）
 */
export function announceTopic(card, { delay = 0 } = {}) {
  if (reduced()) {
    window.setTimeout(() => sfx('topic'), delay);
    return;
  }
  card.animate(
    [
      { transform: 'scale(2.6) rotate(10deg)', opacity: 0 },
      { transform: 'scale(0.92) rotate(-3deg)', opacity: 1, offset: 0.55 },
      { transform: 'scale(1.04) rotate(-1deg)', offset: 0.78 },
      { transform: 'scale(1) rotate(-2deg)' },
    ],
    { duration: 520, delay, easing: 'cubic-bezier(0.3, 0.8, 0.3, 1)', fill: 'backwards' },
  );
  window.setTimeout(() => {
    sfx('topic');
    // 画面ごとゆらすと、画面のはしが外へはみ出すので、お題のまわりだけをゆらす
    shake(card.parentElement);
  }, delay + 280);
  window.setTimeout(() => burstAt(card.querySelector('.topic-card__title'), { count: 16, spread: 90, stars: true }), delay + 480);
}
