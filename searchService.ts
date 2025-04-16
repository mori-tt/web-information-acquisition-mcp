import { ItemRepository } from "./repository.js";
import { LlmService } from "./llmService.js";
import { SiteDataProvider } from "./siteDataProvider.js";
import { Logger } from "./logger.js";
import { CONFIG } from "./config.js"; // Might need for MAX_SIMULTANEOUS_SEARCHES
import {
  ItemInfo,
  ApiSearchRequest,
  ApiResponse,
  WebsiteConfig,
} from "./types.js";
import { v4 as uuidv4 } from "uuid";

// Keep track of active requests globally or pass this state if needed
// For simplicity, keeping it global for now, but consider alternatives for scalability.
let activeSearchRequests = 0;

/**
 * Core service for searching, saving, and summarizing items.
 */
export class ItemSearchService {
  private repository: ItemRepository;
  private llmService: LlmService;
  private siteDataProvider: SiteDataProvider;
  private logger: Logger;

  constructor(
    repository: ItemRepository,
    llmService: LlmService,
    siteDataProvider: SiteDataProvider
  ) {
    this.repository = repository;
    this.llmService = llmService;
    this.siteDataProvider = siteDataProvider;
    this.logger = new Logger("ItemSearchService");
  }

  // --- Core Logic Methods --- (searchItems, searchFromWeb, saveItem)

