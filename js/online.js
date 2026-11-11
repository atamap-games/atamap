// 各自のスマホで遊ぶ（部屋を作る・部屋に入る）ときの流れ。
// 部屋を作った人（ホスト）のスマホが、ゲームを進める役をする。
//   待合室 →（主役を順番に回す：主役がマップを作ってロック → 主役以外が同時に予想 → 1ワードずつ答え合わせ → まとめ）… → 最終結果
// 答え合わせを進めるボタンは主役のスマホにある（主役がホストでなければ、ホストにお願いを送って進めてもらう）。
// ほかの人のスマホは、部屋のデータ（Firebase）が変わるたびに、同じ画面を出す。
import { showToast, closeSheet } from './ui.js';
import { loadTopics } from './topics.js';
import { connect } from './net.js';
import { TIME_LIMIT, PLAYER_COLORS } from './game.js';
import {
  makeCode, encodePlacements, playersInOrder, toGame, pickRerollTopic, guessersOf,
  MIN_PLAYERS, MAX_PLAYERS,
} from './room.js';
import { askEntry, setEntryBusy, showLobby, showWait, stopWait } from './screen-room.js';
import { runPlace, stopPlace } from './screen-place.js';
import { showMaking, stopMaking } from './screen-round.js';
import { showRevealAt, stopReveal } from './screen-reveal.js';
import { showEnd } from './screen-end.js';
import { recordMaps } from './stats.js';
import { editTopic, closeEditor } from './screen-maketopic.js';
import { openTopicMode, openMyTopics, TOPIC_MODES } from './screen-mytopics.js';
import { assignMadeTopics, chosenMyTopics, isCustomTopic, shuffle } from './custom.js';
import { decodePlacements } from './room.js';
import { stopCast } from './screen-cast.js';
import {
  joinUrl, createStreamRoom, joinStreamRoom, startStream, stopStream, streamLeaveTexts, leaveStreamRoom,
} from './online-stream.js';

// 「みんなで作る」で、お題を作る時間（秒。制限時間ありのとき）
const CREATE_SECONDS = 150;
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
  if (session?.stream) return streamLeaveTexts(session);
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
        me.code = mode === 'create' ? await createRoom(me, entry.name, entry.type) : await joinRoom(me, entry.code, entry.name);
        break;
      } catch (err) {
        if (me.closed) return;
        if (err instanceof UserError) {
          error = err.message;
          knownCode = '';
        } else {
          console.error(err);
          error = explainError(err);
        }
      } finally {
        setEntryBusy(false);
      }
    }
    if (me.closed) return;
    rememberRoom(me.code);
    // 配信で遊ぶ部屋は、online-stream.js が受け持つ
    if (me.stream) {
      startStream(me, {
        leave: (options) => leave(me, options),
        enterView: (key) => enterView(me, key),
        setTime: (on) => hostSetTime(me, on),
      });
      return;
    }
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

// つながらなかった理由を、分かる言葉にする（Firebase の設定が足りないときに、何を直せばよいか分かるように）
function explainError(err) {
  const code = String(err?.code ?? '');
  const text = `${code} ${err?.message ?? ''}`;
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return 'つながりませんでした：Firebase の「匿名」ログインがオフのようです（Authentication の設定）';
  }
  if (/permission[_ ]denied/i.test(text)) {
    return 'つながりませんでした：Firebase のデータベースのルールが、まだ設定されていないようです';
  }
  if (code === 'auth/network-request-failed' || /failed to fetch|import|load/i.test(text)) {
    return 'つながりませんでした。通信を確かめて、もう一度ためしてね';
  }
  return `つながりませんでした（${code || err?.name || 'ふめい'}）。もう一度ためしてね`;
}

// ---------- 部屋を作る・入る ----------

async function createRoom(me, name, type) {
  const net = me.net;
  for (let i = 0; i < 6; i++) {
    const code = makeCode();
    if (await net.get(`rooms/${code}/meta`)) continue;
    if (type === 'stream') {
      await createStreamRoom(net, code, name, loadTimeLimit());
      me.stream = true;
      me.isHost = true;
      return code;
    }
    await net.set(`rooms/${code}/meta`, { hostUid: net.uid, createdAt: net.serverTime(), status: 'lobby', timeLimit: loadTimeLimit() });
    await net.set(`rooms/${code}/players/${net.uid}`, { name, joinedAt: net.serverTime(), online: true });
    return code;
  }
  throw new Error('部屋の番号が作れませんでした');
}

