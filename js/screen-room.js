// 部屋で遊ぶときの画面：名前（と部屋の番号）を入れる画面・待合室・みんなを待つ画面
import { showScreen, showToast, el } from './ui.js';
import { createQrSvg } from './qr.js';
import { createTimer } from './timer.js';
import { popIn, burstAt, bump } from './fx.js';
import { NAME_MAX } from './game.js';
import { normalizeCode, CODE_LENGTH, MIN_PLAYERS, MAX_PLAYERS } from './room.js';

const NAME_KEY = 'atamap.myName';

// ---------- 名前（と部屋の番号）を入れる画面 ----------

const entry = document.querySelector('[data-screen="entry"]');
const entryPart = (name) => entry.querySelector(`[data-entry="${name}"]`);
const codeInput = () => entry.querySelector('#room-code');
const nameInput = () => entry.querySelector('#room-name');

let entryResolve = null;
let entryMode = 'create';

/**
 * 名前（部屋に入るときは部屋の番号も）を入れてもらう。
 * @param {object} options
 * @param {'create'|'join'} options.mode 部屋を作る／部屋に入る
 * @param {string} [options.code] わかっている部屋の番号（QRコードやURLから来たとき）
 * @param {string} [options.error] 前にうまくいかなかったときの知らせ
 * @returns {Promise<{ name: string, code: string }>}
 */
export function askEntry({ mode, code = '', error = '' }) {
  entryMode = mode;
  const joining = mode === 'join';
  entryPart('title').textContent = joining ? '部屋に入る' : '部屋を作る';
  entryPart('guide').textContent = joining
    ? (code ? `部屋「${code}」に入ります` : '部屋の番号と、あなたの名前を入れてね')
    : 'あなたの名前を入れてね（ホストになります）';
  entryPart('go').textContent = joining ? '入る' : '部屋を作る';
  entryPart('go').disabled = false;
  entryPart('code-field').hidden = !joining || Boolean(code);
  codeInput().value = code;
  if (!nameInput().value) nameInput().value = loadName();
  entryPart('error').textContent = error;
  showScreen('entry');
  return new Promise((resolve) => {
    entryResolve = resolve;
  });
}

/** 「入る」を押したあと、つなぐあいだボタンを押せなくする */
export function setEntryBusy(busy) {
  entryPart('go').disabled = busy;
  entryPart('go').textContent = busy ? 'つないでいます…' : entryMode === 'join' ? '入る' : '部屋を作る';
}

function submitEntry() {
  if (!entryResolve) return;
  const name = nameInput().value.trim().slice(0, NAME_MAX);
  const code = normalizeCode(codeInput().value);
  if (entryMode === 'join' && !code) {
    entryPart('error').textContent = `部屋の番号（${CODE_LENGTH}文字）を入れてね`;
    return;
  }
  if (!name) {
    entryPart('error').textContent = '名前を入れてね';
    nameInput().focus();
    return;
  }
  document.activeElement?.blur?.();
  saveName(name);
  const resolve = entryResolve;
  entryResolve = null;
  resolve({ name, code });
}

entryPart('form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitEntry();
});
codeInput().addEventListener('input', () => {
  codeInput().value = codeInput().value.toUpperCase();
});
for (const input of [codeInput(), nameInput()]) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (input === codeInput()) nameInput().focus();
    else submitEntry();
  });
}

function loadName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // 覚えられなくても遊べる
  }
}

// ---------- 待合室 ----------

const lobby = document.querySelector('[data-screen="lobby"]');
const lobbyPart = (name) => lobby.querySelector(`[data-lobby="${name}"]`);
let qrFor = '';
let lobbyHandlers = {};
let lobbySeen = new Set(); // 待合室で、もう出した人（新しく入った人だけ、ぽんっと出す）
let lobbyCode = '';

/**
 * 待合室を出す（中身が変わるたびに呼んでよい）。
 * @param {object} options
 * @param {string} options.code 部屋の番号
 * @param {string} options.url この部屋に入るためのアドレス
 * @param {{ uid: string, name: string, online: boolean, color: string }[]} options.members 部屋にいる人（入った順）
 * @param {string} options.uid このスマホの人
 * @param {boolean} options.isHost このスマホの人がホストか
 * @param {boolean} options.timeOn 制限時間があるか
 * @param {object} options.handlers { start, setTime }
 */
export function showLobby({ code, url, members, uid, isHost, timeOn, handlers }) {
  lobbyHandlers = handlers;
  lobbyPart('code').textContent = code;
  lobbyPart('url').textContent = url;
  if (qrFor !== url) {
    qrFor = url;
    lobbyPart('qr').replaceChildren(el('p', 'qr__loading', 'QRコードを作っています…'));
    createQrSvg(url)
      .then((svg) => {
        if (qrFor === url) lobbyPart('qr').replaceChildren(svg);
      })
      .catch(() => {
        if (qrFor === url) lobbyPart('qr').replaceChildren(el('p', 'qr__loading', 'QRコードを出せませんでした。番号かリンクで入ってね'));
      });
  }
  lobbyPart('count').textContent = members.length;
  if (lobbyCode !== code) {
    lobbyCode = code;
    lobbySeen = new Set();
  }
  const chips = members.map((m) => memberChip(m, { isMe: m.uid === uid, isHost: m.isHost }));
  lobbyPart('members').replaceChildren(...chips);
  members.forEach((m, i) => {
    if (lobbySeen.has(m.uid)) return;
    lobbySeen.add(m.uid);
    popIn(chips[i], { from: 'scale(0.2) rotate(-12deg)' });
    if (m.uid !== uid) window.setTimeout(() => burstAt(chips[i], { count: 8, spread: 36 }), 250);
  });

  // 制限時間：ホストだけが変えられる
  for (const [key, on] of [['time-on', true], ['time-off', false]]) {
    const button = lobbyPart(key);
    button.classList.toggle('is-on', timeOn === on);
    button.setAttribute('aria-checked', String(timeOn === on));
    button.disabled = !isHost;
  }

  const start = lobbyPart('start');
  if (!isHost) {
    start.disabled = true;
    start.textContent = 'ホストがはじめるのを待っています';
  } else if (members.length < MIN_PLAYERS) {
    start.disabled = true;
    start.textContent = `あと${MIN_PLAYERS - members.length}人ではじめられます`;
  } else {
    start.disabled = false;
    start.textContent = `${members.length}人ではじめる`;
  }
  showScreen('lobby');
}

