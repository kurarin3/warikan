// ---------------------------------------------------------------------------
// Firebase の設定値をここに貼り付けてください。
// Firebase コンソール → プロジェクトの設定 → マイアプリ →
// ウェブアプリ（</> アイコン）を追加すると firebaseConfig が表示されます。
//
// Realtime Database を「テストモード」ではなく、同梱の database.rules.json の
// 内容でルールを設定してから公開してください。
// ---------------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: "AIzaSyBDM8JzpG-zBV5cdE0da5LR-iD1WIn5K9g",
  authDomain: "warikan-cc426.firebaseapp.com",
  // ↓ Realtime Database の「データ」タブに表示されている URL を貼り付けてください。
  //   例: https://warikan-cc426-default-rtdb.firebaseio.com
  //       https://warikan-cc426-default-rtdb.asia-southeast1.firebasedatabase.app
  databaseURL: "https://warikan-cc426-default-rtdb.firebaseio.com",
  projectId: "warikan-cc426",
  storageBucket: "warikan-cc426.firebasestorage.app",
  messagingSenderId: "957587225213",
  appId: "1:957587225213:web:89c4ccc8393e78036acf14",
  measurementId: "G-JP80H2WM58"
};

export const isConfigured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);
