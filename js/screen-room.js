// 部屋で遊ぶときの画面：名前（と部屋の番号）を入れる画面・待合室・みんなを待つ画面
import { showScreen, showToast, el } from './ui.js';
import { createQrSvg } from './qr.js';
import { createTimer } from './timer.js';
import { popIn, burstAt, bump } from './fx.js';
import { NAME_MAX } from './game.js';
import { normalizeCode, CODE_LENGTH, MIN_PLAYERS, MAX_PLAYERS } from './room.js';

const NAME_KEY = 'atamap.myName';
const TYPE_KEY = 'atamap.roomType';
// この数は online-stream.js の上限と同じにする（画面の部品から、つなぐ部品を読み込まないため、ここにも書く）
const STREAM_MAX = 90;

// ---------- 名前（と部屋の番号）を入れる画面 ----------

const entry = document.querySelector('[data-screen="entry"]');
const entryPart = (name) => entry.querySelector(`[data-entry="${name}"]`);
const codeInput = () => entry.querySelector('#room-code');
const nameInput = () => entry.querySelector('#room-name');

let entryResolve = null;
let entryMode = 'create';
let entryType = loadType();

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
  entryPart('go').disabled = false;
  entryPart('code-field').hidden = !joining || Boolean(code);
  // 部屋を作るときだけ、遊び方（友だちと／配信で）をえらぶ
  entryPart('type-field').hidden = joining;
  setType(entryType);
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
  entryPart('go').textContent = busy ? 'つないでいます…' : goText();
}

function goText() {
  if (entryMode === 'join') return '入る';
  return entryType === 'stream' ? '配信の部屋を作る' : '部屋を作る';
}

function setType(type) {
  entryType = type === 'stream' ? 'stream' : 'party';
  entry.querySelectorAll('[data-action="entry-type"]').forEach((button) => {
    const on = button.dataset.type === entryType;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-checked', String(on));
  });
  entryPart('type-hint').textContent = entryType === 'stream'
    ? `あなたがずっと主役。見ている人がスマホで当てます（${STREAM_MAX}人まで）`
    : `${MIN_PLAYERS}〜${MAX_PLAYERS}人。みんなが自分のスマホで遊びます`;
  if (entryMode !== 'join') entryPart('go').textContent = goText();
  if (entryMode !== 'join') entryPart('guide').textContent = entryType === 'stream' ? 'あなたの名前を入れてね（配信者の名前になります）' : 'あなたの名前を入れてね（ホストになります）';
}

function loadType() {
  try {
    return localStorage.getItem(TYPE_KEY) === 'stream' ? 'stream' : 'party';
  } catch {
    return 'party';
  }
}

function saveType(type) {
  try {
    localStorage.setItem(TYPE_KEY, type);
  } catch {
    // 覚えられなくても遊べる
  }
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
  if (entryMode !== 'join') saveType(entryType);
  const resolve = entryResolve;
  entryResolve = null;
  resolve({ name, code, type: entryMode === 'join' ? '' : entryType });
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
export function showLobby({ code, url, members, uid, isHost, timeOn, topicMode = 'いつものお題', stream = null, handlers }) {
  lobbyHandlers = handlers;
  // 配信で遊ぶとき：見ている人の数と、配信用の画面を開くボタン
  lobby.classList.toggle('is-stream', Boolean(stream));
  lobbyPart('label').textContent = stream ? '配信の部屋の番号' : '部屋の番号';
  lobbyPart('count-note').textContent = stream ? `人が参加中（${stream.max}人まで）` : `人（${MIN_PLAYERS}〜${MAX_PLAYERS}人で遊べます）`;
  lobbyPart('note').hidden = !stream;
  lobbyPart('cast').hidden = !stream;
  // 配信の設定は、遊び方の「?」のかわりに出す（遊び方はトップからも見られる）
  lobbyPart('settings').hidden = !stream || !isHost;
  lobbyPart('help').hidden = Boolean(stream && isHost);
  lobbyPart('actions').classList.toggle('actions--split', Boolean(stream));
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
  lobbyPart('count').textContent = stream ? stream.count : members.length;
  if (lobbyCode !== code) {
    lobbyCode = code;
    lobbySeen = new Set();
  }
  // 配信のときは人数が多いので、新しく入った人から入るだけ出す
  const shown = stream ? members.slice(0, 24) : members;
  const chips = shown.map((m) => memberChip(m, { isMe: m.uid === uid, isHost: m.isHost }));
  lobbyPart('members').replaceChildren(...chips);
  shown.forEach((m, i) => {
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

  // お題のえらび方：ホストだけが変えられる
  lobbyPart('topic').textContent = topicMode;
  lobbyPart('topic').disabled = !isHost;

  const start = lobbyPart('start');
  if (stream) {
    start.disabled = !stream.count;
    start.textContent = stream.count ? `${stream.count}人ではじめる` : '見ている人を待っています';
  } else if (!isHost) {
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
  if (stream) fitMembers();
}

// 配信のときは、入りきらない名前を出さない（画面をスクロールさせないため）
function fitMembers() {
  const list = lobbyPart('members');
  const items = [...list.children];
  items.forEach((item) => (item.hidden = false));
  const limit = list.getBoundingClientRect().bottom + 1;
  for (const item of items) {
    if (item.getBoundingClientRect().bottom > limit) item.hidden = true;
  }
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
  // 次に出す画面に、前の残り時間が残らないように
  waitPart('timer').hidden = true;
  waitKey = '';
}

export { memberChip };

export const roomActions = {
  'entry-go': () => submitEntry(),
  'entry-type': (button) => setType(button.dataset.type),
  'lobby-copy': () => copyUrl(),
  'lobby-start': () => lobbyHandlers.start?.(),
  'lobby-time-on': () => lobbyHandlers.setTime?.(true),
  'lobby-time-off': () => lobbyHandlers.setTime?.(false),
  'lobby-topic': () => lobbyHandlers.topic?.(),
  'lobby-cast': () => lobbyHandlers.openCast?.(),
  'lobby-settings': () => lobbyHandlers.settings?.(),
  'wait-skip': () => waitHandlers.skip?.(),
};

export { MAX_PLAYERS };
