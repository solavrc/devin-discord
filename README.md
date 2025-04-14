# Devin Discord Bot

(ここにプロジェクトの簡単な説明を1-2文で記述します)

## 主な機能ハイライト

*   Discord チャンネルでの `@Devin` メンションによるタスク開始
*   ファイル添付によるコンテキスト提供
*   スレッド内での対話型セッション
*   キーワード (`mute`, `aside`, `snapshot:` など) によるセッション制御
*   (任意) Devin アカウント連携による機能拡張
*   (任意) DM によるセッション通知

## 基本的な使い方

1.  Devin Bot を Discord サーバーに追加します。
2.  任意のテキストチャンネルで `@<Bot名> <タスク内容>` とメンションします。
3.  Bot が作成したスレッド内で対話を開始します。

## リポジトリ構成とドキュメント

*   **`.cursor/docs/prd.md`**: 製品要求仕様 (PRD) と詳細な機能要件
*   **`.cursor/docs/architecture.md`**: 技術スタックとアーキテクチャ概要
*   **`.cursor/tasks/`**: 現在進行中のタスク管理
*   **`src/`**: Bot アプリケーションのソースコード (TypeScript)
*   **`cdk/`**: AWS CDK によるインフラ定義コード (TypeScript)
*   **`test/`**: Jest によるテストコード

# 要件定義

詳細な機能要件については、[`.cursor/docs/prd.md`](.cursor/docs/prd.md) を参照してください。
