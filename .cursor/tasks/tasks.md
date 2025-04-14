# Devin Discord Bot 実装計画

## 方針

-   **MVP ファースト:** まずは Discord でメンションを受け、Devin セッションを開始し、スレッド内でユーザーからの指示送信と Devin からの応答表示（基本的な対話ループ）ができる最小限の機能を実装する。
-   **段階的拡張:** MVP をベースに、高度な制御、状態永続化、ファイル添付、通知などの機能を段階的に追加していく。
-   **Devin API 依存:** `mute`, `unmute`, `sleep`, `EXIT` などのキーワードは、Devin API 側で解釈・処理されることを期待し、初期段階では Bot 側で特別な処理を実装せず、ユーザーメッセージをそのまま Devin に転送する方針とする。（`aside` のみ Bot 側での無視を検討）

---

## フェーズ 1: 基本的な対話ループ (MVP)

**目的:** Discord Bot をサーバーに接続し、メンションをトリガーに Devin セッションを開始、作成されたスレッド内でユーザーからの指示を Devin に送信し、Devin からの応答（ステータス変化や出力）をスレッドに表示する、基本的な対話ループを実現する。

**タスク:**

-   [ ] **インフラ (CDK):**
    -   [x] Fargate サービス、タスク定義 (Node.js/discord.js)
    -   [x] Secrets Manager Secret (Discord Bot Token, Devin API Key)
-   [ ] **Devin API クライアント (src/lib/devinClient.ts など):**
    -   [ ] `POST /v1/sessions` の実装
    -   [ ] `POST /v1/session/{session_id}/message` の実装
    -   [ ] `GET /v1/session/{session_id}` の実装
-   [ ] **Discord Bot (src/):**
    -   [ ] `discord.js` クライアント初期化、Discord Gateway 接続
    -   [x] Bot Token, Devin API Key を Secrets Manager から読み込む
    -   [ ] `messageCreate` イベントハンドラ:
        -   [ ] `@Bot名` メンションを検知
        -   [ ] メンションされたメッセージを基に **(実装済みの API クライアントを利用して)** `POST /v1/sessions` を呼び出し、Devin セッションを開始
        -   [ ] メンションされたメッセージに対して Discord スレッドを作成
        -   [ ] スレッド内にセッション開始メッセージと Devin セッション URL を投稿
        -   [ ] **スレッド内の後続メッセージを検知**
        -   [ ] 後続メッセージを対応する Devin セッションに **(実装済みの API クライアントを利用して)** `POST /v1/session/{session_id}/message` で転送 (※ `aside` キーワードは無視する方向で検討)
        -   [ ] セッション開始後、Devin セッションの監視を開始する
    -   [ ] **Devin セッション監視:**
        -   [ ] **(実装済みの API クライアントを利用して)** `GET /v1/session/{session_id}` を定期的にポーリングする処理を追加 (推奨間隔: 10-30秒)
        -   [ ] セッションステータス (`status_enum`) の変化 (特に `blocked`, `stopped`, `finished` など) を検知し、スレッドに通知
        -   [ ] `structured_output` の更新を検知し、スレッドに通知 (オプション/必要に応じて)
        -   [ ] セッション終了状態になったらポーリングを停止
-   [ ] **エラーハンドリング:**
    -   [ ] Devin API 呼び出し (セッション開始、メッセージ送信、監視) 時の基本的なエラー処理とスレッドへの通知
-   [ ] **テスト (test/bot.test.ts など):**
    -   [ ] メンション検知ロジックの単体テスト
    -   [ ] スレッド内メッセージ転送ロジックの単体テスト
    -   [ ] セッション監視・通知ロジックの単体テスト
-   [ ] **デプロイと動作確認:**
    -   [ ] CDK で AWS 環境にデプロイ
    -   [ ] Discord サーバーで基本的なメンション → スレッド作成 → スレッド内指示 → Devin からの応答/ステータス通知 の流れを確認

---

## フェーズ 2: 高度な制御と状態永続化

