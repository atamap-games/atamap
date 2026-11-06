// 各自のスマホで遊ぶ（部屋を作る・部屋に入る）ときの流れ。
// 部屋を作った人（ホスト）のスマホが、ゲームを進める役をする。
//   待合室 → 全員同時にマップ作り → 主役の発表 → 主役以外が同時に予想 → 1ワードずつ答え合わせ → まとめ →（次の主役）… → 最終結果
// ほかの人のスマホは、部屋のデータ（Firebase）が変わるたびに、同じ画面を出す。
import { showToast, closeSheet } from './ui.js';
import { loadTopics } from './topics.js';
import { connect, useEmulator } from './net.js';
import { TIME_LIMIT, PLAYER_COLORS } from './game.js';
import {
  makeCode, encodePlacements, playersInOrder, toGame, dealTopics, pickRerollTopic, guessersOf,
  MIN_PLAYERS, MAX_PLAYERS,
} from './room.js';
import { askEntry, setEntryBusy, showLobby, showWait, stopWait } from './screen-room.js';
import { runPlace, stopPlace } from './screen-place.js';
import { showRound } from './screen-round.js';
import { showRevealAt, stopReveal } from './screen-reveal.js';
import { showEnd } from './screen-end.js';
import { recordMaps } from './stats.js';
import { decodePlacements } from './room.js';

// 締め切りのあと、遅れて届く人を待つ時間
const GRACE_MS = 3000;
// ロックしたあと、待つ画面へ移るまで少し待つ（「ロックしました！」が見えるように）
const AFTER_LOCK_MS = 600;
// 制限時間に足す、画面が切りかわるあいだの時間
const START_BUFFER_MS = 1500;
const TIME_KEY = 'atamap.timeLimit';
// 今いる部屋（ページを開き直したときに、同じ部屋へ自動でもどるため。このタブのあいだだけ覚える）
const ROOM_KEY = 'atamap.room';

let session = null;

class UserError extends Error {}

/** 部屋に入っているか */
export function isOnline() {
  return Boolean(session);
}

/** 「←」で出るときの確かめの文 */
export function leaveTexts() {
  const isHost = session?.room?.meta?.hostUid === session?.uid;
  if (!session?.room) return { title: 'やめますか？', text: '', ok: 'やめる' };
  return isHost
    ? { title: '部屋を閉じますか？', text: 'ホストが出ると、みんなのゲームも終わります。', ok: '閉じる' }
    : { title: '部屋を出ますか？', text: 'ゲームのとちゅうなら、あなたの分は0点になります。', ok: '出る' };
}

/**
 * 部屋を作る・部屋に入る。
 * @param {object} options
 * @param {'create'|'join'} options.mode
 * @param {string} [options.code] わかっている部屋の番号（QRコードやURLから来たとき）
 * @param {boolean} [options.auto] 名前を聞かずに入る（ページを開き直して、同じ部屋にもどるとき）
 * @param {() => void} options.onExit 部屋を出たときに呼ばれる
 */
export async function startOnline({ mode, code = '', auto = false, onExit }) {
  if (session) return;
  const me = { mode, onExit, view: '', closed: false, room: null, timers: [] };
  session = me;
  try {
    me.topics = await loadTopics();
    let error = '';
    let knownCode = code;
    let autoName = auto ? savedName() : '';
    for (;;) {
      const entry = autoName ? { name: autoName, code: knownCode } : await askEntry({ mode, code: knownCode, error });
      autoName = '';
      if (me.closed) return;
      setEntryBusy(true);
      try {
        me.net = await connect();
        if (me.closed) return;
        me.uid = me.net.uid;
        me.code = mode === 'create' ? await createRoom(me.net, entry.name) : await joinRoom(me.net, entry.code, entry.name);
        break;
      } catch (err) {
        if (me.closed) return;
        if (err instanceof UserError) {
          error = err.message;
          knownCode = '';
        } else {
          console.error(err);
          error = 'つながりませんでした。通信を確かめて、もう一度ためしてね';
        }
      } finally {
        setEntryBusy(false);
      }
    }
    if (me.closed) return;
    rememberRoom(me.code);
    // 通信が切れたら「いない」と分かるようにする
    const onlinePath = `rooms/${me.code}/players/${me.uid}/online`;
    await me.net.set(onlinePath, true);
    me.net.onDisconnectSet(onlinePath, false);
    me.unwatch = me.net.watch(`rooms/${me.code}`, (room) => onRoom(me, room));
  } catch (err) {
    console.error(err);
    showToast('うまくつながりませんでした。もう一度ためしてね');
    leave(me, { silent: true });
  }
}

