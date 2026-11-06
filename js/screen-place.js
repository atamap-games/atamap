// ワードを置く画面。「自分のマップを作る」と「主役のマップを予想する」の両方で使う。
import { createBoard } from './board.js';
import { showScreen, showToast, el } from './ui.js';

const screen = document.querySelector('[data-screen="place"]');
const part = (name) => screen.querySelector(`[data-place="${name}"]`);
const lockButton = () => part('actions').querySelector('[data-action="lock"]');
const rerollButton = () => part('actions').querySelector('[data-action="reroll"]');

// 引き直しを押してから、もう一度押すまで待つ時間（置いたワードが消えるときだけ確かめる）
const CONFIRM_MS = 2500;

let board = null;
let current = null; // 今の画面の設定と状態
let confirmTimer = 0;

/**
 * ワードを置いてもらう。
 * @param {object} options
 * @param {'make'|'guess'} options.mode 自分のマップを作る／主役のマップを予想する
 * @param {{ name: string, color: string }} options.player 置く人
 * @param {{ name: string }} [options.main] 主役（予想のとき）
 * @param {object} options.topic お題
 * @param {() => object} [options.reroll] 引き直したときの新しいお題を返す関数（自分のマップのときだけ）
 * @returns {Promise<{ topicId: number, placements: object[], rerolled: boolean }>}
 */
export function runPlace({ mode, player, main = null, topic, reroll = null }) {
  stopPlace();
  current = { mode, player, main, topic, reroll, rerolled: false, placed: 0, resolve: null };

  part('who').replaceChildren(
    el('span', 'who__dot'),
    mode === 'make' ? `${player.name}さんのマップ` : `${player.name}さんの予想（主役：${main.name}さん）`,
  );
  screen.style.setProperty('--player-color', player.color);
  part('actions').classList.toggle('actions--split', Boolean(reroll));
  rerollButton().hidden = !reroll;
  setTopic(topic);
  renderReroll();
  showScreen('place');

  return new Promise((resolve) => {
    current.resolve = resolve;
  });
}

/** 画面を離れるときの後片づけ */
export function stopPlace() {
  board?.destroy();
  board = null;
  resetConfirm();
}

function setTopic(topic) {
  board?.destroy();
  current.topic = topic;
  part('genre').textContent = topic.genre;
  part('title').textContent = topic.title;
  board = createBoard(part('board'), topic, { onChange: render });
}

// 置いた数などに合わせて、案内の文とボタンを変える（案内は1行に収まる長さにする）
function render({ placed, total, selected, locked }) {
  if (!current) return;
  const guide = part('guide');
  const left = total - placed;
  const guessing = current.mode === 'guess';
  current.placed = placed;

  if (locked) {
    guide.textContent = guessing ? 'この予想で決まり！' : 'このマップで決まり！';
  } else if (selected) {
    guide.textContent = 'マップの置きたいところをタップ';
  } else if (placed === 0) {
    if (guessing) guide.textContent = '主役ならココらへん？と置いてね';
    else guide.textContent = current.reroll && !current.rerolled ? 'お題が苦手なら1回だけ引き直せます' : 'ワードを指でマップへ動かそう';
  } else if (left > 0) {
    guide.textContent = guessing ? `あと${left}つ。主役の気持ちで置いてね` : `あと${left}つ。自分の感覚で置いてね`;
  } else {
    guide.textContent = '外へ出すと、下に戻せます';
  }

  lockButton().disabled = left > 0;
  lockButton().textContent = left > 0 ? `あと${left}つ置いてね` : guessing ? '決定する' : 'ロックする';
}

// 引き直しボタンの見た目（使ったら押せなくする）
function renderReroll(confirming = false) {
  const button = rerollButton();
  const used = current?.rerolled;
  button.disabled = used;
  button.classList.toggle('is-confirm', confirming);
  const small = el('small', '', confirming ? 'もう一度押す' : used ? '使用済み' : 'あと1回');
  button.replaceChildren(confirming ? '本当に？' : '引き直す', small);
  if (confirming) part('guide').textContent = '引き直すと、置いたワードは消えます';
}

function resetConfirm() {
  window.clearTimeout(confirmTimer);
  confirmTimer = 0;
}

export const placeActions = {
  reroll: () => {
    if (!current?.reroll || current.rerolled || !board) return;
    // ワードを置いたあとなら、置いたものが消えるので、もう一度押してもらう
    if (current.placed > 0 && !confirmTimer) {
      renderReroll(true);
      confirmTimer = window.setTimeout(() => {
        resetConfirm();
        renderReroll();
        board?.refresh();
      }, CONFIRM_MS);
      return;
    }
    resetConfirm();
    current.rerolled = true;
    setTopic(current.reroll(current.topic));
    renderReroll();
    showToast(`お題を引き直しました：「${current.topic.title}」`);
  },
  lock: () => {
    if (!board?.isComplete() || !current?.resolve) return;
    resetConfirm();
    board.lock({ message: current.mode === 'guess' ? '予想を決めました！' : 'ロックしました！' });
    const { resolve, topic, rerolled } = current;
    current.resolve = null;
    resolve({ topicId: topic.id, placements: board.getPlacements(), rerolled });
  },
};
