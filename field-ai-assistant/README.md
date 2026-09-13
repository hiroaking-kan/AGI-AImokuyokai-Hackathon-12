# 現場AIアシスタント

このアプリはリポジトリ内の `field-ai-assistant/` だけで動作します。リポジトリを取得したら `cd field-ai-assistant` で移動してから以下を実行してください。既存のREADME・発表資料には変更を加えていません。

カメラを向けて話しかけ、確認してから在庫を変更する、localhost専用のハッカソンMoCです。React / Vite / TypeScript、Express、ローカルJSONで動作します。ログインや外部DBは不要です。

## 必要環境とセットアップ

- Node.js 22.12以上、npm、PC版Chrome
- Live会話を使う場合はカメラ・マイク・スピーカー（ヘッドセット推奨）、インターネット接続、Gemini APIキー

このREADMEのあるフォルダを開いて実行します。

```powershell
npm install
Copy-Item .env.example .env.local
```

`.env.local` をエディタで開いて設定します。既にある場合はコピーで上書きせず編集してください。

```dotenv
GEMINI_API_KEY=your_api_key_here
VITE_DEMO_MODE=false
API_PORT=8787
```

通常の環境変数としてサーバーに設定しても構いません。`GEMINI_API_KEY` に `VITE_` 接頭辞を付けないでください。

```powershell
npm run dev
```

