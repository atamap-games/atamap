// アタマップ：最初に読み込まれるファイル。画面の切り替えと、ボタンをつなぐ。
import { showScreen, openSheet, closeSheet } from './ui.js';
import { startSoloGame, quitGame, isPlaying } from './flow.js';
import { startOnline, leaveOnline, isOnline, leaveTexts, rememberedRoom } from './online.js';
import { normalizeCode } from './room.js';
import { playersActions } from './screen-players.js';
import { passActions } from './screen-pass.js';
import { placeActions } from './screen-place.js';
import { roundActions } from './screen-round.js';
import { revealActions } from './screen-reveal.js';
import { endActions } from './screen-end.js';
import { roomActions } from './screen-room.js';

// アドレスの印で、トップか、1台で遊ぶとちゅう（#play）か、部屋で遊ぶとちゅう（#room）かを決める。
// ブラウザの「戻る」も効く。ゲームの中の画面の切り替えは flow.js と online.js が受け持つ。
let roomIntent = null; // 部屋を作る・入る、のどちらか（と、わかっている部屋の番号）

// QRコードやリンク（?room=番号）から来たときは、その部屋に入る
const params = new URLSearchParams(location.search);
if (params.has('room')) {
  roomIntent = { mode: 'join', code: normalizeCode(params.get('room')) };
  params.delete('room');
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}#room`);
} else if (location.hash === '#room' && rememberedRoom()) {
  // ゲームのとちゅうでページを開き直したときは、同じ部屋に自動でもどる
  roomIntent = { mode: 'join', code: rememberedRoom(), auto: true };
}

function render() {
  const hash = location.hash;
  if (hash === '#play') {
    if (isOnline()) leaveOnline();
    if (!isPlaying()) startSoloGame({ onExit: () => navigate('top') });
  } else if (hash === '#room') {
    if (isPlaying()) quitGame();
    if (!isOnline()) {
      const intent = roomIntent ?? { mode: 'join' };
      roomIntent = null;
      startOnline({ ...intent, onExit: () => navigate('top') });
    }
  } else {
    if (isPlaying()) quitGame();
    if (isOnline()) leaveOnline();
    closeSheet('quit');
    showScreen('top');
  }
}

function navigate(name) {
  const target = name === 'top' ? '' : `#${name}`;
  if (location.hash === target) {
    render();
    return;
  }
  history.pushState(null, '', name === 'top' ? location.pathname + location.search : target);
  render();
}

// 「←」で出るときの確かめの別窓。部屋で遊ぶときと1台のときで、文を変える
function openQuit() {
  const texts = isOnline()
    ? leaveTexts()
    : { title: 'ゲームを終わりますか？', text: 'ここまでの結果は消えます。', ok: '終わる' };
  const sheet = document.getElementById('quit');
  sheet.querySelector('[data-quit="title"]').textContent = texts.title;
  sheet.querySelector('[data-quit="text"]').textContent = texts.text;
  sheet.querySelector('[data-quit="ok"]').textContent = texts.ok;
  openSheet('quit');
}

// ボタンを押したときの動き。data-action の名前で探す。
const actions = {
  'create-room': () => {
    roomIntent = { mode: 'create' };
    navigate('room');
  },
  'join-room': () => {
    roomIntent = { mode: 'join' };
    navigate('room');
  },
  'play-solo': () => navigate('play'),
  home: () => navigate('top'),
  help: () => openSheet('howto'),
  'close-help': () => closeSheet('howto'),
  quit: () => openQuit(),
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
  ...roomActions,
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = actions[button.dataset.action];
  if (action) action(button);
});

window.addEventListener('popstate', render);
render();