function memberChip(member, { isMe, isHost }) {
  const chip = el('li', `member${member.online === false ? ' is-offline' : ''}${member.done ? ' is-done' : ''}`);
  chip.style.setProperty('--player-color', member.color);
  chip.append(el('span', 'member__dot'), el('span', 'member__name', member.name));
  if (isMe) chip.append(el('small', 'member__tag', 'あなた'));
  else if (isHost) chip.append(el('small', 'member__tag', 'ホスト'));
  if ('done' in member) chip.append(el('span', 'member__status', member.done ? '✓' : '…'));
  return chip;
}

async function copyUrl() {
  const url = lobbyPart('url').textContent;
  try {
    await navigator.clipboard.writeText(url);
    showToast('リンクをコピーしました');
  } catch {
    // コピーできないときは、文字を選んだ状態にして、自分でコピーしてもらう
    const range = document.createRange();
    range.selectNodeContents(lobbyPart('url'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    showToast('リンクを選びました。コピーしてね');
  }
}

// ---------- みんなを待つ画面 ----------

const wait = document.querySelector('[data-screen="wait"]');
const waitPart = (name) => wait.querySelector(`[data-wait="${name}"]`);
let waitTimer = null;
let waitDeadline = null;
let waitHandlers = {};
let waitDone = new Set(); // もうロックした人（新しくロックした人だけ、ぽんっと出す）
let waitKey = '';

/**
 * みんなを待つ画面を出す（中身が変わるたびに呼んでよい）。
 * @param {object} options
 * @param {string} options.step 上に出す、今どこか
 * @param {string} options.title 大きく出す文
 * @param {string} options.text 小さく出す文
 * @param {object[]} options.members { name, color, done, online, isMe }
 * @param {number|null} options.remaining 残り時間（秒）。null なら出さない
 * @param {number} [options.deadline] 締め切り（同じ締め切りなら、時間を数え直さない）
 * @param {number} [options.total] 制限時間の全体（秒。円の減り方に使う）
 * @param {boolean} options.canSkip 「待たずに進める」を出すか（ホストだけ）
 * @param {object} options.handlers { skip }
 */
export function showWait({ step, title, text, members, remaining, deadline = null, total = 90, canSkip, handlers }) {
  waitHandlers = handlers;
  waitPart('step').textContent = step;
  waitPart('title').textContent = title;
  waitPart('text').textContent = text;
  const chips = members.map((m) => memberChip(m, { isMe: m.isMe, isHost: false }));
  waitPart('members').replaceChildren(...chips);
  if (waitKey !== `${step}:${title}`) {
    waitKey = `${step}:${title}`;
    waitDone = new Set(members.filter((m) => m.done).map((m) => m.name));
    chips.forEach((chip, i) => popIn(chip, { delay: i * 60 }));
  } else {
    members.forEach((m, i) => {
      if (!m.done || waitDone.has(m.name)) return;
      waitDone.add(m.name);
      popIn(chips[i], { from: 'scale(0.4) rotate(8deg)' });
      window.setTimeout(() => burstAt(chips[i], { count: 8, spread: 34 }), 200);
    });
  }
  waitPart('skip').hidden = !canSkip;

  if (deadline !== waitDeadline) {
    waitDeadline = deadline;
    waitTimer?.stop();
    waitTimer = null;
    const box = waitPart('timer');
    box.hidden = remaining === null;
    if (remaining !== null) {
      waitTimer = createTimer({
        seconds: Math.max(0, remaining),
        pausable: false,
        onTick: (left) => {
          waitPart('seconds').textContent = left;
          box.style.setProperty('--left', String(Math.min(1, left / (total || 90))));
          box.classList.toggle('is-hurry', left <= 10);
          if (left <= 10) bump(waitPart('seconds'));
        },
        onEnd: () => {},
      });
    }
  }
  showScreen('wait');
}

/** みんなを待つ画面の後片づけ */
export function stopWait() {
  waitTimer?.stop();
  waitTimer = null;
  waitDeadline = null;
  waitKey = '';
}

export { memberChip };

export const roomActions = {
  'entry-go': () => submitEntry(),
  'lobby-copy': () => copyUrl(),
  'lobby-start': () => lobbyHandlers.start?.(),
  'lobby-time-on': () => lobbyHandlers.setTime?.(true),
  'lobby-time-off': () => lobbyHandlers.setTime?.(false),
  'wait-skip': () => waitHandlers.skip?.(),
};

export { MAX_PLAYERS };
