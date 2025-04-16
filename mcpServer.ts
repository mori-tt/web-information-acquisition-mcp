import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ItemSearchService } from "./searchService.js";
import { Logger } from "./logger.js";
import { ItemInfo, ApiSearchRequest } from "./types.js";

export class McpServerWrapper {
  private server: McpServer;
  private searchService: ItemSearchService;
  private logger: Logger;

  constructor(searchService: ItemSearchService) {
    this.searchService = searchService;
    this.logger = new Logger("McpServerWrapper");
    this.server = new McpServer({
      name: "item-mcp-server",
      version: "1.0.0",
    });
    this.registerTools();
  }

  private registerTools(): void {
    this.logger.info("Registering MCP tools...");

    // Define MCP tool schema (could be moved to a shared location)
    const itemSchema = z.object({
      name: z.string().describe("情報の名称"),
      organization: z.string().describe("提供元・組織名"),
      description: z.string().describe("情報の概要説明"),
      eligibility: z.string().describe("対象条件"),
      amount: z.string().describe("関連する量・金額・規模"),
      deadline: z.string().describe("関連する期限・日付"),
      applicationProcess: z.string().describe("手順・プロセス"),
      url: z.string().describe("参照URL"),
      category: z.string().describe("カテゴリ"),
      requirementDetails: z.string().optional().describe("要件詳細"),
      exclusions: z.string().optional().describe("除外条件"),
      contactInfo: z.string().optional().describe("問い合わせ先"),
    });

    // Register MCP tools using handlers from ItemSearchService
    this.server.tool(
      "search_items",
      "指定されたキーワードに基づいて情報を検索します",
      {
        query: z.string().describe("検索キーワード"),
        category: z.string().optional().describe("カテゴリ"),
        useWeb: z
          .boolean()
          .optional()
          .default(true)
          .describe("Web検索を利用するか"),
      },
      (params: ApiSearchRequest, _extra) =>
        this.searchService.handleSearchItems(params)
    );

    this.server.tool(
      "save_item",
      "検索または生成した情報をDBに保存します",
      itemSchema.shape,
      (params: Omit<ItemInfo, "id" | "createdAt" | "source">, _extra) =>
        this.searchService.handleSaveItem(params)
    );

    this.server.tool(
      "get_items_by_category",
      "指定されたカテゴリの情報一覧を取得します",
      { category: z.string().describe("カテゴリ") },
      (params: { category: string }, _extra) =>
        this.searchService.handleGetItemsByCategory(params)
    );

    this.server.tool(
      "generate_markdown_summary",
      "保存された情報をマークダウン形式のまとめ記事として生成します",
      {
        category: z
          .string()
          .optional()
          .describe("特定のカテゴリに絞る場合は指定"),
        title: z.string().describe("まとめ記事のタイトル"),
        includeIntro: z.boolean().default(true).describe("導入部を含めるか"),
        includeConclusion: z
          .boolean()
          .default(true)
          .describe("まとめ部分を含めるか"),
      },
      (
        params: {
          category?: string;
          title: string;
          includeIntro: boolean;
          includeConclusion: boolean;
        },
        _extra
      ) => this.searchService.handleGenerateMarkdownSummary(params)
    );
    this.logger.info("MCP tools registered.");
  }

  async start(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.logger.info("MCPサーバー(Stdio)が接続待機中...");
    } catch (error) {
      this.logger.error(
        "MCPサーバー(Stdio)の起動または接続に失敗しました:",
        error
      );
      throw error; // Re-throw error to be caught by the main startup logic
    }
  }

  // Optional: Add a stop method if needed for graceful shutdown
  async stop(): Promise<void> {
    this.logger.info("MCPサーバー(Stdio)を停止中...");
    // Add specific MCP server shutdown logic if available/needed
    // this.server.disconnect() or similar?
  }
}
