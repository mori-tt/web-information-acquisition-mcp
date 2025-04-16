import fs from "fs";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import { Logger } from "./logger.js";
import { CONFIG } from "./config.js";
import { ItemInfo, PageData, WebsiteConfig } from "./types.js";
import { LlmService } from "./llmService.js"; // Needed for extractInfoFromPage

// Define a subset of CONFIG relevant to this service
interface SiteDataProviderConfig {
  TMP_DIR: string;
  ALTERNATIVE_CACHE_DIR: string;
  SITEMCP_CONCURRENCY: number;
  SITEMCP_TIMEOUT: number;
  USE_FALLBACK_FOR_FAILED_SITES: boolean;
}

export class SiteDataProvider {
  private logger: Logger;
  private config: SiteDataProviderConfig;
  private llmService: LlmService; // To extract info from pages

  constructor(config: SiteDataProviderConfig, llmService: LlmService) {
    this.logger = new Logger("SiteDataProvider");
    this.config = config;
    this.llmService = llmService;
    // Ensure necessary directories exist (can be redundant if setupDirectories is always called first)
    const dirsToCreate = [
      this.config.TMP_DIR,
      this.config.ALTERNATIVE_CACHE_DIR,
    ];
    dirsToCreate.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.info(`Created directory: ${dir}`);
      }
    });
  }

  /**
   * sitemcpを使って特定のWebサイトから情報を取得
   */
  async searchWebsiteWithSitemcp(
    website: WebsiteConfig,
    query: string
  ): Promise<ItemInfo[]> {
    this.logger.info(`${website.name}(${website.url})から情報を取得: ${query}`);

    try {
      const tempDir = path.join(this.config.TMP_DIR, website.name);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const altCacheDir = path.join(
        this.config.ALTERNATIVE_CACHE_DIR,
        website.name
      );
      if (!fs.existsSync(altCacheDir)) {
        fs.mkdirSync(altCacheDir, { recursive: true });
      }

      const possibleCachePaths = [
        path.join(
          process.env.HOME || process.env.USERPROFILE || "",
          ".cache",
          "sitemcp",
          website.url.replace(/https?:\/\//, "").replace(/\//g, "_")
        ),
        path.join(
          process.env.HOME || process.env.USERPROFILE || "",
          ".cache",
          "sitemcp",
          website.url.replace(/https?:\/\//, "")
        ),
        altCacheDir, // 独自キャッシュディレクトリ
      ];

      let cacheDir: string | null = null;
      for (const cachePath of possibleCachePaths) {
        if (fs.existsSync(cachePath)) {
          this.logger.info(`既存のキャッシュディレクトリを使用: ${cachePath}`);
          cacheDir = cachePath;
          break;
        }
      }

      if (!cacheDir) {
        try {
          await Promise.race([
            this.runSitemcpWithTimeout(website, altCacheDir),
            new Promise<void>((_, reject) =>
              setTimeout(
                () => reject(new Error("タイムアウト")),
                this.config.SITEMCP_TIMEOUT
              )
            ),
          ]);

          for (const cachePath of possibleCachePaths) {
            if (fs.existsSync(cachePath)) {
              this.logger.info(
                `新規作成されたキャッシュディレクトリを使用: ${cachePath}`
              );
              cacheDir = cachePath;
              break;
            }
          }
          if (!cacheDir && fs.existsSync(altCacheDir)) {
            cacheDir = altCacheDir;
            this.logger.info(
              `代替キャッシュディレクトリを使用: ${altCacheDir}`
            );
          }
        } catch (err) {
          this.logger.warn(
            `${website.name}のサイトデータ取得処理でエラー発生: ${err}`
          );
        }
      }

      if (!cacheDir) {
        this.logger.warn(
          `${website.name}のキャッシュディレクトリが見つかりません`
        );
        return this.config.USE_FALLBACK_FOR_FAILED_SITES
          ? this.generateSimpleWebItems(website, query)
          : [];
      }

      return await this.processWebsiteCache(cacheDir, website, query);
    } catch (error) {
      this.logger.error(
        `${website.name}からの情報取得中にエラーが発生: ${error}`
      );
      return this.config.USE_FALLBACK_FOR_FAILED_SITES
        ? this.generateSimpleWebItems(website, query)
        : [];
    }
  }

  /**
   * キャッシュディレクトリからWebサイト情報を処理
   */
  private async processWebsiteCache(
    cacheDir: string,
    website: WebsiteConfig,
    query: string
  ): Promise<ItemInfo[]> {
    try {
      const files = fs
        .readdirSync(cacheDir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => path.join(cacheDir, file));

      this.logger.info(
        `${website.name}のサイトから${files.length}ページのデータを処理します`
      );
      if (files.length === 0) return [];

      const items: ItemInfo[] = [];
      for (const file of files) {
        try {
          const pageData: PageData = JSON.parse(fs.readFileSync(file, "utf-8"));
          if (pageData.title && pageData.content) {
            const contentToCheck =
              `${pageData.title} ${pageData.content}`.toLowerCase();
            if (contentToCheck.includes(query.toLowerCase())) {
              // Use LlmService to extract info
              const itemInfo = await this.llmService.extractInfoFromPage(
                pageData,
                website,
                pageData.url || website.url
              );
              if (itemInfo) {
                items.push(itemInfo);
                if (items.length >= 3) {
                  // Limit results per site
                  this.logger.info(
                    `${website.name}から十分な情報が見つかりました (${items.length}件)`
                  );
                  break;
                }
              }
            }
          }
        } catch (error) {
          this.logger.error(
            `ファイル ${file} の処理中にエラーが発生: ${error}`
          );
        }
      }
      this.logger.info(
        `${website.name}から${items.length}件の情報を取得しました`
      );
      return items;
    } catch (error) {
      this.logger.error(
        `キャッシュ処理中にエラーが発生 (${website.name}): ${error}`
      );
      return [];
    }
  }

  /**
   * sitemcpを実行し、タイムアウトを設定する
   */
  private runSitemcpWithTimeout(
    website: WebsiteConfig,
    altCacheDir: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let sitemcpProcess: ChildProcess | null = null;
      let isDone = false; // 完了フラグ

      const command = "npx";
      const args = [
        "sitemcp",
        website.url,
        "--concurrency",
        this.config.SITEMCP_CONCURRENCY.toString(),
        "--max-length",
        "10000",
        "--limit",
        "5",
        "--no-recursive",
        altCacheDir ? `--cache-dir=${altCacheDir}` : null,
      ].filter(Boolean) as string[];

      this.logger.debug(`Executing sitemcp: ${command} ${args.join(" ")}`);

      try {
        sitemcpProcess = spawn(command, args, {
          stdio: "pipe",
          timeout: this.config.SITEMCP_TIMEOUT,
          detached: false,
        });

        let output = "";
        let errorOutput = "";

        sitemcpProcess.stdout?.on("data", (data) => {
          output += data.toString();
        });
        sitemcpProcess.stderr?.on("data", (data) => {
          errorOutput += data.toString();
          this.logger.debug(
            `sitemcp stderr (${website.name}): ${data
              .toString()
              .substring(0, 100)}...`
          );
        });

        sitemcpProcess.on("close", (code) => {
          if (isDone) return;
          isDone = true;
          if (code !== 0) {
            this.logger.warn(
              `sitemcpプロセス(${
                website.name
              })が終了コード ${code} で終了: ${errorOutput.substring(
                0,
                200
              )}...`
            );
          }
          resolve();
        });

        sitemcpProcess.on("error", (err) => {
          if (isDone) return;
          isDone = true;
          this.logger.error(
            `sitemcpプロセス(${website.name})の実行に失敗しました: ${err}`
          );
          resolve();
        });
      } catch (e) {
        if (isDone) return;
        isDone = true;
        this.logger.error(`sitemcpプロセス(${website.name})の起動に失敗: ${e}`);
        resolve();
      }

      const processTimeout = setTimeout(() => {
        if (isDone) return;

        if (sitemcpProcess && !sitemcpProcess.killed) {
          this.logger.warn(
            `${website.name}のサイトデータ取得がタイムアウトしました。プロセスを強制終了します。`
          );
          try {
            if (process.platform === "win32") {
              spawn("taskkill", [
                "/pid",
                sitemcpProcess.pid!.toString(),
                "/f",
                "/t",
              ]);
            } else {
              process.kill(-sitemcpProcess.pid!, "SIGKILL");
            }
          } catch (killError) {
            this.logger.error(
              `プロセス(${sitemcpProcess.pid})の終了に失敗: ${killError}`
            );
          }
        }
      }, this.config.SITEMCP_TIMEOUT);

      sitemcpProcess?.on("exit", () => clearTimeout(processTimeout));
    });
  }

  /**
   * キャッシュが利用できない場合に簡易的な情報を生成する
   */
  private generateSimpleWebItems(
    website: WebsiteConfig,
    query: string
  ): ItemInfo[] {
    this.logger.info(`${website.name}の簡易情報を生成します`);
    const fallbackItem: ItemInfo = {
      id: `web_${website.name}_fallback_${Date.now()}`,
      name: `${website.name}の情報 (${query})`,
      organization: website.description || website.name,
      description: `"${query}"に関連する情報。詳細はWebサイト(${website.url})でご確認ください。`,
      eligibility: "詳細はWebサイトをご確認ください",
      amount: "詳細はWebサイトをご確認ください",
      deadline: "最新情報はWebサイトでご確認ください",
      applicationProcess: "手順の詳細はWebサイトをご確認ください",
      url: website.url,
      category: "未分類 (フォールバック)",
      source: `${website.name} (簡易情報)`,
      createdAt: new Date().toISOString(),
    };
    return [fallbackItem];
  }
}
