# Devin API 実装ガイドライン (v1 Alpha)

このドキュメントは、Devin API (v1 Alpha) を利用したアプリケーション実装のためのガイドラインです。
公式ドキュメント ([Overview](https://docs.devin.ai/api-reference/overview), [Structured Output](https://docs.devin.ai/api-reference/structured-output), [Examples](https://docs.devin.ai/api-reference/examples)) および過去の検証を基に、実践的な情報を提供します。

**注意:** Devin API は現在アルファ版です。後方互換性を維持するよう努められていますが、一部のエンドポイントは変更される可能性があります。

## 1. API 基本情報

- **ベース URL:** `https://api.devin.ai/v1`
- **認証:**
    - HTTP リクエストヘッダーに `Authorization: Bearer <YOUR_API_KEY>` を含めます。
    - API キーは [Devin 設定ページ](https://app.devin.ai/settings) (※URLは仮) から取得できます。
    - API キーは機密情報として扱い、公開リポジトリやクライアントサイドコードに含めないでください。

## 2. セッション (Session)

### 2.1. セッションとは？

- ユーザーが Devin に特定のタスク (`prompt`) を依頼し、そのタスクが完了または中断されるまでの一連の対話と処理を表す単位です。
- 各セッションは一意の `session_id` (例: `devin-xxxxxxxx...`) で識別されます。

### 2.2. セッションのライフサイクルとステータス

セッションの状態は `GET /v1/session/{session_id}` で取得できる `status_enum` フィールドで確認できます。
主なステータスは以下の通りです (ドキュメントと例に基づく推定を含む):

1.  **開始 (Creation):** `POST /v1/sessions` 成功直後。まだ Devin は作業を開始していません (例: `claimed`)。
2.  **実行中 (Running/Working):** Devin がタスクを処理中です (例: `running`, `working`)。
3.  **ブロック (Blocked):** Devin がユーザーからの追加情報や指示を待っています (例: `blocked`)。
4.  **停止/完了 (Stopped/Finished/Suspended):**
    - タスクが完了した、またはエラーが発生した場合 (例: `stopped`, `finished`)。
    - ユーザーが `SLEEP` メッセージを送信した場合 (例: `suspended`, `finished`)。
    - `blocked` や `stopped` は、セッションが終了したことを示す最終状態のようです ([Examples](https://docs.devin.ai/api-reference/examples) のポーリング終了条件より)。
    - 一度終了したセッションを再開する公式な方法は現時点では不明です。

### 2.3. Structured Output

`structured_output` は、Devin がタスクを進める中で更新する「メモ帳」のようなものです。JSON 形式で、タスクの進捗、結果、分析データなどが格納されます。([Structured Output ドキュメント](https://docs.devin.ai/api-reference/structured-output)参照)

- **目的:**
    - **進捗更新:** 長時間かかるタスクの現在の状況や次のステップを把握する。
    - **アプリケーション連携:** Devin の分析結果や生成物を一貫した JSON 形式で他のシステムに取り込む (例: PR レビュー結果、テスト結果、機能実装状況)。
- **リクエスト方法:**
    - セッション開始時 (`POST /v1/sessions`) の `prompt` 内に、期待する JSON スキーマと、どのようなタイミングで更新してほしいかを明確に記述します。
    - 例 (PR レビュー):
        ```json
        {
          "prompt": "このPRをレビューし、以下の形式で更新してください。問題点、提案、承認ステータスが見つかったり変更されたりしたら、すぐにstructured_outputを更新してください:\n{\n    \"issues\": [\n      {\n        \"file\": \"src/App.tsx\",\n        \"line\": 42,\n        \"type\": \"bug\",\n        \"description\": \"useEffectクリーンアップでのメモリリーク\"\n      }\n    ],\n    \"suggestions\": [\n      \"API呼び出しのエラーハンドリングを追加する\",\n      \"コンポーネントをより小さな部分に分割する\"\n    ],\n    \"approved\": false\n  }"
        }
        ```
- **取得方法:**
    - `GET /session/{session_id}` のレスポンス内の `structured_output` フィールドから取得します。
- **ベストプラクティス:**
    - 初期プロンプトにスキーマ定義を含める。
    - 期待する更新頻度を明確にする (例: 「新しいコンポーネントを追加するたびに更新してください」)。
    - 値の型とフォーマットを明確に文書化する。
    - 明確で説明的なフィールド名を使用する。
    - スキーマにサンプル値を含める。
    - ポーリング間隔は 10〜30 秒程度にする (API への過負荷を避けるため)。
    - セッションが完了またはエラーになったらポーリングを停止する。
    - **注意:** Devin は自身のスケジュールで `structured_output` を更新します。API 経由で即時更新を強制することはできませんが、いつでも最新のメモを確認することは可能です。

## 3. API エンドポイント詳細

### 3.1. セッション管理 (Sessions)

- **`POST /v1/sessions` (Create a Session)**
    - **目的:** 新しい Devin セッションを開始する。オプションでスナップショットID、プレイブックID、タグなどを指定可能。
    - **メソッド:** `POST`
    - **パス:** `/v1/sessions`
    - **リクエストボディ (JSON):**
        - `prompt` (string, required): Devin に実行させたいタスクの指示。Structured Output を利用する場合は、ここにスキーマと更新指示を含める。
        - `snapshot_id` (string | null, optional): 使用するマシンスナップショットのID。
        - `playbook_id` (string | null, optional): 従うべきプレイブックのID。
        - `unlisted` (boolean | null, optional): セッションを非公開にするかどうか。
        - `idempotent` (boolean | null, optional): `true` に設定すると冪等性が有効になる。
        - `max_acu_limit` (integer | null, optional): セッションの最大ACU (Active Compute Unit) 制限。
        - `planning_mode_agency` (enum<string> | null, optional): プランニングモードのエージェンシー設定。デフォルトは `auto_confirm`。利用可能なオプション: `auto_confirm`, `sync_confirm`。
        - `secret_ids` (string[] | null, optional): 使用するシークレットIDのリスト。`None` の場合はすべてのシークレットを使用。空リストの場合はシークレットを使用しない。
        - `knowledge_ids` (string[] | null, optional): 使用するナレッジIDのリスト。`None` の場合はすべてのナレッジを使用。空リストの場合はナレッジを使用しない。
        - `tags` (string[] | null, optional): セッションに追加するタグのリスト。
        - `title` (string | null, optional): セッションのカスタムタイトル。`None` の場合は自動生成される。
    - **レスポンス (200 OK - application/json):**
        - `session_id` (string, required): 作成されたセッションの一意な ID。
        - `url` (string, required): Web インターフェースでセッションを表示するための URL。
        - `is_new_session` (boolean, optional): 新しいセッションが作成されたかどうかを示す (`idempotent: true` の場合にのみ存在)。
    - **参照:** [Create a new session](https://docs.devin.ai/api-reference/sessions/create-a-new-devin-session)

- **`GET /v1/sessions` (List Sessions)**
    - **目的:** 組織の現在の Devin セッションをリスト表示する。ページネーションとタグによるフィルタリングが可能。
    - **メソッド:** `GET`
    - **パス:** `/v1/sessions`
    - **クエリパラメータ:**
        - `limit` (integer, optional, default: 100): 1ページあたりに返すセッションの最大数 (1〜1000)。
        - `offset` (integer, optional, default: 0): ページネーションのためにスキップするセッション数 (0以上)。
        - `tags` (string[], optional): 指定したタグを持つセッションのみをフィルタリングする。
    - **レスポンス (200 OK - application/json):**
        - `sessions` (object[], required): セッションオブジェクトの配列。
            - `session_id` (string, required): セッションの一意な ID。
            - `status` (string, required): セッションの現在のステータス文字列。
            - `title` (string, required): セッションのタイトルまたは説明。
            - `created_at` (string, required): セッション作成日時 (ISO 8601)。
            - `updated_at` (string, required): セッション最終更新日時 (ISO 8601)。
            - `snapshot_id` (string | null): 関連付けられたスナップショットID (存在する場合)。
            - `playbook_id` (string | null): 関連付けられたプレイブックID (存在する場合)。
            - `tags` (string[] | null): セッションに関連付けられたタグのリスト。
            - `pull_request` (object | null): 関連付けられたプルリクエスト情報 (存在する場合)。
                - `url` (string): プルリクエストの URL。
            - `structured_output` (string | null): イベントからの最新の構造化出力値。
            - `status_enum` (string | null): ステータス更新からの最新のステータス列挙値。
    - **参照:** [List all sessions](https://docs.devin.ai/api-reference/sessions/list-sessions)

- **`GET /v1/session/{session_id}` (Get Session Details)**
    - **目的:** 既存の Devin セッションの詳細情報 (ステータス、出力、メタデータ) を取得する。
    - **メソッド:** `GET`
    - **パス:** `/v1/session/{session_id}`
    - **パスパラメータ:**
        - `session_id` (string, required): 詳細を取得したいセッションの ID。
    - **レスポンス (200 OK - application/json):**
        - `session_id` (string, required): セッションの一意な ID。
        - `status` (string, required): セッションの現在のステータス文字列。
        - `title` (string | null): セッションのタイトル。
        - `created_at` (string): 作成日時 (ISO 8601)。
        - `updated_at` (string): 最終更新日時 (ISO 8601)。
        - `snapshot_id` (string | null): 使用されたマシンスナップショットのID。
        - `playbook_id` (string | null): 使用されたプレイブックのID。
        - `tags` (string[] | null): セッションに関連付けられたタグのリスト。
        - `pull_request` (object | null): プルリクエスト情報 (関連付けがない場合は null)。`url` フィールドを含む。
        - `structured_output` (object | null): タスク固有の構造化出力 (JSON 形式)。
        - `status_enum` (enum<string> | null): セッションステータスの列挙値。利用可能なオプション: `RUNNING`, `blocked`, `stopped` (ドキュメント記載)。これ以外にも `finished`, `suspended` などが存在する可能性あり (実装上の注意点参照)。
    - **実装:** Devin の応答は非同期なため、定期的なポーリング (推奨 10-30 秒間隔) が必要。`status_enum` や `structured_output` の変化を監視して、セッションの状態遷移や結果を確認する。
    - **参照:** [Retrieve details about an existing session](https://docs.devin.ai/api-reference/sessions/retrieve-details-about-an-existing-session)

- **`POST /v1/session/{session_id}/message` (Send Message)**
    - **目的:** 既存の Devin セッションに追加の指示や情報 (または `SLEEP` による中断指示) を送信する。
    - **メソッド:** `POST`
    - **パス:** `/v1/session/{session_id}/message`
    - **パスパラメータ:**
        - `session_id` (string, required): メッセージを送信するセッションの ID。
    - **リクエストボディ (JSON):**
        - `message` (string, required): Devin に送信するメッセージ内容。
    - **レスポンス:**
        - `204 No Content`: メッセージ送信成功時にボディなしで返される。
    - **注意:** この API を呼び出しても、Devin からの直接的な会話応答は返りません。Devin の反応は、`GET /v1/session/{session_id}` をポーリングして `status_enum` の変化や `structured_output` の更新を確認する必要があります。
    - **参照:** [Send a message to an existing session](https://docs.devin.ai/api-reference/sessions/send-a-message-to-an-existing-devin-session)

- **`POST /v1/attachments` (Upload Files)**
    - **目的:** セッション中に Devin が使用するファイル (コード、データ、ドキュメントなど) をアップロードする。
    - **メソッド:** `POST`
    - **パス:** `/v1/attachments`
    - **リクエストボディ (`multipart/form-data`):**
        - `file`: アップロードするファイル本体。
    - **レスポンス (200 OK - `text/plain`):**
        - アップロードされたファイルにアクセスするための URL 文字列 (例: `"https://storage.devin.ai/attachments/xxx/file.py"`)。
    - **重要:** このエンドポイントはファイルをサーバーに保存し URL を返すだけです。Devin がファイルを使用するには、返された URL を `POST /sessions` の `prompt` や `POST /session/{session_id}/message` の `message` に含めて Devin に渡す必要があります。
    - **参照:** [Upload files for Devin](https://docs.devin.ai/api-reference/attachments/upload-files-for-devin-to-work-with), [Examples](https://docs.devin.ai/api-reference/examples)

- **`PUT /v1/session/{session_id}/tags` (Update Session Tags)**
    - **目的:** Devin セッションに関連付けられたタグを更新する。
    - **メソッド:** `PUT`
    - **パス:** `/v1/session/{session_id}/tags`
    - **パスパラメータ:**
        - `session_id` (string, required): タグを更新するセッションの ID。
    - **リクエストボディ (JSON):**
        - `tags` (string[], required): セッションに設定するタグのリスト (既存のタグは上書きされます)。
    - **レスポンス (200 OK - application/json):**
        - `detail` (string): 成功メッセージ (例: `"Tags updated successfully"`)。
    - **注意:** このエンドポイントはエンタープライズ向け機能の可能性がありますが、ドキュメント上は明記されていません。
    - **参照:** [Update session tags](https://docs.devin.ai/api-reference/sessions/update-session-tags)

### 3.2. シークレット管理 (Secrets)

- **`GET /v1/secrets` (List Secrets Metadata)**
    - **目的:** 組織内のすべてのシークレットのメタデータをリスト表示する。シークレットの値自体は返されない。
    - **メソッド:** `GET`
    - **パス:** `/v1/secrets`
    - **レスポンス (200 OK - application/json):**
        - `secrets` (object[], required): シークレットメタデータオブジェクトの配列。
            - `secret_id` (string, required): シークレットの一意な ID (例: `sec_xxx`)。
            - `secret_type` (enum<string>, required): シークレットのタイプ。利用可能なオプション: `cookie`, `key-value`, `dictionary`, `totp`。
            - `secret_name` (string, required): ユーザー定義のシークレット名。
            - `created_at` (string, required): 作成日時 (ISO 8601)。
    - **参照:** [List all secrets metadata](https://docs.devin.ai/api-reference/sessions/list-secrets)

- **`DELETE /v1/secrets/{secret_id}` (Delete Secret)**
    - **目的:** 指定した ID のシークレットを組織から永久に削除する。この操作は取り消し不可。
    - **メソッド:** `DELETE`
    - **パス:** `/v1/secrets/{secret_id}`
    - **パスパラメータ:**
        - `secret_id` (string, required): 削除するシークレットの ID。
    - **レスポンス:**
        - `204 No Content`: シークレット削除成功時にボディなしで返される。
    - **参照:** [Delete a secret](https://docs.devin.ai/api-reference/sessions/delete-secret)

### 3.3. エンタープライズ (Enterprise)

- **`GET /v1/audit-logs` (List Audit Logs)**
    - **目的:** 組織のすべての監査ログをリスト表示する。ページネーションとタイムスタンプによるフィルタリングが可能。
    - **メソッド:** `GET`
    - **パス:** `/v1/audit-logs`
    - **クエリパラメータ:**
        - `limit` (integer, optional, default: 100): 返す監査ログの最大数 (1以上)。
        - `before` (string, optional): 指定したタイムスタンプより前のログをフィルタリング。
        - `after` (string, optional): 指定したタイムスタンプより後のログをフィルタリング。
    - **レスポンス (200 OK - application/json):**
        - `audit_logs` (object[], required): 監査ログエントリオブジェクトの配列。
            - `created_at` (integer): 作成タイムスタンプ (ミリ秒単位の Unix タイムスタンプ)。
            - `action` (enum<string>): 実行されたアクション。利用可能なオプション多数 (例: `login`, `add_member`, `create_session`, `send_message`, `delete_secret` など。詳細はドキュメント参照)。
            - `ip` (string, optional): アクションを実行した IP アドレス (例: `login` 時)。
            - `user_id` (string, optional): アクションを実行したユーザー ID (例: `login` 時)。
            - `session_id` (string, optional): 関連するセッション ID (例: `login`, `create_session` 時)。
            - `target_user_id` (string, optional): アクションの対象となったユーザー ID (例: `add_member` 時)。
            - `roles` (string[], optional): 割り当てられたロール (例: `assign_roles` 時)。
            - ... (その他アクション固有のフィールドが存在する可能性あり)
    - **参照:** [List all audit logs](https://docs.devin.ai/api-reference/audit-logs/list-audit-logs)

- **`GET /v1/enterprise/consumption` (Get Enterprise Consumption)**
    - **目的:** エンタープライズ組織の指定期間における詳細な消費データを取得する。
    - **メソッド:** `GET`
    - **パス:** `/v1/enterprise/consumption`
    - **クエリパラメータ:**
        - `start_date` (string, required): 開始日 (ISO 形式: YYYY-MM-DD)。
        - `end_date` (string, required): 終了日 (ISO 形式: YYYY-MM-DD)。
    - **レスポンス (200 OK - application/json):**
        - エンタープライズ消費データ構造 (詳細はドキュメントに記載なし、空の `{}` が例として示されている)。
    - **参照:** [Get enterprise consumption data](https://docs.devin.ai/api-reference/enterprise/get-enterprise-consumption)

## 4. 実装上の注意点とベストプラクティス

- **API 安定性:** Alpha 版のため、変更の可能性あり。
- **非同期性:** `GET /session/{session_id}` は定期的なポーリングが必要。推奨間隔は 10-30 秒 ([Structured Output](https://docs.devin.ai/api-reference/structured-output))。
- **Structured Output の活用:** プロンプトでのスキーマ定義と更新指示が重要。ただし、更新タイミングは Devin 次第。**現状、単純な会話応答の取得には不向きな可能性が高い。**
- **会話フローの限界:** `POST /message` への直接的な会話応答はない。**Web UI で表示されるような詳細な思考プロセスやテキスト応答は、現状の API では取得できない可能性が高い。**
- **エラーハンドリング:** API リクエスト失敗時のリトライ、予期せぬセッション状態への対応が必要。
- **レート制限:** 公式ドキュメントに明記されていないが、過度なポーリングは避ける。
- **Idempotency:** ([Overview](https://docs.devin.ai/api-reference/overview))
    - ネットワーク不安定時やリトライ実装時に有効。
    - `POST /sessions` など対応するエンドポイントで `idempotent: true` を設定する。
    - 同じリクエストを再試行した場合、新しいリソースを作成せず既存のものを返す。
    - レスポンスの `is_new_session` フィールドで新規作成かどうかがわかる。
- **キーワード (`sleep`, `exit`, `mute`, `unmute` など):**
    - `sleep`, `exit` などの一部のキーワードは、`POST /session/{session_id}/message` で送信されると、Devin サーバー側で解釈され、セッションの状態を変化させる可能性がある (Web UI での挙動から推測)。
    - しかし、これらのキーワードの正確なリストや挙動は API ドキュメントには明記されていない。
    - `mute`, `unmute` については、現時点の API 経由での明確な効果は確認されていない。アプリケーションレベルでのミュート機能が必要な場合は、クライアント側での実装が必要となる。

## 5. コード例 (TypeScript / Node.js)

[axios](https://axios-http.com/) と `async/await` を使用した例です。

**注意:** 実際の利用には `axios` と `form-data` (ファイルアップロード用) のインストールが必要です (`npm install axios form-data` または `yarn add axios form-data`)。

### 5.1. セッション作成とモニタリング

```typescript
import axios from 'axios';
import { setTimeout } from 'timers/promises'; // Node.js v16+ で利用可能

const DEVIN_API_KEY = process.env.DEVIN_API_KEY;
const API_BASE = 'https://api.devin.ai/v1';

interface CreateSessionResponse {
    session_id: string;
    url: string;
    is_new_session?: boolean;
}

interface SessionDetailsResponse {
    session_id: string;
    status: string;
    title: string | null;
    created_at: string;
    updated_at: string;
    snapshot_id: string | null;
    playbook_id: string | null;
    structured_output: any | null; // 実際の型に合わせて調整
    status_enum: 'RUNNING' | 'blocked' | 'stopped' | 'finished' | 'suspended' | string | null;
    // 他のフィールド...
}

const headers = {
    'Authorization': `Bearer ${DEVIN_API_KEY}`,
    'Content-Type': 'application/json'
};

async function createAndMonitorSession() {
    if (!DEVIN_API_KEY) {
        console.error('環境変数 DEVIN_API_KEY が設定されていません。');
        return;
    }

    try {
        // セッションを作成 (冪等性を有効化)
        const createResponse = await axios.post<CreateSessionResponse>(
            `${API_BASE}/sessions`,
            {
                prompt: 'GitHubリポジトリのスター数を数える: https://github.com/typescript-eslint/typescript-eslint',
                idempotent: true
            },
            { headers }
        );

        const sessionData = createResponse.data;
        const sessionId = sessionData.session_id;
        console.log(`セッション作成: ${sessionId}, URL: ${sessionData.url}`);
        if (sessionData.is_new_session === false) {
            console.log('冪等性により既存のセッションを使用します。');
        }

        // ポーリングでセッションステータスを監視
        console.log('結果をポーリング中...');
        let pollCount = 0;
        const maxPolls = 20; // 無限ループを避けるための上限
        const pollIntervalSeconds = 15;
        const terminalStates = ['blocked', 'stopped', 'finished', 'suspended'];

        while (pollCount < maxPolls) {
            pollCount++;
            try {
                const statusResponse = await axios.get<SessionDetailsResponse>(
                    `${API_BASE}/session/${sessionId}`,
                    { headers: { 'Authorization': `Bearer ${DEVIN_API_KEY}` } } // GETでもAuthorizationは必要
                );
                const statusData = statusResponse.data;
                const currentStatus = statusData.status_enum || 'N/A';
                console.log(`現在のステータス (${pollCount}): ${currentStatus}`);

                // 終了状態か確認
                if (currentStatus && terminalStates.includes(currentStatus)) {
                    console.log('\n最終ステータス:');
                    console.log(JSON.stringify(statusData, null, 2));
                    if (statusData.structured_output) {
                        console.log('\nStructured Output:');
                        console.log(JSON.stringify(statusData.structured_output, null, 2));
                    }
                    break; // 終了状態ならループを抜ける
                }

                // 指定時間待機
                await setTimeout(pollIntervalSeconds * 1000);

            } catch (pollError) {
                console.error(`ポーリング中にエラーが発生しました (${pollCount}):`, pollError);
                // エラーの種類に応じてリトライまたは中断を実装
                break;
            }
        }
        if (pollCount >= maxPolls) {
            console.warn('最大ポーリング回数に達しました。');
        }

    } catch (error) {
        console.error('セッション作成またはポーリング開始時にエラーが発生しました:', error);
    }
}

createAndMonitorSession();
```

### 5.2. ファイルアップロードと利用

```typescript
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data'; // form-data ライブラリが必要

const DEVIN_API_KEY = process.env.DEVIN_API_KEY;
const API_BASE = 'https://api.devin.ai/v1';
const FILE_PATH = 'data.csv'; // このファイルを処理

async function uploadAndProcessFile() {
    if (!DEVIN_API_KEY) {
        console.error('環境変数 DEVIN_API_KEY が設定されていません。');
        return;
    }

    if (!fs.existsSync(FILE_PATH)) {
        console.error(`エラー: ファイルが見つかりません - ${FILE_PATH}`);
        return;
    }

    try {
        // ファイルをアップロード
        const form = new FormData();
        form.append('file', fs.createReadStream(FILE_PATH), path.basename(FILE_PATH));

        const uploadResponse = await axios.post<string>( // レスポンスはテキスト (URL)
            `${API_BASE}/attachments`,
            form,
            {
                headers: {
                    ...form.getHeaders(), // form-data が Content-Type を設定
                    'Authorization': `Bearer ${DEVIN_API_KEY}`
                }
            }
        );

        const fileUrl = uploadResponse.data;
        console.log(`ファイルアップロード成功。URL: ${fileUrl}`);

        // アップロードしたファイルを処理するセッションを作成
        const sessionResponse = await axios.post<CreateSessionResponse>(
            `${API_BASE}/sessions`,
            {
                prompt: `アップロードされたファイルのデータを分析してください: ${fileUrl}`
            },
            {
                headers: {
                    'Authorization': `Bearer ${DEVIN_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const sessionData = sessionResponse.data;
        console.log(`ファイル処理用セッション作成: ${sessionData.session_id}`);
        // この session_id を前の例のように監視します

    } catch (error) {
        console.error('ファイルアップロードまたはセッション作成中にエラーが発生しました:', error);
    }
}

uploadAndProcessFile();

// 上記で使用した CreateSessionResponse インターフェースの定義
interface CreateSessionResponse {
    session_id: string;
    url: string;
    is_new_session?: boolean;
}
```

### 5.3. メッセージ送信

```typescript
import axios from 'axios';

const DEVIN_API_KEY = process.env.DEVIN_API_KEY;
const API_BASE = 'https://api.devin.ai/v1';
const sessionId = 'devin-xxxxxxxx...'; // アクティブなセッションIDに置き換えてください

async function sendMessageToSession() {
    if (!DEVIN_API_KEY) {
        console.error('環境変数 DEVIN_API_KEY が設定されていません。');
        return;
    }

    try {
        const messageResponse = await axios.post(
            `${API_BASE}/session/${sessionId}/message`,
            {
                message: '完了したら単体テストを作成してください。'
            },
            {
                headers: {
                    'Authorization': `Bearer ${DEVIN_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                // 204 No Content でもエラーにならないようにする
                validateStatus: (status) => status >= 200 && status < 300
            }
        );

        if (messageResponse.status === 204) {
            console.log(`セッション ${sessionId} にメッセージを正常に送信しました。`);
        } else {
            // 通常ここには到達しないはず (axios は 2xx 以外をエラーとするため)
            console.warn(`予期せぬステータスコード: ${messageResponse.status}`);
        }

    } catch (error) {
        console.error(`メッセージ送信中にエラーが発生しました:`, error);
        // エラー処理 (例: セッションが見つからない、無効な状態など)
    }
}

sendMessageToSession();
```
