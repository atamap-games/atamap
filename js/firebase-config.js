// Firebase の設定値（Web 用）。この値は公開されても問題ない（だれでもページから見られるもの）。
// データを守るのは、Firebase のデータベースのルール（database.rules.json）。
// 秘密の鍵やパスワードは、ここにもリポジトリのどこにも入れない。

export const FIREBASE_VERSION = '13.2.0';

export const firebaseConfig = {
  apiKey: 'AIzaSyBOsLXKe6RhkTBCEq7PkklITZl4hudyfJM',
  authDomain: 'atamap-27ddc.firebaseapp.com',
  databaseURL: 'https://atamap-27ddc-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'atamap-27ddc',
  storageBucket: 'atamap-27ddc.firebasestorage.app',
  messagingSenderId: '211876098375',
  appId: '1:211876098375:web:d21f0f1284e9d9b6e35c62',
};
