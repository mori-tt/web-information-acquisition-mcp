# 情報取得・要約 MCP サーバー

## 概要

このプロジェクトは、指定されたキーワードに基づいて情報を検索・取得し、構造化データとして保存、さらに要約記事を生成するサーバーアプリケーションです。
Model Context Protocol (MCP) に準拠しており、標準入出力（Stdio）経由で MCP クライアントツールとして利用できるほか、HTTP API としても機能します。

大規模言語モデル（LLM: Google Gemini）を活用して情報の検索・抽出・要約を行い、特定の Web サイトからは `sitemcp` を利用してデータを収集します。取得した情報は JSON ファイルとしてローカルに保存されます。

## 主な機能

- **情報検索 (`search_items`):**
  - キーワードに基づき、保存済みデータおよび LLM/Web から関連情報を検索します。
  - Web 検索オプション (`useWeb`) により、リアルタイムの Web 情報取得を有効/無効化できます。
  - カテゴリによる絞り込みが可能です。
- **情報保存 (`save_item`):**
  - 指定された情報を構造化データ（JSON 形式）としてローカル DB（`./db` ディレクトリ）に保存します。
- **カテゴリ別情報取得 (`get_items_by_category`):**
  - 指定されたカテゴリに一致する保存済み情報を一覧取得します。
- **マークダウン要約生成 (`generate_markdown_summary`):**
  - 保存済みの情報（または特定のカテゴリの情報）を基に、LLM を利用してマークダウン形式の要約記事を生成します。
- **デュアルインターフェース:**
  - **MCP (Stdio):** 標準入出力を介して MCP クライアントと通信します。
  - **HTTP API:** `/api/tools/*` エンドポイントで各機能を提供します。

## アーキテクチャ・プロジェクト構成

コードは関心事の分離原則に基づき、以下のモジュールに分割されています。

- **`web-mcp.ts` (or `main.ts`):** アプリケーションのエントリーポイント。各モジュールの初期化、サーバー（HTTP, MCP）の起動、グローバルエラーハンドリングを担当。
- **`config.ts`:** 環境変数読み込み、設定値（ポート、ディレクトリパス、API キー、モデル名、タイムアウト等）の定義、初期ディレクトリ作成。
- **`logger.ts`:** `Logger` クラス。コンテキストに応じた標準化されたログ出力機能を提供。
- **`types.ts`:** プロジェクト全体で使用される TypeScript のインターフェース定義（`ItemInfo`, `ApiResponse`, `WebsiteConfig` 等）。
- **`repository.ts`:** `ItemRepository` クラス。データ永続化層。JSON ファイルの読み書き（アイテムの保存、取得、更新、検索）を担当。
- **`llmService.ts`:** `LlmService` クラス。Google Gemini API との連携を担当。プロンプトに基づき情報の検索、Web 検索結果からの情報生成、ページ内容からの情報抽出、マークダウン要約生成を行う。
- **`siteDataProvider.ts`:** `SiteDataProvider` クラス。`sitemcp` の実行、キャッシュ管理、Web ページデータの処理を担当。LLM Service を利用してページ内容から構造化情報を抽出する。
- **`searchService.ts`:** `ItemSearchService` クラス。コアビジネスロジック層。Repository, LLM Service, Site Data Provider を組み合わせて情報検索・保存・要約のワークフローを実行する。MCP ツールや HTTP API のハンドラーメソッドも含む。
- **`httpServer.ts`:** `HttpServer` クラス。Express フレームワークを用いた HTTP サーバーのセットアップ、ミドルウェア設定、API ルート（`/`, `/health`, `/api/tools/*`）定義、リッスン開始を担当。
- **`mcpServer.ts`:** `McpServerWrapper` クラス。MCP サーバー（`@modelcontextprotocol/sdk`）のセットアップ、ツール登録、Stdio トランスポート接続を担当。

## セットアップとインストール

### 前提条件

- Node.js (v18 以降推奨)
- npm または yarn

### 手順

1.  **リポジトリのクローン:**

    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2.  **依存関係のインストール:**

    ```bash
    npm install
    # または
    yarn install
    ```

3.  **環境変数の設定:**

    - プロジェクトルートに `.env` ファイルを作成します。
    - 必要な環境変数を設定します。最低限、Gemini API キーが必要です。

    ```dotenv
    # .env ファイルの例
    GEMINI_API_KEY=YOUR_GEMINI_API_KEY

    # オプション: ポートやログレベルなど (デフォルト値あり)
    # MCP_SERVER_PORT=3001
    # LOG_LEVEL=debug
    ```

    - `YOUR_GEMINI_API_KEY` は実際の Google AI Studio 等で取得した API キーに置き換えてください。

## サーバーの実行

1.  **TypeScript のコンパイル:**

    ```bash
    npm run build
    # または直接 tsc を使用 (tsconfig.json が適切に設定されている場合)
    # tsc
    ```

    これにより、`src` (またはルート) の `.ts` ファイルが `dist` ディレクトリに `.js` ファイルとして出力されます。

