import { spawn, ChildProcess } from "child_process";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import express, { Request, Response, RequestHandler } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { CONFIG, GEMINI_API_KEY } from "./config.js";
import { Logger } from "./logger.js";
import { ItemRepository } from "./repository.js";
import { LlmService } from "./llmService.js";
import { SiteDataProvider } from "./siteDataProvider.js";
import { ItemSearchService } from "./searchService.js";
import { HttpServer } from "./httpServer.js";
import { McpServerWrapper } from "./mcpServer.js";

// ==========================================
// Global Scope Variables
// ==========================================
const logger = new Logger("MainApp");

// ==========================================
// Configuration Data
// ==========================================
// TODO: Decide where TARGET_WEBSITES should live and how it's accessed by ItemSearchService
// Example: const TARGET_WEBSITES = JSON.parse(fs.readFileSync(path.join(__dirname, 'websites.json'), 'utf-8'));

// ==========================================
// Server Startup Logic
// ==========================================

async function startServer() {
  logger.info("サーバー起動プロセスを開始します...");
  try {
    // 1. Initialize Services
    logger.info("リポジトリとサービスを初期化中...");
    const repository = new ItemRepository(CONFIG.DB_DIR);
    const llmService = new LlmService(GEMINI_API_KEY!, CONFIG.GEMINI_MODEL);
    // TODO: Consider how/where to load TARGET_WEBSITES if needed by SiteDataProvider or SearchService
    const siteDataProviderConfig = {
      TMP_DIR: CONFIG.TMP_DIR,
      ALTERNATIVE_CACHE_DIR: CONFIG.ALTERNATIVE_CACHE_DIR,
      SITEMCP_CONCURRENCY: CONFIG.SITEMCP_CONCURRENCY,
      SITEMCP_TIMEOUT: CONFIG.SITEMCP_TIMEOUT,
      USE_FALLBACK_FOR_FAILED_SITES: CONFIG.USE_FALLBACK_FOR_FAILED_SITES,
      // Pass TARGET_WEBSITES here if needed: targetWebsites: TARGET_WEBSITES
    };
    const siteDataProvider = new SiteDataProvider(
      siteDataProviderConfig,
      llmService
    );
    const searchService = new ItemSearchService(
      repository,
      llmService,
      siteDataProvider
    );
    logger.info("サービス初期化完了。");

    // 2. Initialize and Start HTTP Server
    logger.info("HTTPサーバーを初期化中...");
    const httpServer = new HttpServer(CONFIG.HTTP_PORT, searchService);
    logger.info("HTTPサーバー初期化完了。");

    // 3. Initialize and Start MCP Server (Stdio)
    logger.info("MCPサーバー(Stdio)を初期化中...");
    const mcpServer = new McpServerWrapper(searchService);
    await mcpServer.start(); // Start the MCP server
    logger.info("MCPサーバー(Stdio)初期化および起動完了。");

    logger.info("すべてのサーバーが正常に起動しました。");

    // Graceful shutdown handling
    const shutdown = async () => {
      // Made async for potential cleanup
      logger.info("サーバーをシャットダウンしています...");
      // Add cleanup logic: e.g., await mcpServer.stop();
      // Add HTTP server cleanup if needed: await new Promise(res => httpServer.app.close(res));
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    logger.error("サーバー起動中に致命的なエラーが発生しました:", error);
    process.exit(1);
  }
}

// Global Error Handling
process.on("uncaughtException", (err, origin) => {
  console.error(`未捕捉の例外 (${origin}):`, err);
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("未処理のPromise拒否:", promise, "理由:", reason);
});

// Start the server
startServer();
