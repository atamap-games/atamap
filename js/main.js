// アタマップ：最初に読み込まれるファイル。各画面のボタンをつなぐ。
import { showScreen, showToast } from './ui.js';

// ボタンを押したときの動き。data-action の名前で探す。
// 部屋づくり・参加は、スマホ同士をつなぐしくみ（Firebase）を用意してから作る。
const actions = {
  'create-room': () => {
    showToast('「部屋を作る」は準備中です');
  },
  'join-room': () => {
    showToast('「部屋に入る」は準備中です');
  },
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = actions[button.dataset.action];
  if (action) action(button);
});

showScreen('top');
