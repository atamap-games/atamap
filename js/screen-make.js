// 「自分のマップを作る」画面。今は1台のスマホで、ひとりで試せる形。
import { loadTopics } from './topics.js';
import { createBoard } from './board.js';
import { showToast } from './ui.js';

const screen = document.querySelector('[data-screen="make"]');
const part = (name) => screen.querySelector(`[data-make="${name}"]`);

let board = null;
let topic = null;

/** お題を1つ選んで、マップ作りを始める（前と同じお題は選ばない） */
export async function startMake() {
  stopMake();

  let topics;
  try {
    topics = await loadTopics();
  } catch (error) {
    console.error(error);
    showToast('お題を読み込めませんでした。通信を確かめてね');
    return;
  }
  const candidates = topics.filter((t) => t.id !== topic?.id);
  topic = candidates[Math.floor(Math.random() * candidates.length)];

  part('genre').textContent = topic.genre;
  part('title').textContent = topic.title;
  part('done').hidden = true;
  part('actions').hidden = false;
  part('hint').hidden = false;
  board = createBoard(part('board'), topic, { onChange: render });
}

/** 画面を離れるときの後片づけ */
export function stopMake() {
  board?.destroy();
  board = null;
}

// 置いた数などに合わせて、案内の文とボタンを変える
function render({ placed, total, selected, locked }) {
  const guide = part('guide');
  const lockButton = part('actions').querySelector('[data-action="lock"]');
  const left = total - placed;

  if (locked) {
    guide.textContent = 'このマップで決まり！';
  } else if (selected) {
    guide.textContent = `「${selected}」を置きたいところをタップ`;
  } else if (placed === 0) {
    guide.textContent = 'ワードを指で動かして、マップに置こう';
  } else if (left > 0) {
    guide.textContent = `あと${left}つ。自分の感覚で置いてね`;
  } else {
    guide.textContent = '置き直すなら、ワードを動かしてね';
  }

  lockButton.disabled = left > 0;
  lockButton.textContent = left > 0 ? `あと${left}つ置いてね` : 'ロックする';
}

// この画面のボタン
export const makeActions = {
  lock: () => {
    if (!board?.isComplete()) return;
    board.lock();
    part('actions').hidden = true;
    part('hint').hidden = true;
    part('done').hidden = false;
  },
  'make-again': () => {
    window.scrollTo(0, 0);
    startMake();
  },
};
