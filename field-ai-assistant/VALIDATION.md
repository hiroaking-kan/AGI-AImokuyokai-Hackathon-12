# 検証結果

2026-09-13、Windows / Node.js 22.20.0 / Chromeで確認しました。

| 項目 | 結果 |
|---|---|
| npm install | 成功・監査0 vulnerabilities |
| npm run dev | API 8787・Vite 5173 同時起動 |
| npm run lint / typecheck | 成功 |
| npm run build | フロント・Nodeサーバーとも成功 |
| npm test | 15件PASS |
| npm run test:e2e | PASS（実API＋隔離JSONデータ＋Chrome） |
| 商品表示・手動変更・履歴・再読込永続化 | PASS |
| pending時非更新・いいえ取消・二重はい1回 | PASS |
| 在庫不足・競合・再起動・保存失敗後再試行 | PASS |
| 起動前のカメラ/マイク非取得、権限拒否案内 | PASS |
| 375px、3画面の横はみ出し | なし |
| モバイル起動ボタン | y=395.56px、高さ50px、812px viewport内 |
| CSSスケール・コントラスト | PASS（主ボタン6.14:1、本文/淡紫13.89:1、操作境界3.71:1） |
| フォーカス・操作サイズ | 2px solid、操作48〜50px |
| 秘密情報検査 | アプリソース・生成JSに実キー形式の一致なし、.env.local等のignore確認 |

Live統合テストは、実際のJavaScript SDKとAudioWorkletを使い、接続先のWebSocketをブラウザ内で模擬します。PCM16k送信、JPEG送信、商品カテゴリ照会、prepare、承認なしconfirm拒否、音声はい/いいえ、文字起こし到着順の前後、同一tool再送、PCM24k再生・割込み、終了時の全track停止を確認しました。模擬応答はAIによる画像認識の成功証拠ではありません。

未検証は、所有者のGemini APIキーによる短期トークン発行、実Geminiのカメラ画像認識、日本語ASR・生成音声の品質、実マイク環境と長時間接続です。Google AI Studioでキーを取得しREADMEの手順で確認してください。

Playwright MCPがこのセッションでは提供されていないため、同梱PlaywrightをローカルChromeで実行しました。sandbox内では子プロセス起動がEPERMになり、許可された実行環境で検証しました。ビルドにはSDK込みJSが500kBを超える警告があります（失敗ではありません）。

デザインはcreative-preflight / app-ui specを適用し、Superhumanを主軸に角丸2値（6/20px）、装飾主色1色、UI行高1.5を採用。独立レビューの指摘によりモバイル起動ボタン位置とデモ開閉部の操作領域を修正しました。

テスト生成物はOSの一時フォルダ `field-ai-*-test-*` / `field-ai-e2e-*` に保持しています。通常データにテスト変更は含まれません。これらは不要になった時点で手動削除できます。アプリのファイルや外部データの削除、コミット、公開デプロイは行っていません。
