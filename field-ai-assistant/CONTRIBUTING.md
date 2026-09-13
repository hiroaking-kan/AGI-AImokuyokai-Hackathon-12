# 共同編集

コードの正本は、このGitHubリポジトリの `field-ai-assistant/` です。各メンバーが同じリポジトリをcloneし、変更ごとにブランチとPull Requestを使います。

```sh
git clone https://github.com/hiroaking-kan/AGI-AImokuyokai-Hackathon-12.git
cd AGI-AImokuyokai-Hackathon-12
git switch main
git pull --ff-only
git switch -c codex/your-change
cd field-ai-assistant
npm ci
# .env.exampleを.env.localへコピー。既存.env.localは上書きしない
npm run dev
```

変更後は `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` を実行し、対象ファイルを確認してcommit/pushします。GitHubで `main` 宛てのPull Requestを作成してください。直接mainを更新する場合もpush直前にfetchし、他の変更を取り込んでください。force pushはしません。

ブラウザ上のGitHubエディタからもファイルの編集ボタンで変更し、新しいブランチを選んでPull Requestを作れます。新メンバーの編集権限追加は、リポジトリ所有者が Settings → Collaborators で行います。

- `README.md`（リポジトリ直下）や `output/` の他メンバーの資料を上書きしないでください。
- アプリの変更は `field-ai-assistant/` に限定します。GASも `apps-script/` で共同編集します。
- `.env.local`、`.clasp.json`、`.vercel/`、APIキーやDB接続秘密値はコミットしません。共有が必要な値はサービス側の環境変数・Script Propertiesで管理します。
- ローカルJSONは各開発者のテストDBです。公開環境の共有DBはGoogleスプレッドシートです。
- GoogleエディタだけでGASを変更した場合、公開前に必ずGitHub側にも同じ修正を反映してください。
- 公開担当者がレビュー後のmainをデプロイします。GitHubの編集権限とVercelの公開権限は別です。
