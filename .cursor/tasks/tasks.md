# Devin Discord Bot 実装計画

## 方針

-   **MVP ファースト:** まずは Discord でメンションを受け、Devin セッションを開始し、スレッド内でユーザーからの指示送信と Devin からの応答表示（基本的な対話ループ）ができる最小限の機能を実装する。
-   **段階的拡張:** MVP をベースに、高度な制御、状態永続化、ファイル添付、通知などの機能を段階的に追加していく。
-   **Devin API 依存:** `mute`, `unmute`, `sleep`, `EXIT` などのキーワードは、Devin API 側で解釈・処理されることを期待し、初期段階では Bot 側で特別な処理を実装せず、ユーザーメッセージをそのまま Devin に転送する方針とする。（`aside` のみ Bot 側での無視を検討）

---

**開発上の注意 (2025-04-14):**
現在、Devin API (v1 Alpha) 経由で Web UI のような自然な会話応答テキストを取得する方法が不明瞭です。
`GET /v1/session/{session_id}` で取得できるのは主にステータスと `structured_output` に限られるように見えます。
`structured_output` を利用して応答を格納させる試みも行いましたが、応答格納直後にセッションが `blocked` 状態となり会話が継続できませんでした。
この点について Devin Team に質問を送信済みであり、回答待ちです。
今後の会話応答に関する実装は、Devin Team からの回答や API のアップデートに依存する可能性があります。

---

## フェーズ 1: 基本的な対話ループ (MVP)

**目的:** Discord Bot をサーバーに接続し、メンションをトリガーに Devin セッションを開始、作成されたスレッド内でユーザーからの指示を Devin に送信し、Devin からの応答（ステータス変化や出力）をスレッドに表示する、基本的な対話ループを実現する。

**タスク:**

-   [ ] **インフラ (CDK):**
    -   [x] Fargate サービス、タスク定義 (Node.js/discord.js)
    -   [x] Secrets Manager Secret (Discord Bot Token, Devin API Key)
-   [ ] **Devin API クライアント (src/lib/devinClient.ts など):**
    -   [x] `POST /v1/sessions` の実装
    -   [x] `POST /v1/session/{session_id}/message` の実装
    -   [x] `GET /v1/session/{session_id}` の実装
-   [ ] **Discord Bot (src/):**
    -   [x] `discord.js` クライアント初期化、Discord Gateway 接続
    -   [x] Bot Token, Devin API Key を Secrets Manager から読み込む
    -   [x] `messageCreate` イベントハンドラ:
        -   [x] `@Bot名` メンションを検知
        -   [x] メンションされたメッセージを基に **(実装済みの API クライアントを利用して)** `POST /v1/sessions` を呼び出し、Devin セッションを開始
        -   [x] メンションされたメッセージに対して Discord スレッドを作成
        -   [x] スレッド内にセッション開始メッセージと Devin セッション URL を投稿
        -   [x] **スレッド内の後続メッセージを検知**
        -   [x] 後続メッセージを対応する Devin セッションに **(実装済みの API クライアントを利用して)** `POST /v1/session/{session_id}/message` で転送 (※ `aside` キーワードは無視する方向で検討)
        -   [x] セッション開始後、Devin セッションの監視を開始する
    -   [x] **Devin セッション監視:**
        -   [x] **(実装済みの API クライアントを利用して)** `GET /v1/session/{session_id}` を定期的にポーリングする処理を追加 (推奨間隔: 10-30秒)
        -   [x] セッションステータス (`status_enum`) の変化 (特に `blocked`, `stopped`, `finished` など) を検知し、スレッドに通知
        -   [x] `structured_output` の更新を検知し、スレッドに通知 (オプション/必要に応じて)
        -   [x] セッション終了状態になったらポーリングを停止
-   [ ] **エラーハンドリング:**
    -   [x] Devin API 呼び出し (セッション開始、メッセージ送信、監視) 時の基本的なエラー処理とスレッドへの通知
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
    -   [ ] Bot レベルの `mute`