/** 部屋を出る（トップへもどるときなど） */
export function leaveOnline() {
  if (session) leave(session);
}

/** ページを開き直したときにもどる部屋（なければ空文字） */
export function rememberedRoom() {
  try {
    return sessionStorage.getItem(ROOM_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberRoom(code) {
  try {
    if (code) sessionStorage.setItem(ROOM_KEY, code);
    else sessionStorage.removeItem(ROOM_KEY);
  } catch {
    // 覚えられなくても遊べる（開き直したときに、番号を入れ直す）
  }
}

function savedName() {
  try {
    return localStorage.getItem('atamap.myName') ?? '';
  } catch {
    return '';
  }
}

// ---------- 部屋を作る・入る ----------

async function createRoom(net, name) {
  for (let i = 0; i < 6; i++) {
    const code = makeCode();
    if (await net.get(`rooms/${code}/meta`)) continue;
    await net.set(`rooms/${code}/meta`, { hostUid: net.uid, createdAt: net.serverTime(), status: 'lobby', timeLimit: loadTimeLimit() });
    await net.set(`rooms/${code}/players/${net.uid}`, { name, joinedAt: net.serverTime(), online: true });
    return code;
  }
  throw new Error('部屋の番号が作れませんでした');
}

async function joinRoom(net, code, name) {
  const meta = await net.get(`rooms/${code}/meta`);
  if (!meta || meta.status === 'closed') throw new UserError(`部屋「${code}」が見つかりませんでした。番号を確かめてね`);
  const players = (await net.get(`rooms/${code}/players`)) ?? {};
  const already = players[net.uid];
  if (!already) {
    if (meta.status !== 'lobby') throw new UserError('この部屋は、もうゲームをはじめています');
    if (Object.keys(players).length >= MAX_PLAYERS) throw new UserError(`この部屋はいっぱいです（${MAX_PLAYERS}人まで）`);
  }
  await net.set(`rooms/${code}/players/${net.uid}`, { name, joinedAt: already?.joinedAt ?? net.serverTime(), online: true });
  return code;
}

function loadTimeLimit() {
  try {
    return localStorage.getItem(TIME_KEY) === 'off' ? 0 : TIME_LIMIT;
  } catch {
    return TIME_LIMIT;
  }
}

function joinUrl(code) {
  const params = new URLSearchParams({ room: code });
  if (useEmulator()) params.set('emulator', '');
  return `${location.origin}${location.pathname}?${params.toString().replace(/=$|=(?=&)/g, '')}`;
}

// ---------- 部屋のデータが変わったとき ----------

function onRoom(me, room) {
  if (me.closed) return;
  me.room = room;
  if (!room?.meta || room.meta.status === 'closed') {
    showToast('ホストが部屋を閉じました');
    leave(me, { silent: true });
    return;
  }
  if (!room.players?.[me.uid]) {
    showToast('部屋から出ました');
    leave(me, { silent: true });
    return;
  }
  const isHost = room.meta.hostUid === me.uid;
  if (isHost) direct(me, room);
  // ホストが進めると、その新しいデータでこの関数がもう一度呼ばれ、画面も出し直している。
  // そのときは、ここで古いデータの画面を出さない
  if (me.room !== room) return;
  render(me, room, isHost);
}

// 今の画面と同じなら作り直さない（置いているとちゅうのワードが消えないように）
function enterView(me, key) {
  if (me.view === key) return false;
  if (me.view.startsWith('place:')) stopPlace();
  if (me.view.startsWith('wait:')) stopWait();
  if (me.view.startsWith('reveal:')) stopReveal();
  me.view = key;
  return true;
}

function render(me, room, isHost) {
  // ロックした直後は、少しのあいだ「ロックしました！」を見せてから画面を切りかえる
  const hold = (me.holdUntil ?? 0) - Date.now();
  if (hold > 0 && me.view.startsWith('place:')) {
    window.clearTimeout(me.holdTimer);
    me.holdTimer = window.setTimeout(() => !me.closed && me.room && render(me, me.room, me.room.meta?.hostUid === me.uid), hold + 20);
    return;
  }
  const s = room.state ?? {};
  const phase = s.phase ?? 'lobby';
  const game = s.gameNo ?? 0;
  const order = s.order ?? [];

  if (phase === 'lobby' || room.meta.status === 'lobby') {
    enterView(me, 'lobby');
    showLobby({
      code: me.code,
      url: joinUrl(me.code),
      members: playersInOrder(room).map((p, i) => ({ ...p, color: PLAYER_COLORS[i % PLAYER_COLORS.length], isHost: p.uid === room.meta.hostUid })),
      uid: me.uid,
      isHost,
      timeOn: Boolean(room.meta.timeLimit),
      handlers: { start: () => hostStartGame(me), setTime: (on) => hostSetTime(me, on) },
    });
    return;
  }

  if (!order.includes(me.uid)) {
    // ゲームのあとから入った人（ふつうは入れないが、念のため）
    if (enterView(me, `wait:watch:${game}`)) stopPlace();
    showWait({ step: '見学中', title: 'ゲームのとちゅうです', text: '次のゲームから参加できます', members: statusList(me, room, order, () => false), remaining: null, canSkip: false, handlers: {} });
    return;
  }

  if (phase === 'make') {
    if (room.maps?.[me.uid]?.done) {
      enterView(me, `wait:make:${game}`);
      showWait({
        step: 'マップ作り',
        title: 'みんながマップを作っています',
        text: 'ロックしました。全員がそろうと、次に進みます',
        members: statusList(me, room, order, (uid) => room.maps?.[uid]?.done),
        remaining: remainingSeconds(me, s.deadline),
        deadline: s.deadline ?? null,
        total: room.meta.timeLimit,
        canSkip: isHost,
        handlers: { skip: () => hostStartRounds(me) },
      });
    } else if (enterView(me, `place:make:${game}`)) {
      startMake(me, room);
    }
    return;
  }

  const mains = s.mains ?? order;
  const mainUid = s.mainUid;
  const round = (s.roundIndex ?? 0) + 1;
  const main = playerOf(room, mainUid);
  const topic = me.topics.find((t) => t.id === room.maps?.[mainUid]?.topicId);
  if (!main || !topic) return;

  if (phase === 'round') {
    if (enterView(me, `round:${game}:${round}`)) {
      showRound({ main, topic, round, rounds: mains.length, canAdvance: isHost, isMe: mainUid === me.uid })
        .then(() => isHost && hostStartGuess(me));
    }
    return;
  }

  if (phase === 'guess') {
    const isMain = mainUid === me.uid;
    if (isMain || room.guesses?.[mainUid]?.[me.uid]?.done) {
      enterView(me, `wait:guess:${game}:${round}`);
      showWait({
        step: `ラウンド ${round}/${mains.length}・予想`,
        title: isMain ? 'みんなが予想しています' : 'みんなを待っています',
        text: isMain ? 'あなたが主役です。みんなの予想を待とう' : '予想を決めました。全員がそろうと、答え合わせです',
        members: statusList(me, room, guessersOf(room, mainUid), (uid) => room.guesses?.[mainUid]?.[uid]?.done),
        remaining: remainingSeconds(me, s.deadline),
        deadline: s.deadline ?? null,
        total: room.meta.timeLimit,
        canSkip: isHost,
        handlers: { skip: () => hostStartReveal(me) },
      });
    } else if (enterView(me, `place:guess:${game}:${round}`)) {
      startGuess(me, room, main, topic);
    }
    return;
  }

  if (phase === 'reveal' || phase === 'summary') {
    const index = phase === 'summary' ? topic.words.length : (s.wordIndex ?? 0);
    if (enterView(me, `reveal:${game}:${round}:${index}`)) {
      showRevealAt({
        game: toGame(room),
        main,
        topic,
        isLast: round >= mains.length,
        index,
        canAdvance: isHost,
        onNext: () => hostNextReveal(me),
      });
    }
    return;
  }

  if (phase === 'end') {
    if (enterView(me, `end:${game}`)) {
      showEnd({ game: toGame(room), topics: me.topics, canRestart: isHost }).then((next) => {
        if (next === 'again' && isHost) hostRestart(me);
        else leave(me);
      });
    }
  }
}

function playerOf(room, uid) {
  const order = room.state?.order ?? [];
  const index = order.indexOf(uid);
  const p = room.players?.[uid];
  if (!p || index < 0) return null;
  return { id: uid, name: p.name, color: PLAYER_COLORS[index % PLAYER_COLORS.length] };
}

function statusList(me, room, uids, isDone) {
  return uids.map((uid) => {
    const p = playerOf(room, uid) ?? { name: room.players?.[uid]?.name ?? '（退出）', color: PLAYER_COLORS[7] };
    return { name: p.name, color: p.color, done: Boolean(isDone(uid)), online: room.players?.[uid]?.online !== false, isMe: uid === me.uid };
  });
}

function remainingSeconds(me, deadline) {
  return deadline ? Math.max(0, (deadline - me.net.now()) / 1000) : null;
}

// ---------- 自分のマップ・予想 ----------

function startMake(me, room) {
  const s = room.state;
  const topic = me.topics.find((t) => t.id === room.topics?.[me.uid]) ?? me.topics[0];
  const remaining = remainingSeconds(me, s.deadline);
  runPlace({
    mode: 'make',
    player: playerOf(room, me.uid),
    topic,
    // 引き直し：ほかの人が使っていないお題を選び、部屋のデータにも書く
    reroll: () => {
      const next = pickRerollTopic(me.room, me.uid, me.topics);
      me.net.set(`rooms/${me.code}/topics/${me.uid}`, next.id).catch((err) => console.error(err));
      return next;
    },
    timeLimit: remaining === null ? 0 : Math.max(0.2, remaining),
    timeTotal: room.meta.timeLimit,
    pausable: false,
  }).then(async (result) => {
    if (me.closed) return;
    me.holdUntil = Date.now() + AFTER_LOCK_MS;
    await me.net.set(`rooms/${me.code}/maps/${me.uid}`, {
      topicId: result.topicId,
      rerolled: result.rerolled,
      timeUp: result.timeUp,
      done: true,
      placements: encodePlacements(result.placements),
    });
  }).catch((err) => {
    console.error(err);
    showToast('マップを送れませんでした。通信を確かめてね');
  });
}

function startGuess(me, room, main, topic) {
  const s = room.state;
  const remaining = remainingSeconds(me, s.deadline);
  runPlace({
    mode: 'guess',
    player: playerOf(room, me.uid),
    main,
    topic,
    timeLimit: remaining === null ? 0 : Math.max(0.2, remaining),
    timeTotal: room.meta.timeLimit,
    pausable: false,
  }).then(async (result) => {
    if (me.closed) return;
    me.holdUntil = Date.now() + AFTER_LOCK_MS;
    await me.net.set(`rooms/${me.code}/guesses/${main.id}/${me.uid}`, {
      timeUp: result.timeUp,
      done: true,
      placements: encodePlacements(result.placements),
    });
  }).catch((err) => {
    console.error(err);
    showToast('予想を送れませんでした。通信を確かめてね');
  });
}

// ---------- ホストがゲームを進める ----------

// 全員がそろったか、締め切りを過ぎたら、次に進める
function direct(me, room) {
  for (const t of me.timers) window.clearTimeout(t);
  me.timers = [];
  const s = room.state ?? {};
  const now = me.net.now();
  const late = s.deadline && now > s.deadline + GRACE_MS;
  const later = () => {
    if (!s.deadline) return;
    me.timers.push(window.setTimeout(() => me.room && !me.closed && direct(me, me.room), s.deadline + GRACE_MS - now + 100));
  };

  if (s.phase === 'make') {
    const order = s.order ?? [];
    const done = order.filter((uid) => room.maps?.[uid]?.done);
    if (done.length === order.length || late) hostStartRounds(me);
    else later();
  } else if (s.phase === 'guess') {
    const guessers = guessersOf(room, s.mainUid);
    const done = guessers.filter((uid) => room.guesses?.[s.mainUid]?.[uid]?.done);
    if (done.length === guessers.length || late) hostStartReveal(me);
    else later();
  } else if (s.phase === 'end' && me.recorded !== `${me.code}:${s.gameNo}`) {
    // ゲームが終わったら、ワードごとの置き場所を記録する（お題の見直しに使う。ホストが1回だけ）
    me.recorded = `${me.code}:${s.gameNo}`;
    const maps = Object.values(room.maps ?? {})
      .filter((m) => m?.done)
      .map((m) => ({ topicId: m.topicId, timeUp: Boolean(m.timeUp), placements: decodePlacements(m.placements) }));
    recordMaps(me.net, maps, me.topics).catch((err) => console.error(err));
  }
}

// 同じ進め方を2回しないように、進めた場所を覚えておく
function once(me, key) {
  if (me.advanced === key) return false;
  me.advanced = key;
  return true;
}

function stateKey(room) {
  const s = room?.state ?? {};
  return `${s.gameNo ?? 0}:${s.phase ?? 'lobby'}:${s.roundIndex ?? 0}:${s.wordIndex ?? 0}`;
}

function updateState(me, patch) {
  return me.net.update(`rooms/${me.code}/state`, patch).catch((err) => {
    console.error(err);
    me.advanced = null;
    showToast('うまく進められませんでした。もう一度押してね');
  });
}

function hostSetTime(me, on) {
  try {
    localStorage.setItem(TIME_KEY, on ? 'on' : 'off');
  } catch {
    // 覚えられなくても遊べる
  }
  me.net.update(`rooms/${me.code}/meta`, { timeLimit: on ? TIME_LIMIT : 0 }).catch((err) => console.error(err));
}

function newGameUpdate(me, room, order) {
  const s = room.state ?? {};
  const timeLimit = room.meta.timeLimit ?? 0;
  const values = {
    'meta/status': 'playing',
    state: {
      phase: 'make',
      order,
      gameNo: (s.gameNo ?? 0) + 1,
      roundIndex: 0,
      wordIndex: 0,
      deadline: timeLimit ? me.net.now() + timeLimit * 1000 + START_BUFFER_MS : null,
    },
  };
  for (const [uid, topicId] of Object.entries(dealTopics(order, me.topics))) values[`topics/${uid}`] = topicId;
  // 前のゲームのマップと予想を消す
  for (const uid of Object.keys(room.maps ?? {})) values[`maps/${uid}`] = null;
  for (const [mainUid, byGuesser] of Object.entries(room.guesses ?? {})) {
    for (const uid of Object.keys(byGuesser ?? {})) values[`guesses/${mainUid}/${uid}`] = null;
  }
  return values;
}

function hostStartGame(me) {
  const room = me.room;
  const order = playersInOrder(room).map((p) => p.uid);
  if (order.length < MIN_PLAYERS || !once(me, `start:${stateKey(room)}`)) return;
  me.net.update(`rooms/${me.code}`, newGameUpdate(me, room, order)).catch((err) => {
    console.error(err);
    me.advanced = null;
    showToast('はじめられませんでした。もう一度押してね');
  });
}

function hostRestart(me) {
  const room = me.room;
  // 今も部屋にいる人で、もう一度
  const order = (room.state?.order ?? []).filter((uid) => room.players?.[uid]);
  if (order.length < MIN_PLAYERS) {
    showToast(`${MIN_PLAYERS}人そろっていないので、待合室にもどります`);
    me.net.update(`rooms/${me.code}`, { 'meta/status': 'lobby', state: null }).catch((err) => console.error(err));
    return;
  }
  if (!once(me, `restart:${stateKey(room)}`)) return;
  me.net.update(`rooms/${me.code}`, newGameUpdate(me, room, order)).catch((err) => console.error(err));
}

function hostStartRounds(me) {
  const room = me.room;
  const s = room.state;
  if (s?.phase !== 'make' || !once(me, `rounds:${stateKey(room)}`)) return;
  const mains = (s.order ?? []).filter((uid) => room.maps?.[uid]?.done);
  if (!mains.length) {
    updateState(me, { phase: 'end', deadline: null, mains: [] });
    return;
  }
  updateState(me, { phase: 'round', mains, roundIndex: 0, mainUid: mains[0], wordIndex: 0, deadline: null });
}

function hostStartGuess(me) {
  const room = me.room;
  const s = room.state;
  if (s?.phase !== 'round' || !once(me, `guess:${stateKey(room)}`)) return;
  const timeLimit = room.meta.timeLimit ?? 0;
  updateState(me, { phase: 'guess', deadline: timeLimit ? me.net.now() + timeLimit * 1000 + START_BUFFER_MS : null });
}

function hostStartReveal(me) {
  const room = me.room;
  const s = room.state;
  if (s?.phase !== 'guess' || !once(me, `reveal:${stateKey(room)}`)) return;
  updateState(me, { phase: 'reveal', wordIndex: 0, deadline: null });
}

function hostNextReveal(me) {
  const room = me.room;
  const s = room.state;
  if (!once(me, `next:${stateKey(room)}`)) return;
  const words = me.topics.find((t) => t.id === room.maps?.[s.mainUid]?.topicId)?.words.length ?? 5;
  if (s.phase === 'reveal') {
    if ((s.wordIndex ?? 0) < words - 1) updateState(me, { wordIndex: (s.wordIndex ?? 0) + 1 });
    else updateState(me, { phase: 'summary' });
  } else if (s.phase === 'summary') {
    const mains = s.mains ?? [];
    const next = (s.roundIndex ?? 0) + 1;
    if (next < mains.length) updateState(me, { phase: 'round', roundIndex: next, mainUid: mains[next], wordIndex: 0 });
    else updateState(me, { phase: 'end' });
  }
}

// ---------- 部屋を出る ----------

async function leave(me, { silent = false } = {}) {
  if (me.closed) return;
  me.closed = true;
  me.unwatch?.();
  for (const t of me.timers) window.clearTimeout(t);
  window.clearTimeout(me.holdTimer);
  stopPlace();
  stopWait();
  stopReveal();
  closeSheet('quit');
  closeSheet('share');
  rememberRoom('');
  if (session === me) session = null;
  if (me.net && me.code && !silent) {
    const room = me.room;
    const base = `rooms/${me.code}`;
    try {
      await me.net.cancelOnDisconnect(`${base}/players/${me.uid}/online`);
      if (room?.meta?.hostUid === me.uid) {
        await me.net.update(`${base}/meta`, { status: 'closed' });
      } else if (!room || room.meta?.status === 'lobby') {
        await me.net.remove(`${base}/players/${me.uid}`);
      } else {
        await me.net.set(`${base}/players/${me.uid}/online`, false);
      }
    } catch (err) {
      console.error(err);
    }
  }
  me.onExit();
}
