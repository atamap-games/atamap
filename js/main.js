// アタマップ：最初に読み込まれるファイル。画面の切り替えと、ボタンをつなぐ。
import { showScreen, showToast, openSheet, closeSheet } from './ui.js';
import { startSoloGame, quitGame, isPlaying } from './flow.js';
import { playersActions } from './screen-players.js';
import { passActions } from './screen-pass.js';
import { placeActions } from './screen-place.js';
import { roundActions } from './screen-round.js';
import { revealActions } from './screen-reveal.js';
import { endActions } from './screen-end.js';

// アドレスの印（#play など）で、トップかゲームのとちゅうかを決める（ブラウザの「戻る」も効く）。
// ゲームの中の画面の切り替えは flow.js が受け持つ。
function render() {
  const playing = location.hash === '#play';
  if (playing && !isPlaying()) {
    startSoloGame({ onExit: () => navigate('top') });
  } else if (!playing) {
    if (isPlaying()) quitGame();
    closeSheet('quit');
    showScreen('top');
  }
}

function navigate(name) {
  const address = name === 'top' ? location.pathname + location.search : `#${name}`;
  if (location.hash === (name === 'top' ? '' : `#${name}`)) {
    render();
    return;
  }
  history.pushState(null, '', address);
  render();
}

// ボタンを押したときの動き。data-action の名前で探す。
const actions = {
  // 部屋づくり・参加は、スマホ同士をつなぐしくみ（Firebase）を用意してから作る。
  'create-room': () => showToast('「部屋を作る」は準備中です'),
  'join-room': () => showToast('「部屋に入る」は準備中です'),
  'play-solo': () => navigate('play'),
  home: () => navigate('top'),
  help: () => openSheet('howto'),
  'close-help': () => closeSheet('howto'),
  quit: () => openSheet('quit'),
  'quit-cancel': () => closeSheet('quit'),
  'quit-confirm': () => {
    closeSheet('quit');
    navigate('top');
  },
  ...playersActions,
  ...passActions,
  ...placeActions,
  ...roundActions,
  ...revealActions,
  ...endActions,
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = actions[button.dataset.action];
  if (action) action(button);
});

window.addEventListener('popstate', render);
render();
