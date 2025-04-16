import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// 環境変数の読み込み
dotenv.config();

// 環境変数の検証
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set in environment variables");
}

// サーバー設定
export const CONFIG = {
  HTTP_PORT: parseInt(process.env.MCP_SERVER_PORT || "3000", 10),
  DB_DIR: path.join(process.cwd(), "db"), // データ保存ディレクトリ
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  GEMINI_MODEL: "gemini-1.5-flash", // 使用するLLMモデル (Updated model)
  TMP_DIR: path.join(process.cwd(), "tmp"), // 一時ファイル用ディレクトリ
  SITEMCP_CONCURRENCY: 3, // サイトデータ取得同時実行数
  SITEMCP_MAX_RETRIES: 2, // サイトデータ取得再試行回数
  SEARCH_TIMEOUT: 90000, // 検索処理の最大実行時間 (ms)
  SITEMCP_TIMEOUT: 60000, // sitemcpの実行タイムアウト (ms)
  WEB_SEARCH_TIMEOUT: 45000, // Web検索部分の個別タイムアウト (ms)
  MAX_SIMULTANEOUS_SEARCHES: 2, // 同時に実行可能な検索処理の最大数
  USE_FALLBACK_FOR_FAILED_SITES: true, // サイト検索失敗時に簡易情報を生成するか
  ALTERNATIVE_CACHE_DIR: path.join(process.cwd(), "cache", "sitemcp"), // 代替キャッシュディレクトリ
};

// ディレクトリが存在しない場合は作成
export function setupDirectories(): void {
  const dirsToCreate = [
    CONFIG.DB_DIR,
    CONFIG.TMP_DIR,
    CONFIG.ALTERNATIVE_CACHE_DIR,
  ];
  dirsToCreate.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });
}

// 初期セットアップ実行
setupDirectories();
