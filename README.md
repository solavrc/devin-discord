# Devin Discord Bot

(ここにプロジェクトの簡単な説明を1-2文で記述します)

## 主な機能ハイライト

*   Discord チャンネルでの `@Devin` メンションによるタスク開始
*   ファイル添付によるコンテキスト提供
*   スレッド内での対話型セッション
*   キーワード (`aside`, `mute`, `unmute`, `sleep`, `exit` など) によるセッション制御
*   (任意) Devin アカウント連携による機能拡張
*   (任意) DM によるセッション通知

## 基本的な使い方

1.  Devin Bot を Discord サーバーに追加します。
2.  任意のテキストチャンネルで `@<Bot名> <タスク内容>` とメンションします。
3.  Bot が作成したスレッド内で対話を開始します。
4.  スレッド内で以下のキーワードを使用できます:
    *   `aside <メモ内容>`: メッセージの先頭に `aside` を付けると、そのメッセージは Devin に送信されず、スレッドに残るメモとして扱われます。
    *   `mute`: スレッド内でこのコマンドを入力すると、Devin からのステータス更新などの通知がこのスレッドに表示されなくなります (Devin へのメッセージ送信も停止します)。
    *   `unmute`: ミュート状態を解除し、通知の表示と Devin へのメッセージ送信を再開します。
    *   `sleep`: Devin にセッションを一時停止するように伝えます (Devin 側の機能)。
    *   `exit`: Devin にセッションを終了するように伝えます (Devin 側の機能)。

## ローカルでの実行方法 (開発・テスト用)

1.  **環境変数の設定:**
    プロジェクトルートに `.env` という名前のファイルを作成し、以下の内容を記述して、実際のトークンと API キーに置き換えます。**このファイルは `npm run dev` によるローカル実行時にのみ使用されます。**
    ```dotenv
    DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
    DEVIN_API_KEY=YOUR_DEVIN_API_KEY_HERE
    ```
    *   `DISCORD_BOT_TOKEN`: Discord Developer Portal で取得した Bot のトークン。
    *   `DEVIN_API_KEY`: Devin の設定ページで取得した API キー。
    *   **注意:** `.env` ファイルは `.gitignore` に含まれているため、Git リポジトリにはコミットされません。
    *   **AWS デプロイ時の注意:** `cdk deploy` を使用して AWS 環境にデプロイする場合、`.env` ファイルではなく **`cdk.context.json`** ファイルに定義された `DISCORD_BOT_TOKEN` と `DEVIN_API_KEY` の値が AWS Secrets Manager に設定され、Fargate 上のアプリケーションから参照されます。ローカル実行と AWS デプロイで参照される設定値のソースが異なる点に注意してください。

2.  **依存関係のインストール:**
    ```bash
    npm install
    ```

3.  **Bot の起動:**
    以下のコマンドを実行すると、TypeScript コードがコンパイルされ、Bot が起動します。
    ```bash
    npm run dev
    ```
    コンソールに `✅ Ready! Logged in as ...` と表示されれば成功です。

4.  **(オプション) 特定セッションの状態確認:**
    特定の Devin セッションの最新状態を API 経由で確認したい場合は、以下のコマンドを使用できます (デバッグ用)。
    ```bash
    npm run check-session <devin_session_id>
    ```
    `<devin_session_id>` は確認したいセッションの ID (例: `devin-xxxxxxxx...`) に置き換えてください。

## リポジトリ構成とドキュメント

*   **`.cursor/docs/prd.md`**: 製品要求仕様 (PRD) と詳細な機能要件
*   **`.cursor/docs/architecture.md`**: 技術スタックとアーキテクチャ概要
*   **`.cursor/tasks/`**: 現在進行中のタスク管理
*   **`src/`**: Bot アプリケーションのソースコード (TypeScript)
*   **`cdk/`**: AWS CDK によるインフラ定義コード (TypeScript)
*   **`test/`**: Jest によるテストコード

# 要件定義

詳細な機能要件については、[`.cursor/docs/prd.md`](.cursor/docs/prd.md) を参照してください。