**目的:** `snapshot`/`playbook` キーワード対応、Bot レベルでの `mute`/`unmute` 機能、およびセッション情報 (スレッド ID とセッション ID のマッピング等) の永続化を行う。

**タスク:**

-   [ ] **インフラ (CDK):**
    -   [ ] DynamoDB テーブル定義 (スレッド ID と Devin セッション ID のマッピング、ミュート状態等)
    -   [ ] Fargate タスクロールに DynamoDB 読み書き権限を追加
-   [ ] **Discord Bot (src/):**
    -   [ ] `messageCreate` ハンドラ:
        -   [ ] メンション時に `snapshot:<id>`, `playbook:<id>` キーワードを解析し、`(実装済みの API クライアントを利用して)` `POST /v1/sessions` に渡す
        -   [ ] スレッド内で `mute`/`unmute` キーワードを検知し、Bot 内部で対象スレッドのミュート状態を管理 (DynamoDB に保存)
        -   [ ] ミュート中のスレッドからのメッセージは Devin に転送しない
    -   [ ] **状態管理:**
        -   [ ] スレッド作成時に、Discord スレッド ID と Devin セッション ID のマッピングを DynamoDB に保存
        -   [ ] スレッド内メッセージ受信時/監視時に、DynamoDB から対応する Devin セッション ID やミュート状態を取得
-   [ ] **テスト (test/):**
    -   [ ] `snapshot`/`playbook` キーワード解析の単体テスト
    -   [ ] Bot レベルの `mute`/`unmute` 機能のテスト
    -   [ ] DynamoDB を利用した状態管理ロジックのテスト
-   [ ] **デプロイと動作確認:**
    -   [ ] 機能追加後のデプロイ
    -   [ ] キーワード (`snapshot`, `playbook`, `mute`, `unmute`) の動作確認
    -   [ ] Bot 再起動後もスレッドでの対話が継続できることを確認

---

## フェーズ 3: ファイル添付とオプション機能

**目的:** ファイル添付によるコンテキスト提供、アカウント連携、DM 通知などのオプション機能の実装、および全体的な安定性やUXの改善を行う。

**タスク:**

-   [ ] **Discord Bot (src/):**
    -   [ ] `messageCreate` ハンドラ:
        -   [ ] メンション時、メッセージに添付ファイルがあれば **(実装済みの API クライアントを利用して)** `POST /v1/attachments` でアップロードし、ファイル URL を `POST /v1/sessions` の `prompt` に含める
        -   [ ] スレッド内のメッセージに添付ファイルがあれば、同様にアップロードし、ファイル URL を `POST /v1/session/{session_id}/message` の `message` に含める
    -   [ ] **Devin API クライアント:**
        -   [ ] `POST /v1/attachments` の実装
-   [ ] **エラーハンドリング:**
    -   [ ] ファイルアップロード失敗時のエラー処理
-   [ ] **インフラ (CDK):**
    -   [ ] (任意) アカウント連携用 API Gateway, Lambda
-   [ ] **Discord Bot (src/):**
    -   [ ] (任意) Devin アカウントと Discord アカウントの連携機能 (OAuth フローなど)
    -   [ ] (任意) アカウント連携に基づいた DM 通知機能
    -   [ ] (任意) スラッシュコマンドの実装 (`/devin start`, `/devin send` など)
    -   [ ] リファクタリング、コード品質向上
    -   [ ] 詳細なエラーハンドリングとロギング (CloudWatch Logs)
-   [ ] **テスト (test/):**
    -   [ ] ファイル添付処理の単体テスト
    -   [ ] (任意) オプション機能のテスト
    -   [ ] (任意) E2E テスト
-   [ ] **ドキュメント:**
    -   [ ] `README.md` の更新 (使い方、設定方法など)
-   [ ] **デプロイと動作確認:**
    -   [ ] 機能追加後のデプロイ
    -   [ ] ファイル添付機能の確認
    -   [ ] (任意) オプション機能の確認
