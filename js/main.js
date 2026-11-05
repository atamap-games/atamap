// アタマップ：最初に読み込まれるファイル。画面の切り替えと、ボタンをつなぐ。
import { showScreen, showToast } from './ui.js';
import { startMake, stopMake, makeActions } from './screen-make.js';

// 画面の名前と、その画面に入るとき・出るときにすること。
// アドレスの「#make」のような印で、どの画面かを決める（ブラウザの「戻る」も効く）。
const screens = {
  top: {},
  make: { enter: startMake, leave: stopMake },
};

let current = null;

function screenFromAddress() {
  const name = location.hash.slice(1);
  return name in screens ? name : 'top';
}

function render() {
  const name = screenFromAddress();
  if (name === current) return;
  if (current) screens[current].leave?.();
  current = name;
  showScreen(name);
  screens[name].enter?.();
}

function navigate(name) {
  const address = name === 'top' ? location.pathname + location.search : `#${name}`;
  history.pushState(null, '', address);
  render();
}

// ボタンを押したときの動き。data-action の名前で探す。
const actions = {
  // 部屋づくり・参加は、スマホ同士をつなぐしくみ（Firebase）を用意してから作る。
  'create-room': () => {
    showToast('「部屋を作る」は準備中です');
  },
  'join-room': () => {
    showToast('「部屋に入る」は準備中です');
  },
  'try-make': () => navigate('make'),
  home: () => navigate('top'),
  ...makeActions,
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = actions[button.dataset.action];
  if (action) action(button);
});

window.addEventListener('popstate', render);
render();
