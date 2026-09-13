# 公開とスプレッドシート接続

## 現在の状態

- GitHub: `hiroaking-kan/AGI-AImokuyokai-Hackathon-12` の `field-ai-assistant/`
- 公開構成: Vercel（画面とAPI）→ Google Apps Script → Googleスプレッドシート
- 初期DBは作成済み。接続先IDは所有者の設定値として管理するため、この公開リポジトリには掲載しません。
- 公開URL: https://field-ai-assistant.vercel.app/（発行済み）
- Google初回認証と接続設定は完了しました。`/api/health` は `google-sheets` を返し、商品取得とGemini Liveのセッション確立を実環境で確認済みです。
- Cloudflare、ローカルJSON、Vercelの一時ファイルシステムを公開環境のDBとして使用しません。

## Google側の設定（所有者のアカウントで実施）

1. 作成済みの在庫DBを開き、「拡張機能 → Apps Script」でこのDB用のスクリプトを作成します。
2. `apps-script/Code.gs` を同名ファイルにコピーします。プロジェクト設定でマニフェストの表示を有効にし、`apps-script/appsscript.json` を反映します。高度なサービスの Google Sheets API v4 を有効にします。
3. `setupCheck` を実行し、Googleの権限許可を行います。紐付いたシートの `SPREADSHEET_ID` とランダムな `SHEETS_API_SECRET` が、未設定の場合だけスクリプトプロパティへ保存されます。既存値は上書きしません。
4. ログの `Spreadsheet connection OK` を確認します。プロジェクト設定のスクリプトプロパティで接続秘密値を確認し、Vercel側へ設定します。GitHubやクライアントコードには記載しません。
5. ウェブアプリとしてデプロイします。実行ユーザーは「自分」、アクセスできるユーザーは「全員」。アプリからのAPI通信は共有秘密値で認証します。発行された `/exec` URLを控えます。

以後は同じスクリプトプロジェクトとデプロイを更新します。複数のスクリプトプロジェクトから同じDBへ書き込むと、ScriptLockを共有できません。

## Vercel側の設定

対象は非商用ハッカソン用の `field-ai-assistant` プロジェクト、本番環境です。Vercel Hobbyは非商用個人用途の範囲で使用します。商用に転用する場合はプランを再確認してください。

1. 指定GitHubリポジトリをImportし、**Root Directoryを `field-ai-assistant`** にします。リポジトリ全体をそのまま公開しないでください。
2. FrameworkはVite、Buildは `npm run build`、Outputは `dist`、Node.jsは22を指定します。`vercel.json` がAPIルートを設定します。
3. Productionの環境変数に以下を登録します。いずれも `VITE_` を付けないでください。

| 変数 | 内容 |
|---|---|
| `GEMINI_API_KEY` | ローカル `.env.local` に保存済みのキー |
| `SHEETS_API_URL` | Google Apps Scriptの `/exec` URL |
| `SHEETS_API_SECRET` | Google側と同一の共有秘密値 |

4. デプロイ完了後、割り当てられたHTTPSのProduction URLを使用します。Preview環境の保護設定を無効化する必要はありません。

## 公開後の受入確認

- `/api/health` が `database: "google-sheets"` を返す。
- 別のブラウザから同じ在庫が見える。
- 手動調整を一度だけ実施し、Productsの数量とHistoryの履歴が一致する。テストで増減した場合も元の数へ戻す調整履歴を残す。
- 確認待ちの間に別の端末で更新すると、古い確認は409となり再確認を求める。
- AIを起動して短期トークンとカメラ・音声接続を確認する。未確認の変更が保存されないことを確認する。
- モバイル幅、主要ナビゲーション、手動変更フォームをPlaywrightで確認する。
- `/.env`、`/.env.local`、`/.git/config`、`/server/data/state.json`、`/apps-script/Code.gs` が配信されないことを、本文も含めて確認する。

## DBの構造と運用範囲

Productsは商品と現在庫、Historyは更新履歴、Pendingは確認状態、Requestsは手動更新の重複防止結果です。必須列の見出し・順序と商品IDは変更しないでください。必須列の右側への列追加には対応し、Productsの追加列（例: location）の値を保持します。アプリの更新はScriptLock内でまとめ、Sheetsの単一 `batchUpdate` で在庫・履歴・確認状態を反映します。

在庫変更はアプリから行ってください。シートを人が直接編集する操作はScriptLockを経由せず、履歴とrevisionも自動更新されません。これは少人数のハッカソン向けDBです。履歴は読み取り時に全件取得するため、大量データでの運用は別途設計が必要です。

このMoCには利用者ログインはありません。公開URLを知る人は在庫操作とAI起動ができます。公開するのは架空の初期データを使ったデモに限定してください。

## 参考

- [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel Fair Use](https://vercel.com/docs/limits/fair-use-guidelines)
- [Apps Script Web Apps](https://developers.google.com/apps-script/guides/web)
- [Google Sheets batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)