  /**
   * 情報を検索する (Orchestration method)
   */
  async searchItems(params: {
    query: string;
    category?: string;
    useWeb?: boolean;
  }): Promise<ItemInfo[]> {
    const { query, category, useWeb = true } = params;
    this.logger.info(
      `情報検索: "${query}" カテゴリ: ${category || "なし"} Web使用: ${useWeb}`
    );

    if (activeSearchRequests >= CONFIG.MAX_SIMULTANEOUS_SEARCHES) {
      this.logger.warn(
        `同時検索リクエスト数の上限(${CONFIG.MAX_SIMULTANEOUS_SEARCHES})に達しました。検索を簡易モードで実行します。`
      );
      return this.llmService.searchWithAI(query, category);
    }

    activeSearchRequests++;
    let results: ItemInfo[] = [];
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      const searchPromise = (async () => {
        const aiResults = await this.llmService.searchWithAI(query, category);
        results = [...aiResults];
        this.logger.info(`AIモデルからの検索結果: ${aiResults.length}件`);

        if (useWeb) {
          // Note: TARGET_WEBSITES needs to be accessible. Ideally passed from config or main.
          // For now, assuming it's defined elsewhere or passed into searchItems if needed.
          // Let's modify searchFromWeb to not require it as a direct argument if possible,
          // or the caller (handleSearchItems) needs to provide it.
          // TODO: Revisit how TARGET_WEBSITES is managed.
          const webResults = await this.searchFromWeb(
            query,
            category /*, TARGET_WEBSITES */
          );

          // Web検索結果の統合 (Moved timeout handling here)
          if (webResults.length > 0) {
            let uniqueCount = 0;
            let updatedCount = 0;
            webResults.forEach((webItem) => {
              const duplicateId = this.repository.findDuplicateItem(webItem);
              if (duplicateId) {
                const updated = this.repository.updateItem(duplicateId, {
                  ...webItem,
                  source: `${webItem.source || "Web"} (更新)`,
                });
                if (updated) {
                  updatedCount++;
                  const existingIndex = results.findIndex(
                    (r) => r.id === duplicateId
                  );
                  if (existingIndex >= 0) {
                    results[existingIndex] = updated;
                  } else {
                    results.push(updated);
                  }
                }
              } else {
                uniqueCount++;
                results.push(webItem);
              }
            });
            this.logger.info(
              `Web検索結果の統合: ${webResults.length}件（新規: ${uniqueCount}件、更新: ${updatedCount}件）`
            );
          }
        }

        const filteredResults = category
          ? results.filter((item) =>
              item.category.toLowerCase().includes(category.toLowerCase())
            )
          : results;

        this.logger.info(
          `検索結果: ${filteredResults.length}件（フィルタリング後）`
        );
        return filteredResults;
      })();

      const timeoutPromise = new Promise<ItemInfo[]>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(`検索処理全体が${CONFIG.SEARCH_TIMEOUT}msを超過しました`)
          );
        }, CONFIG.SEARCH_TIMEOUT);
      });

      const finalResult = await Promise.race([searchPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      return finalResult;
    } catch (error) {
      if (error instanceof Error && error.message.includes("タイムアウト")) {
        this.logger.error(`検索処理全体がタイムアウトしました: ${error}`);
        return results.length > 0
          ? results // Return partial results on timeout
          : await this.llmService.searchWithAI(query, category).catch(() => []);
      } else {
        this.logger.error(`検索中にエラーが発生しました: ${error}`);
        return await this.llmService
          .searchWithAI(query, category)
          .catch(() => []);
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId); // Ensure cleared on error too
      activeSearchRequests--;
    }
  }

  /**
   * Webから情報を取得 (Internal helper)
   * TODO: Decouple TARGET_WEBSITES dependency
   */
  private async searchFromWeb(
    query: string,
    category: string | undefined
    // targetWebsites: WebsiteConfig[] // Removed dependency for now
  ): Promise<ItemInfo[]> {
    this.logger.info(`Webサイト検索を実行: ${query}`);
    let results: ItemInfo[] = [];
    // TODO: Need access to TARGET_WEBSITES from config or elsewhere
    const targetWebsites: WebsiteConfig[] = []; // Placeholder - MUST BE FIXED

    try {
      // LLM direct web search
      try {
        const directWebResults = await this.llmService.generateWebItems(
          query,
          category
        );
        if (directWebResults && directWebResults.length > 0) {
          results.push(...directWebResults);
          this.logger.info(
            `Web検索から${directWebResults.length}件の情報を直接生成`
          );
        }
      } catch (geminiError) {
        this.logger.warn(`Gemini Web検索データ生成エラー: ${geminiError}`);
      }

      // SiteDataProvider search
      try {
        const enabledWebsites = targetWebsites.filter((site) => site.enabled);
        const searchPromises = enabledWebsites.map((website) =>
          this.siteDataProvider
            .searchWebsiteWithSitemcp(website, query)
            .catch((err) => {
              this.logger.warn(
                `${website.name} SiteDataProvider エラー: ${err}`
              );
              return []; // Expect SiteDataProvider to handle fallback
            })
        );

        // Consider adding individual timeouts here if CONFIG.WEB_SEARCH_TIMEOUT per site is critical
        const settledResults = await Promise.allSettled(searchPromises);

        settledResults.forEach((result, index) => {
          if (result.status === "fulfilled" && result.value.length > 0) {
            results.push(...result.value);
            this.logger.info(
              `${enabledWebsites[index].name}から${result.value.length}件取得`
            );
          } else if (result.status === "rejected") {
            this.logger.error(
              `${enabledWebsites[index].name} 結果取得失敗: ${result.reason}`
            );
          }
        });
      } catch (siteDataError) {
        this.logger.error(`SiteDataProvider 全体エラー: ${siteDataError}`);
      }

      this.logger.info(`Webサイト検索結果（統合後）: ${results.length}件`);
      return results;
    } catch (error) {
      this.logger.error(`Webサイト検索中にエラー: ${error}`);
      return [];
    }
  }

  /**
   * 情報をDBに保存 (Simple delegation now)
   */
  saveItem(itemData: Omit<ItemInfo, "id" | "createdAt" | "source">): ItemInfo {
    const id = `item_${uuidv4()}`;
    const itemInfo: ItemInfo = {
      id,
      ...itemData,
      source: "Manual Save", // Assign default source directly
      createdAt: new Date().toISOString(),
    };
    // Validation could happen here before saving
    this.repository.saveItem(itemInfo);
    return itemInfo;
  }

  // --- Handler Methods (Moved from ItemMCPServer) ---

  async handleSearchItems(
    params: ApiSearchRequest
  ): Promise<ApiResponse<ItemInfo[]>> {
    try {
      // Call the core search logic
      const items = await this.searchItems(params);
      return {
        content: [
          {
            type: "text" as const,
            text: `「${params.query}」に関する情報が${items.length}件見つかりました。`,
          },
        ],
        data: items,
        isError: false,
      };
    } catch (error) {
      this.logger.error("情報検索ハンドラエラー:", error);
      return {
        content: [
          {
            type: "text" as const,
            text: `情報検索中にエラーが発生しました: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        error: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  async handleSaveItem(
    params: Omit<ItemInfo, "id" | "createdAt" | "source">
  ): Promise<ApiResponse<ItemInfo>> {
    try {
      // Call the core save logic
      const savedItem = this.saveItem(params);
      return {
        content: [
          {
            type: "text" as const,
            text: `情報「${params.name}」をDBに保存しました。ID: ${savedItem.id}`,
          },
        ],
        data: savedItem,
        isError: false,
      };
    } catch (error) {
      this.logger.error("情報保存ハンドラエラー:", error);
      return {
        content: [
          {
            type: "text" as const,
            text: `情報保存中にエラーが発生しました: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        error: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  async handleGetItemsByCategory(params: {
    category: string;
  }): Promise<ApiResponse<ItemInfo[]>> {
    try {
      const { category } = params;
      // Delegate directly to repository
      const items = this.repository.getItemsByCategory(category);
      const messagePrefix = category
        ? `カテゴリ「${category}」の情報が`
        : "保存済みの情報が";
      return {
        content: [
          {
            type: "text" as const,
            text: `${messagePrefix}${items.length}件見つかりました。`,
          },
        ],
        data: items,
        isError: false,
      };
    } catch (error) {
      this.logger.error("カテゴリ別情報取得ハンドラエラー:", error);
      return {
        content: [
          {
            type: "text" as const,
            text: `カテゴリ別情報取得中にエラーが発生しました: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        error: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  async handleGenerateMarkdownSummary(params: {
    category?: string;
    title: string;
    includeIntro: boolean;
    includeConclusion: boolean;
  }): Promise<ApiResponse<string>> {
    try {
      const { category, title, includeIntro, includeConclusion } = params;
      // 1. Get items from repository
      const items = category
        ? this.repository.getItemsByCategory(category)
        : this.repository.getAllItems();

      // 2. Generate markdown using LlmService
      const markdownText = await this.llmService.generateMarkdownSummary({
        title,
        items,
        includeIntro,
        includeConclusion,
      });

      return {
        content: [{ type: "text" as const, text: markdownText }],
        data: markdownText,
        isError: false,
      };
    } catch (error) {
      this.logger.error("マークダウンまとめ生成ハンドラエラー:", error);
      return {
        content: [
          {
            type: "text" as const,
            text: `マークダウン生成中にエラーが発生しました: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        error: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }
}
