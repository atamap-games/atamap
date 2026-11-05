// 「自分のマップを作る」画面。今は1台のスマホで、ひとりで試せる形。
import { loadTopics } from './topics.js';
import { createBoard } from './board.js';
import { showToast } from './ui.js';

const screen = document.querySelector('[data-screen="make"]');
const part = (name) => screen.querySelector(`[data-make="${name}"]`);
const rerollButton = () => part('actions').querySelector('[data-action="reroll"]');

// 引き直しを押してから、もう一度押すまで待つ時間（置いたワードが消えるときだけ確かめる）
const CONFIRM_MS = 2500;

let board = null;
let topic = null;
let topics = [];
let rerolled = false;
let placedCount = 0;
let confirmTimer = 0;

/** お題を1つ選んで、マップ作りを始める（前と同じお題は選ばない） */
export async function startMake() {
  stopMake();

  try {
    topics = await loadTopics();
  } catch (error) {
    console.error(error);
    showToast('お題を読み込めませんでした。通信を確かめてね');
    return;
  }
  rerolled = false;
  setTopic(pickTopic([topic?.id]));
  part('done').hidden = true;
  part('actions').hidden = false;
  renderReroll();
}

/** 画面を離れるときの後片づけ */
export function stopMake() {
  board?.destroy();
  board = null;
  resetConfirm();
}

// 使っていないお題から1つ選ぶ
function pickTopic(excludeIds) {
  const candidates = topics.filter((t) => !excludeIds.includes(t.id));
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function setTopic(next) {
  board?.destroy();
  topic = next;
  part('genre').textContent = topic.genre;
  part('title').textContent = topic.title;
  board = createBoard(part('board'), topic, { onChange: render });
}

// 置いた数などに合わせて、案内の文とボタンを変える（案内は1行に収まる長さにする）
function render({ placed, total, selected, locked }) {
  const guide = part('guide');
  const lockButton = part('actions').querySelector('[data-action="lock"]');
  const left = total - placed;
  placedCount = placed;

  if (locked) {
    guide.textContent = 'このマップで決まり！';
  } else if (selected) {
    guide.textContent = 'マップの置きたいところをタップ';
  } else if (placed === 0) {
    guide.textContent = rerolled ? 'ワードを指でマップへ動かそう' : 'お題が苦手なら1回だけ引き直せます';
  } else if (left > 0) {
    guide.textContent = `あと${left}つ。自分の感覚で置いてね`;
  } else {
    guide.textContent = '外へ出すと、下に戻せます';
  }

  lockButton.disabled = left > 0;
  lockButton.textContent = left > 0 ? `あと${left}つ置いてね` : 'ロックする';
}

// 引き直しボタンの見た目（使ったら押せなくする）
function renderReroll(confirming = false) {
  const button = rerollButton();
  button.disabled = rerolled;
  button.classList.toggle('is-confirm', confirming);
  const small = document.createElement('small');
  small.textContent = confirming ? 'もう一度押す' : rerolled ? '使用済み' : 'あと1回';
  button.replaceChildren(confirming ? '本当に？' : '引き直す', small);
  if (confirming) part('guide').textContent = '引き直すと、置いたワードは消えます';
}

function resetConfirm() {
  window.clearTimeout(confirmTimer);
  confirmTimer = 0;
}

// この画面のボタン
export const makeActions = {
  reroll: () => {
    if (rerolled || !board) return;
    // ワードを置いたあとなら、置いたものが消えるので、もう一度押してもらう
    if (placedCount > 0 && !confirmTimer) {
      renderReroll(true);
      confirmTimer = window.setTimeout(() => {
        resetConfirm();
        renderReroll();
        board?.refresh();
      }, CONFIRM_MS);
      return;
    }
    resetConfirm();
    rerolled = true;
    setTopic(pickTopic([topic.id]));
    renderReroll();
    showToast(`お題を引き直しました：「${topic.title}」`);
  },
  lock: () => {
    if (!board?.isComplete()) return;
    resetConfirm();
    board.lock({ message: 'ロックしました！', note: '本番では、ここでみんなを待ちます' });
    part('actions').hidden = true;
    part('done').hidden = false;
  },
  'make-again': () => startMake(),
};
