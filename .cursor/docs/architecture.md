# 技術スタック

*   **言語:** TypeScript
*   **実行環境:** Node.js
*   **Discord Bot フレームワーク:** discord.js
*   **インフラストラクチャ:** AWS CDK (TypeScript)
    *   **コンピューティング:** AWS Fargate
    *   **データベース (状態管理):** Amazon DynamoDB (予定)
    *   **機密情報管理:** AWS Secrets Manager
    *   **API エンドポイント (OAuth等):** Amazon API Gateway + AWS Lambda (予定)
*   **テストフレームワーク:** Jest
*   **その他:** ESLint, Prettier

# アーキテクチャ概要 (予定)

このアプリケーションは、AWS Fargate 上で動作する Node.js (TypeScript) の Discord Bot プロセスを中心とします。

1.  **Discord 連携:** `discord.js` ライブラリを使用し、Discord Gateway API に接続してイベント (メッセージ受信など) をリッスンします。ユーザーからのメンションやコマンドに応じて、Discord API を介してメッセージ送信やスレッド作成を行います。
2.  **Devin API 連携:** ユーザーからの指示に基づき、内部の Devin API クライアント (HTTPS 通信) を介して Devin サービスと対話します。セッションの開始、メッセージの送受信などを行います。
3.  **状態管理:** `mute`/`unmute` 状態、Devin セッションと Discord スレッドのマッピングなどの情報は、初期段階ではインメモリ、将来的には Amazon DynamoDB に永続化する可能性があります。
4.  **機密情報管理:** Discord Bot Token や Devin API Key (将来) は AWS Secrets Manager に安全に格納し、Fargate タスク定義から参照します。
5.  **アカウント連携 (オプション):** OAuth フローのために API Gateway と Lambda を使用し、ユーザー認証とアカウント情報の紐付けを行う可能性があります。

```mermaid
graph LR
    User[Discord User] -- @Devin mentions --> DiscordAPI[Discord API]
    DiscordAPI -- Events (message) --> Bot[Discord Bot (Fargate / discord.js)]
    Bot -- Commands (reply, create thread) --> DiscordAPI
    Bot -- Start Session, Send Message --> DevinAPI[Devin API Client]
    DevinAPI -- HTTPS --> DevinService[Devin Service]
    Bot -- Read/Write State --> StateStore[State Store (In-Memory / DynamoDB)]
    Bot -- Get Secret --> SecretsManager[AWS Secrets Manager]
    subgraph Optional Account Linking
        User -- OAuth Flow --> APIEndpoint[API Gateway + Lambda]
        APIEndpoint -- Store Mapping --> StateStore
    end
```