async function joinRoom(me, code, name) {
  const net = me.net;
  const meta = await net.get(`rooms/${code}/meta`);
  if (!meta || meta.status === 'closed') throw new UserError(`部屋「${code}」が見つかりませんでした。番号を確かめてね`);
  // 配信で遊ぶ部屋：人数の上限が多く、ゲームのとちゅうでも入れる
  if (meta.type === 'stream') {
    const reason = await joinStreamRoom(net, code, meta, name);
    if (reason) throw new UserError(reason);
    me.stream = true;
    me.isHost = meta.hostUid === net.uid;
    return code;
  }
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
  if (me.view.startsWith('making:')) stopMaking();
  if (me.view.startsWith('create:')) closeEditor();
  if (me.view.startsWith('cast:')) stopCast();
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
      topicMode: TOPIC_MODES[room.meta.topicMode] ? (room.meta.topicMode === 'mine' ? 'ホストのマイお題' : TOPIC_MODES[room.meta.topicMode]) : TOPIC_MODES.standard,
      handlers: { start: () => hostStartGame(me), setTime: (on) => hostSetTime(me, on), topic: () => hostChooseTopicMode(me) },
    });
    return;
  }

  if (!order.includes(me.uid)) {
    // ゲームのあとから入った人（ふつうは入れないが、念のため）
    enterView(me, `wait:watch:${game}`);
    showWait({ step: '見学中', title: 'ゲームのとちゅうです', text: '次のゲームから参加できます', members: statusList(me, room, order, () => false), remaining: null, canSkip: false, handlers: {} });
    return;
  }

  if (phase === 'end') {
    if (enterView(me, `end:${game}`)) {
      showEnd({ game: toGame(room), topics: allTopics(me, room), canRestart: isHost }).then((next) => {
        if (next === 'again' && isHost) hostRestart(me);
        else leave(me);
      });
    }
    return;
  }

  // みんなで作る：はじめに全員がお題を1つ作る。作ったら、みんなを待つ
  if (phase === 'create') {
    renderCreate(me, room, isHost, game, order);
    return;
  }

  const mainUid = s.mainUid;
  const round = (s.roundIndex ?? 0) + 1;
  const rounds = order.length;
  const main = playerOf(room, mainUid);
  const isMain = mainUid === me.uid;
  const mainOffline = room.players?.[mainUid]?.online === false;
  if (!main) return;

  // 主役がマップを作る：主役はマップを作る画面、ほかの人は主役とお題を先に見て待つ
  if (phase === 'make') {
    if (isMain) {
      if (room.maps?.[me.uid]?.done) {
        enterView(me, `wait:made:${game}:${round}`);
        showWait({ step: `ラウンド ${round}/${rounds}`, title: 'ロックしました！', text: 'みんなの予想が始まります', members: [], remaining: null, canSkip: false, handlers: {} });
      } else if (enterView(me, `place:make:${game}:${round}`)) {
        startMake(me, room);
      }
      return;
    }
    const topic = findTopic(me, room, room.topics?.[mainUid]) ?? me.topics[0];
    enterView(me, `making:${game}:${round}`);
    showMaking({
      key: `${game}:${round}`,
      main,
      topic,
      round,
      rounds,
      remaining: remainingSeconds(me, s.deadline),
      deadline: s.deadline ?? null,
      total: room.meta.timeLimit,
      // ホストは、主役がいなくなったときだけ、とばせる
      canSkip: isHost && mainOffline,
      onSkip: () => hostSkipMain(me),
    });
    return;
  }

  const topic = findTopic(me, room, room.maps?.[mainUid]?.topicId);
  if (!topic) return;

  // 主役以外が予想する：主役は待つ
  if (phase === 'guess') {
    if (isMain || room.guesses?.[mainUid]?.[me.uid]?.done) {
      enterView(me, `wait:guess:${game}:${round}`);
      showWait({
        step: `ラウンド ${round}/${rounds}・予想`,
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

  // 答え合わせ：進めるのは主役（主役がいなくなったときは、ホストが代わりに進められる）
  if (phase === 'reveal' || phase === 'summary') {
    enterView(me, `reveal:${game}`);
    showRevealAt({
      key: `${game}:${round}`,
      game: toGame(room),
      main,
      topic,
      isLast: round >= rounds,
      index: phase === 'summary' ? topic.words.length : (s.wordIndex ?? 0),
      answerShown: Boolean(s.answerShown),
      canAdvance: isMain || (isHost && mainOffline),
      onAnswer: () => control(me, 'answer'),
      onNext: () => control(me, 'next'),
    });
  }
}

// 部屋で使えるお題：いつものお題と、部屋にあるオリジナルのお題（みんなで作った・ホストのマイお題）
function allTopics(me, room) {
  const custom = Object.values(room?.custom ?? {}).filter(isCustomTopic).map((t) => ({ ...t, custom: true }));
  return custom.length ? [...me.topics, ...custom] : me.topics;
}

function findTopic(me, room, id) {
  return allTopics(me, room).find((t) => t.id === id);
}

// お題の札の文字（だれが作ったお題か）
function topicLabel(topic, fallback) {
  if (!topic?.custom) return fallback;
  return topic.author ? `${topic.author}さんが作ったお題` : 'ホストのマイお題';
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
  const topic = findTopic(me, room, room.topics?.[me.uid]) ?? me.topics[0];
  const remaining = remainingSeconds(me, s.deadline);
  runPlace({
    mode: 'make',
    player: playerOf(room, me.uid),
    topic,
    // 引き直し：このゲームでまだ使っていないお題を選び、部屋のデータにも書く（ほかの人の画面のお題も変わる）
    // オリジナルのお題は引き直さない（作った人の気持ちがこもっているので）
    reroll: topic.custom ? null : () => {
      const next = pickRerollTopic(me.room, me.uid, me.topics);
      me.net.set(`rooms/${me.code}/topics/${me.uid}`, next.id).catch((err) => console.error(err));
      return next;
    },
    timeLimit: remaining === null ? 0 : Math.max(0.2, remaining),
    timeTotal: room.meta.timeLimit,
    pausable: false,
    // 主役には、はじめにお題を大きく出す（とちゅうで開き直したときは出さない）
    intro: (remaining === null || remaining > (room.meta.timeLimit || 90) - 10) && topicLabel(topic, 'あなたのお題'),
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

// ---------- 答え合わせを進める（主役のボタン） ----------

// 今の答え合わせの場所（同じボタンが2回効かないように、お願いにこれを付ける）
function controlKey(room) {
  const s = room?.state ?? {};
  return `${s.gameNo ?? 0}:${s.phase}:${s.roundIndex ?? 0}:${s.wordIndex ?? 0}:${s.answerShown ? 1 : 0}`;
}

// 主役が「答えを見る！」「次へ」を押したとき。ホストならそのまま進め、ほかの人ならホストにお願いを送る
function control(me, action) {
  const room = me.room;
  if (!room) return;
  if (room.meta.hostUid === me.uid) {
    applyControl(me, room, action);
    return;
  }
  me.net.set(`rooms/${me.code}/requests/${me.uid}`, { action, key: controlKey(room), at: me.net.serverTime() }).catch((err) => {
    console.error(err);
    showToast('うまく進められませんでした。もう一度押してね');
  });
}

// ホストのスマホで、答え合わせを進める
function applyControl(me, room, action) {
  const s = room.state ?? {};
  if (!once(me, `control:${controlKey(room)}:${action}`)) return;
  if (action === 'answer' && s.phase === 'reveal' && !s.answerShown) {
    updateState(me, { answerShown: true });
  } else if (action === 'next' && s.phase === 'reveal' && s.answerShown) {
    const words = findTopic(me, room, room.maps?.[s.mainUid]?.topicId)?.words.length ?? 5;
    if ((s.wordIndex ?? 0) < words - 1) updateState(me, { wordIndex: (s.wordIndex ?? 0) + 1, answerShown: false });
    else updateState(me, { phase: 'summary' });
  } else if (action === 'next' && s.phase === 'summary') {
    hostNextRound(me);
  }
}

// ---------- ホストがゲームを進める ----------

// 主役がロックしたら予想へ、全員が予想したら答え合わせへ。締め切りを過ぎても進める
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

  if (s.phase === 'create') {
    const order = s.order ?? [];
    // 全員が作り終えたか、締め切りを過ぎたら、お題を配ってゲームを始める
    if (order.every((uid) => room.custom?.[uid]) || late) hostFinishCreate(me);
    else later();
  } else if (s.phase === 'make') {
    if (room.maps?.[s.mainUid]?.done) hostStartGuess(me);
    else if (late) hostSkipMain(me); // 主役が締め切りを過ぎてもロックしない（いなくなった）ときは、とばす
    else later();
  } else if (s.phase === 'guess') {
    const guessers = guessersOf(room, s.mainUid);
    const done = guessers.filter((uid) => room.guesses?.[s.mainUid]?.[uid]?.done);
    if (done.length === guessers.length || late) hostStartReveal(me);
    else later();
  } else if ((s.phase === 'reveal' || s.phase === 'summary') && s.mainUid !== me.uid) {
    // 主役からの「答えを見る！」「次へ」のお願い
    const request = room.requests?.[s.mainUid];
    if (request?.key === controlKey(room)) applyControl(me, room, request.action);
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

function deadlineFrom(me, room) {
  const timeLimit = room.meta.timeLimit ?? 0;
  return timeLimit ? me.net.now() + timeLimit * 1000 + START_BUFFER_MS : null;
}

// このゲームでまだ使っていないお題を1つ選ぶ
function unusedTopic(me, used) {
  const usedSet = new Set(used);
  const pool = me.topics.filter((t) => !usedSet.has(t.id));
  const list = pool.length ? pool : me.topics;
  return list[Math.floor(Math.random() * list.length)];
}

function newGameUpdate(me, room, order) {
  const s = room.state ?? {};
  const mode = room.meta.topicMode ?? 'standard';
  const values = {
    'meta/status': 'playing',
    state: {
      phase: mode === 'make' ? 'create' : 'make',
      order,
      gameNo: (s.gameNo ?? 0) + 1,
      roundIndex: 0,
      mainUid: order[0],
      wordIndex: 0,
      answerShown: false,
      deadline: mode === 'make' ? createDeadline(me, room) : deadlineFrom(me, room),
    },
  };
  // 前のゲームのお題・マップ・予想・お願い・オリジナルのお題を消す
  for (const uid of Object.keys(room.topics ?? {})) values[`topics/${uid}`] = null;
  for (const uid of Object.keys(room.maps ?? {})) values[`maps/${uid}`] = null;
  for (const uid of Object.keys(room.requests ?? {})) values[`requests/${uid}`] = null;
  for (const id of Object.keys(room.custom ?? {})) values[`custom/${id}`] = null;
  for (const [mainUid, byGuesser] of Object.entries(room.guesses ?? {})) {
    for (const uid of Object.keys(byGuesser ?? {})) values[`guesses/${mainUid}/${uid}`] = null;
  }
  if (mode === 'mine') {
    // ホストのマイお題：まぜて、主役の順に配る（足りない分は、いつものお題）
    const mine = shuffle(chosenMyTopics());
    const used = [];
    order.forEach((uid, i) => {
      const topic = mine[i];
      if (topic) {
        values[`custom/${topic.id}`] = topic;
        values[`topics/${uid}`] = topic.id;
      } else {
        const t = unusedTopic(me, used);
        used.push(t.id);
        values[`topics/${uid}`] = t.id;
      }
    });
  } else if (mode === 'standard') {
    values[`topics/${order[0]}`] = unusedTopic(me, []).id;
  }
  return values;
}

function createDeadline(me, room) {
  return room.meta.timeLimit ? me.net.now() + CREATE_SECONDS * 1000 + START_BUFFER_MS : null;
}

// みんなで作ったお題を配って、最初の主役のマップ作りへ。自分のお題は自分に配らない。足りない分は、いつものお題
function hostFinishCreate(me) {
  const room = me.room;
  const s = room.state;
  if (s?.phase !== 'create' || !once(me, `create:${stateKey(room)}`)) return;
  const order = s.order ?? [];
  const made = {};
  for (const uid of order) {
    const topic = room.custom?.[uid];
    if (isCustomTopic(topic)) made[uid] = topic;
  }
  const assigned = assignMadeTopics(order, made);
  const values = {};
  const used = [];
  for (const uid of order) {
    const topic = assigned[uid];
    if (topic) {
      values[`topics/${uid}`] = topic.id;
    } else {
      const t = unusedTopic(me, used);
      used.push(t.id);
      values[`topics/${uid}`] = t.id;
    }
  }
  values.state = { ...s, phase: 'make', roundIndex: 0, mainUid: order[0], wordIndex: 0, answerShown: false, deadline: deadlineFrom(me, room) };
  me.net.update(`rooms/${me.code}`, values).catch((err) => {
    console.error(err);
    me.advanced = null;
    showToast('うまく進められませんでした');
  });
}

// お題づくりの画面：まだ作っていなければ作る別窓、作ったらみんなを待つ
function renderCreate(me, room, isHost, game, order) {
  const s = room.state ?? {};
  const mine = room.custom?.[me.uid];
  if (!mine && !me.sentCustom?.[game]) {
    if (enterView(me, `create:${game}`)) {
      const remaining = remainingSeconds(me, s.deadline);
      editTopic({
        heading: 'お題づくり',
        canCancel: false,
        timeLimit: remaining === null ? 0 : Math.max(0.2, remaining),
        timeTotal: CREATE_SECONDS,
      }).then((topic) => {
        if (me.closed || me.room?.state?.gameNo !== game || me.room?.state?.phase !== 'create') return;
        me.sentCustom = { ...me.sentCustom, [game]: true };
        const name = me.room.players?.[me.uid]?.name ?? '';
        // 作れなかったとき（時間切れ）は「作らなかった」と書く（いつものお題で補う）
        const value = topic ? { ...topic, author: name } : { none: true };
        me.net.set(`rooms/${me.code}/custom/${me.uid}`, value).catch((err) => {
          console.error(err);
          me.sentCustom[game] = false;
          showToast('お題を送れませんでした。通信を確かめてね');
        });
        if (me.room) render(me, me.room, me.room.meta?.hostUid === me.uid);
      });
    }
    return;
  }
  enterView(me, `wait:create:${game}`);
  showWait({
    step: 'お題づくり',
    title: 'みんなを待っています',
    text: 'お題を作りました。全員がそろうとゲームがはじまります（自分のお題は、ほかの人に出ます）',
    members: statusList(me, room, order, (uid) => room.custom?.[uid]),
    remaining: remainingSeconds(me, s.deadline),
    deadline: s.deadline ?? null,
    total: CREATE_SECONDS,
    canSkip: isHost,
    handlers: { skip: () => hostFinishCreate(me) },
  });
}

// お題のえらび方を変える（ホストだけ）。マイお題は、このスマホに保存したもの
function hostChooseTopicMode(me) {
  const room = me.room;
  if (!room || room.meta.hostUid !== me.uid) return;
  openTopicMode({
    mode: room.meta.topicMode ?? 'standard',
    mineLabel: 'ホストのマイお題',
    onPick: async (mode) => {
      if (mode === 'mine' && !chosenMyTopics().length) await openMyTopics();
      const next = mode === 'mine' && !chosenMyTopics().length ? 'standard' : mode;
      me.net.update(`rooms/${me.code}/meta`, { topicMode: next }).catch((err) => console.error(err));
    },
  });
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

// 次の主役へ（最後の主役が終わったら最終結果）。次の主役にお題を配る
function hostNextRound(me) {
  const room = me.room;
  const s = room.state;
  if (!once(me, `round:${stateKey(room)}`)) return;
  const order = s.order ?? [];
  const next = (s.roundIndex ?? 0) + 1;
  if (next >= order.length) {
    updateState(me, { phase: 'end', deadline: null });
    return;
  }
  const mainUid = order[next];
  const topicId = room.topics?.[mainUid] ?? unusedTopic(me, Object.values(room.topics ?? {})).id;
  me.net.update(`rooms/${me.code}`, {
    [`topics/${mainUid}`]: topicId,
    state: { ...s, phase: 'make', roundIndex: next, mainUid, wordIndex: 0, answerShown: false, deadline: deadlineFrom(me, room) },
  }).catch((err) => {
    console.error(err);
    me.advanced = null;
    showToast('うまく進められませんでした。もう一度押してね');
  });
}

// 主役がいなくなったときに、その主役をとばす
function hostSkipMain(me) {
  const s = me.room?.state;
  if (s?.phase !== 'make') return;
  hostNextRound(me);
}

function hostStartGuess(me) {
  const room = me.room;
  const s = room.state;
  if (s?.phase !== 'make' || !once(me, `guess:${stateKey(room)}`)) return;
  updateState(me, { phase: 'guess', deadline: deadlineFrom(me, room) });
}

function hostStartReveal(me) {
  const room = me.room;
  const s = room.state;
  if (s?.phase !== 'guess' || !once(me, `reveal:${stateKey(room)}`)) return;
  updateState(me, { phase: 'reveal', wordIndex: 0, answerShown: false, deadline: null });
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
  stopMaking();
  closeEditor();
  closeSheet('quit');
  closeSheet('share');
  closeSheet('topic-mode');
  if (me.stream) stopStream(me);
  rememberRoom('');
  if (session === me) session = null;
  if (me.stream && me.net && me.code && !silent) {
    try {
      await leaveStreamRoom(me);
    } catch (err) {
      console.error(err);
    }
  } else if (me.net && me.code && !silent) {
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