2.  **サーバーの起動:**
    ```bash
    npm start
    # または直接 Node.js で実行
    # node dist/web-mcp.js
    ```
    これにより、以下の両方が起動します。
    - **HTTP サーバー:** デフォルトでは `http://localhost:3000` でリクエストを待ち受けます。
    - **MCP (Stdio) サーバー:** 標準入出力を介して MCP クライアントからのリクエストを待ち受けます。

## 利用方法

### HTTP API

HTTP サーバーは以下のエンドポイントを提供します。

- **`GET /`**: サーバーの基本的な HTML ステータスページ。
- **`GET /health`**: ヘルスチェック用エンドポイント。`OK` を返します。
- **`POST /api/tools/search_items`**: 情報を検索します。
  - **リクエストボディ (例):**
    ```json
    {
      "query": "最新の補助金情報",
      "category": "IT",
      "useWeb": true
    }
    ```
  - **レスポンス:** `ApiResponse<ItemInfo[]>`
- **`POST /api/tools/save_item`**: 情報を保存します。
  - **リクエストボディ (例):** `ItemInfo` オブジェクト（`id`, `createdAt`, `source` を除く）
    ```json
    {
      "name": "テスト情報",
      "organization": "テスト組織",
      "description": "これはテスト保存の情報です",
      "eligibility": "テスト対象者",
      "amount": "100万円",
      "deadline": "2024-12-31",
      "applicationProcess": "テスト申請プロセス",
      "url": "https://example.com/test",
      "category": "テスト"
    }
    ```
  - **レスポンス:** `ApiResponse<ItemInfo>` (保存されたアイテム情報)
- **`POST /api/tools/get_items_by_category`**: カテゴリで情報を取得します。
  - **リクエストボディ (例):**
    ```json
    {
      "category": "IT"
    }
    ```
  - **レスポンス:** `ApiResponse<ItemInfo[]>`
- **`POST /api/tools/generate_markdown_summary`**: マークダウン要約を生成します。
  - **リクエストボディ (例):**
    ```json
    {
      "title": "IT関連補助金まとめ",
      "category": "IT",
      "includeIntro": true,
      "includeConclusion": true
    }
    ```
  - **レスポンス:** `ApiResponse<string>` (生成されたマークダウンテキスト)

### MCP (Stdio) サーバー

標準入出力を介して MCP クライアント（例: `@modelcontextprotocol/cli`）と通信します。
以下のツールが利用可能です。

- `search_items`
- `save_item`
- `get_items_by_category`
- `generate_markdown_summary`

各ツールのパラメータは HTTP API の `/api/tools/*` エンドポイントのそれに対応します。

## 設定項目

主要な設定は `.env` ファイルおよび `config.ts` で管理されます。

- **`.env`:**
  - `GEMINI_API_KEY`: (必須) Google Gemini API キー。
  - `MCP_SERVER_PORT`: HTTP サーバーのポート (デフォルト: 3000)。
  - `LOG_LEVEL`: ログレベル (`debug`, `info`, `warn`, `error`。デフォルト: `info`)。
- **`config.ts`:**
  - `GEMINI_MODEL`: 使用する Gemini モデル名。
  - `DB_DIR`, `TMP_DIR`, `ALTERNATIVE_CACHE_DIR`: 各種データ/キャッシュ用ディレクトリパス。
  - タイムアウト設定 (`SEARCH_TIMEOUT`, `SITEMCP_TIMEOUT`, `WEB_SEARCH_TIMEOUT`)。
  - 同時実行数 (`SITEMCP_CONCURRENCY`, `MAX_SIMULTANEOUS_SEARCHES`)。
  - その他動作設定。

## 主要な依存ライブラリ

- `@modelcontextprotocol/sdk`: MCP サーバー/クライアント機能を提供。
- `@google/generative-ai`: Google Gemini API との連携。
- `express`: HTTP サーバーフレームワーク。
- `cors`, `body-parser`: Express ミドルウェア。
- `zod`: スキーマ定義とバリデーション。
- `dotenv`: 環境変数ファイル `.env` の読み込み。
- `typescript`: 開発言語。
- `sitemcp` (via `npx`): Web サイトデータ収集ツール。

## TODO / 今後の課題

- **`TARGET_WEBSITES` の設定:** 現在 `searchService.ts` 内で `sitemcp` の対象サイトリストがプレースホルダーになっています。これを `config.ts` や別ファイル (`websites.json` 等) から読み込むように修正する必要があります。
- **エラーハンドリングの強化:** 各サービスレイヤーでのエラー伝播やハンドリングをより堅牢にする。
- **テスト:** ユニットテスト、インテグレーションテストを追加する。
- **`searchItems` の複雑性:** Web 検索タイムアウト時の部分結果取得ロジックなど、`searchService.ts` 内の `searchItems` メソッドの非同期処理を簡略化する検討。
- **状態管理:** `activeSearchRequests` のようなグローバル変数の管理方法を、よりスケーラブルな方法（クラスのプロパティ、状態管理ライブラリ等）に変更する検討。
# web-information-acquisition-mcp