ブラウザで [http://127.0.0.1:5173](http://127.0.0.1:5173) を開きます。フロントとAPI（127.0.0.1:8787）が同時起動します。停止はターミナルで `Ctrl+C`。環境変数を変更したら再起動してください。ポートが使用中なら既存プロセスを確認してください。APIポート変更には `API_PORT` を使います。

## Gemini APIキーの取得

1. [Google AI Studio](https://aistudio.google.com/apikey) に自分のGoogleアカウントでログインします。
2. 利用するプロジェクトでAPIキーを作成し、モデルの利用可否・割当量・料金を自分のアカウントで確認します。
3. キーを `.env.local` の `GEMINI_API_KEY` に保存し、アプリを再起動します。

キーはGitへコミットしません。`.env` / `.env.*`（`.env.example` を除く）はgitignore対象です。モデルの利用権限と割当量はアカウントに依存します。本アプリは課金の有効化・キー作成・有料APIの実行を自動で行いません。

## Live会話と権限

「AIを起動する」を押した後だけカメラとマイクの許可を求め、短期トークンを取得してLive接続します。マイクはPCM 16kHz、応答音声はPCM 24kHzで再生し、カメラ画像は最大約1秒に1枚のJPEGとして送ります。

Chromeのサイト設定でカメラ・マイクを許可してください。拒否時はアドレスバー左のサイト設定から変更し、再接続します。他のアプリがカメラを占有している場合はそちらを終了します。localhost以外のHTTPではカメラ・マイクが使えません。「会話を終了」で接続・映像送信・マイク・音声再生を停止します。エラー時は画面の「再接続」を使用します。

映像は個別商品の同一性を照合しません。椅子・机・モニターという一般カテゴリを商品マスタへ対応付け、「登録されている商品として扱います」と案内します。映像・音声はLive利用時にGoogleへ送信されます。

## デモシナリオ

初期マスタはオフィスチェアA＝20脚、デスクA＝10台、モニターA＝15台です。

1. AI起動後、椅子を映して「これ何？」。
2. 商品マスタと現在庫を確認した応答を聞きます。
3. 「これ5脚出荷して」。画面に20→15の確認カードが出ても、まだ保存されません。
4. 音声で「はい」または確認カードの「はい」で承認します。「いいえ」で中止します。
5. 在庫管理画面で15脚、変更履歴で20→15・-5・AIを確認します。
6. 在庫管理の「在庫を変更」から増減数量と理由を入力して保存すると、MANUAL履歴が残ります。

入荷は「3個入荷して」、確認は「モニターの在庫を確認して」などに対応します。出荷・入荷は正の整数、手動調整・adjustmentは符号付きの増減数量です。たとえば `-2` は2個減らし、`3` は3個増やします。絶対在庫数の指定ではありません。

## 開発・緊急デモモード

`.env.local` に `VITE_DEMO_MODE=true` を設定して `npm run dev` を再起動すると、開発用の操作パネルが表示されます。「椅子を認識」→「5脚出荷」→確認→「はい」で、Live・カメラ・マイクを使わず同じバックエンドに保存します。

これは**疑似認識・疑似会話**です。Liveの動作証明ではありません。在庫と履歴は実際に保存されます。`import.meta.env.DEV` も必須にしているため、production buildでは表示されません。

新しいデモデータが必要なときは、既存データを消さず、別の空フォルダを指定して起動できます。

```powershell
$env:DATA_DIR = Join-Path $env:TEMP ('field-ai-demo-' + [guid]::NewGuid())
npm run dev
```

## データと確認フロー

- `prepare` は確認待ちのIDと変更前後の数量を作るだけです。
- 音声・ボタンは共通の確定／中止処理を呼びます。モデルが勝手にconfirmを要求した場合、発話の承認根拠がなければフロント側で拒否します。
- サーバーでも確認ID単位で冪等化し、同時に音声とボタンが確定しても1回しか更新しません。
- 確認待ちの間に別操作で在庫が変わった場合は競合として拒否し、再確認が必要です。在庫不足や不正な数量では確認待ちも作りません。
- 手動変更は保存ボタンを人間の承認として、同じServiceの保存処理を使用します。

在庫と履歴を別ファイルだけで更新すると片方だけ保存される可能性があるため、`server/data/state.json` を両方と冪等キーを含む正本にしました。一時ファイルの書き込みからrenameで入れ替え、処理を直列化します。`products.json` / `history.json` は参照用ミラーで、起動時にも正本から復旧します。フロントからファイルは変更しません。手動でJSONを編集せず、画面の在庫調整を使ってください。

未確定pendingはメモリ上のみで、10分経過またはサーバー再起動により失効します。確定済みのIDは永続化され、再送でも重複保存しません。**同じDATA_DIRに複数のAPIプロセスを起動する運用は非対応**です。

`server/data/` は全体をGit除外しています。初回起動時にソース内の初期値（20脚・10台・15台）からフォルダとJSONを自動生成するため、クローン直後はこのフォルダがなくても動作します。実際の在庫・変更履歴はGitHubへ保存しません。

## 構成

```text
client/src/           画面・APIクライアント・Live接続と音声処理
client/public/        音声入力ワークレット・favicon
server/src/           Express API・短期トークン発行
server/src/services/  確認待ちと在庫更新
server/src/repositories/ JSON永続化
server/data/          初期データ・実行時データ
shared/               共有Request/Response型・Live設定
server/tests/         保存・競合・冪等性・APIテスト
client/tests/         音声確認ロジックのテスト
scripts/              ブラウザ検証
```

APIは `GET /api/products`、`GET /api/products/:id`、`GET /api/products/category/:category`、`GET /api/history`、`POST /api/inventory/{prepare,confirm,cancel,manual}`、`POST /api/gemini/token` です。prepareは `productId, quantity, action`、confirm/cancelは `pendingId`、manualは `productId, quantity, reason, requestId` をJSONで受け取ります。共通型は `shared/types.ts` を参照してください。

## 検証コマンド

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

ブラウザ検証はChromeを使い、OSの一時フォルダに専用データとスクリーンショットを保存します。通常の在庫には影響しません。ビルド成果物は `dist/`、サーバーは `dist-server/` に生成します。`npm start` はAPIサーバーのみを起動するコマンドです。デモでは `npm run dev` を使用してください。

## セキュリティと本番化

ブラウザテストのLive部分はWebSocketを捕捉し、Googleへ接続しない模擬応答で確認します。実SDKの接続準備・PCM/JPEG送信・確認ツール・音声承認・再送・音声再生・終了時解放を通しますが、実際のAI認識精度は検証しません。

通常のAPIキーはサーバーにだけ置き、ブラウザはモデル・会話設定を制約した単回使用の短期トークンを受け取ります。トークンやキー、APIエラー詳細をログへ出しません。通常キーをクライアントへ返すフォールバックはありません。

認証なしのlocalhost専用MoCです。ネット公開やポート転送をしないでください。OriginとHostをローカルに限定していますが、localhostの他プログラムに対する権限分離は行いません。AIの意味理解や音声認識は完全ではなく、音声承認の誤認識をゼロにするものではありません。重要操作では確認カードの対象・数量も確認してください。

本番化には認証・認可、HTTPS、サーバー側の承認証跡、DBトランザクションと複数プロセス排他、監査ログ保護、バックアップ、レート制限、利用量制御、音声承認精度評価、長時間セッション復帰の検証が必要です。今回の範囲には含めていません。

## 公式仕様の参照

指定モデル `gemini-3.1-flash-live-preview` を使用し、別モデルへ変更していません。モデルの存在は公式ドキュメントで確認し、アカウントでの実接続可否はキー設定後に確認します。

- [モデル仕様](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview)
- [Live API](https://ai.google.dev/gemini-api/docs/live)
- [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)

公式短期トークンドキュメントに従いAPIバージョンは `v1beta` です。インストール済みSDK 1.52.0には旧 `v1alpha` 案内の警告文が残っているため、型・接続コードと現行公式仕様を区別して確認しています。APIキーなしでの検証では、実際のGemini音声応答・映像認識・トークン発行成功を確認できません。
