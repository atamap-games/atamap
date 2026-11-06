// 遊ぶ人の名前を入れる画面（1台のスマホを回して遊ぶとき）
import { showScreen, el } from './ui.js';
import { MIN_PLAYERS, MAX_PLAYERS, NAME_MAX, TIME_LIMIT } from './game.js';

const screen = document.querySelector('[data-screen="players"]');
const part = (name) => screen.querySelector(`[data-players="${name}"]`);

// 前に入れた名前を、このブラウザにだけ覚えておく（次に遊ぶときに便利なように）
const STORAGE_KEY = 'atamap.players';
const TIME_KEY = 'atamap.timeLimit';

let count = 4;
let names = [];
let timeOn = true;
let resolveCurrent = null;

/**
 * 名前と制限時間を決めてもらう。
 * @returns {Promise<{ names: string[], timeLimit: number }>} 遊ぶ人の名前（入れていない人は「プレイヤー1」のような名前にする）と、制限時間（秒。0 は制限なし）
 */
export function askPlayers() {
  const saved = load();
  if (saved.length >= MIN_PLAYERS) {
    names = saved;
    count = saved.length;
  }
  timeOn = loadTimeOn();
  render();
  showScreen('players');
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}

function render() {
  part('count').textContent = count;
  for (const [key, on] of [['time-on', true], ['time-off', false]]) {
    const button = part(key);
    button.classList.toggle('is-on', timeOn === on);
    button.setAttribute('aria-checked', String(timeOn === on));
  }
  screen.querySelector('[data-action="players-minus"]').disabled = count <= MIN_PLAYERS;
  screen.querySelector('[data-action="players-plus"]').disabled = count >= MAX_PLAYERS;
  const list = part('names');
  const inputs = [];
  for (let i = 0; i < count; i++) {
    const input = el('input', 'name-input');
    input.type = 'text';
    input.id = `player-name-${i + 1}`;
    input.maxLength = NAME_MAX;
    input.placeholder = `プレイヤー${i + 1}`;
    input.value = names[i] ?? '';
    input.autocomplete = 'off';
    input.enterKeyHint = i === count - 1 ? 'done' : 'next';
    input.setAttribute('aria-label', `${i + 1}人目の名前`);
    input.addEventListener('input', () => {
      names[i] = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const next = list.querySelector(`#player-name-${i + 2}`);
      if (next) next.focus();
      else input.blur();
    });
    const label = el('label', 'name-field');
    label.append(el('span', 'name-field__num', String(i + 1)), input);
    inputs.push(label);
  }
  list.replaceChildren(...inputs);
}

function finalNames() {
  const result = [];
  for (let i = 0; i < count; i++) {
    const name = (names[i] ?? '').trim().slice(0, NAME_MAX) || `プレイヤー${i + 1}`;
    result.push(name);
  }
  return result;
}

function load() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((n) => typeof n === 'string').slice(0, MAX_PLAYERS) : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    localStorage.setItem(TIME_KEY, timeOn ? 'on' : 'off');
  } catch {
    // 覚えられなくても遊べるので、何もしない
  }
}

function loadTimeOn() {
  try {
    return localStorage.getItem(TIME_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const playersActions = {
  'players-minus': () => {
    if (count <= MIN_PLAYERS) return;
    count -= 1;
    render();
  },
  'players-plus': () => {
    if (count >= MAX_PLAYERS) return;
    count += 1;
    render();
  },
  'time-on': () => {
    timeOn = true;
    render();
  },
  'time-off': () => {
    timeOn = false;
    render();
  },
  'players-start': () => {
    if (!resolveCurrent) return;
    document.activeElement?.blur?.();
    const result = finalNames();
    save(result);
    const resolve = resolveCurrent;
    resolveCurrent = null;
    resolve({ names: result, timeLimit: timeOn ? TIME_LIMIT : 0 });
  },
};
