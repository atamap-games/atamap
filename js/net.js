// スマホ同士をつなぐ部分（Firebase）。部屋を作る・入るときに、はじめて読み込む。
// 名前だけで遊べるよう、Firebase の「匿名ログイン」を使う（アカウントは作らない）。
import { firebaseConfig, FIREBASE_VERSION } from './firebase-config.js';

const SDK = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

let connecting = null;

/**
 * Firebase につなぐ（2回目からは、つないだものをそのまま返す）。
 * @returns {Promise<object>} 読み書きの手伝い（uid, now, get, set, update, watch など）
 */
export function connect() {
  connecting ??= open().catch((error) => {
    connecting = null;
    throw error;
  });
  return connecting;
}

async function open() {
  const [appSdk, authSdk, dbSdk] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-database.js`),
  ]);
  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = dbSdk.getDatabase(app);
  if (useEmulator()) {
    authSdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    dbSdk.connectDatabaseEmulator(db, '127.0.0.1', 9000);
  }

  // 前にこのブラウザで入っていれば、同じ人として続ける（途中で開き直しても戻れるように）
  await auth.authStateReady();
  const user = auth.currentUser ?? (await authSdk.signInAnonymously(auth)).user;

  // サーバーの時計とのずれ（制限時間をみんなでそろえるため）
  let offset = 0;
  dbSdk.onValue(dbSdk.ref(db, '.info/serverTimeOffset'), (snap) => {
    offset = snap.val() ?? 0;
  });

  const ref = (path) => dbSdk.ref(db, path);
  return {
    uid: user.uid,
    /** サーバーの時計で今の時刻（ミリ秒） */
    now: () => Date.now() + offset,
    get: async (path) => (await dbSdk.get(ref(path))).val(),
    set: (path, value) => dbSdk.set(ref(path), value),
    update: (path, values) => dbSdk.update(ref(path), values),
    remove: (path) => dbSdk.remove(ref(path)),
    /** 中身が変わるたびに呼ばれるようにする。やめる関数を返す */
    watch: (path, callback) => dbSdk.onValue(ref(path), (snap) => callback(snap.val())),
    /** 通信が切れたときに、自動で書きかえる */
    onDisconnectSet: (path, value) => dbSdk.onDisconnect(ref(path)).set(value),
    cancelOnDisconnect: (path) => dbSdk.onDisconnect(ref(path)).cancel(),
    serverTime: () => dbSdk.serverTimestamp(),
  };
}

// 手元のパソコンで試すときだけ、本物ではなく「お試し版の Firebase」につなぐ
// （アドレスが 127.0.0.1 か localhost で、?emulator が付いているとき）
export function useEmulator() {
  return ['127.0.0.1', 'localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('emulator');
}
