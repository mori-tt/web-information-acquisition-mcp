import express, { Request, Response, RequestHandler } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { z } from "zod";
import { ItemSearchService } from "./searchService.js"; // Assuming ItemSearchService is refactored here
import { ItemRepository } from "./repository.js";
import { Logger } from "./logger.js";
import { ApiResponse, ItemInfo } from "./types.js";

export class HttpServer {
  public app: express.Express;
  private searchService: ItemSearchService;
  // private repository: ItemRepository; // Repository likely accessed via searchService now
  private logger: Logger;

  constructor(port: number, searchService: ItemSearchService) {
    this.app = express();
    this.searchService = searchService;
    this.logger = new Logger("HttpServer");
    this.initializeMiddleware();
    this.initializeRoutes();

    this.app.listen(port, () => {
      this.logger.info(`HTTPサーバーが起動しました: http://localhost:${port}`);
    });
  }

  private initializeMiddleware(): void {
    this.app.use(cors());
    this.app.use(bodyParser.json());
  }

  private initializeRoutes(): void {
    // Root endpoint
    this.app.get("/", (_req: Request, res: Response) => {
      res.status(200).send(`
              <html>
                <head><title>情報取得サーバー (HTTP)</title></head>
                <body>
                  <h1>情報取得サーバー (HTTP Interface)</h1>
                  <p>APIは正常に動作しています。以下のエンドポイントが利用可能です：</p>
                  <ul>
                    <li><a href="/health">ヘルスチェック</a></li>
                    <li>POST /api/tools/search_items - 情報検索</li>
                    <li>POST /api/tools/save_item - 情報保存</li>
                    <li>POST /api/tools/get_items_by_category - カテゴリ別情報取得</li>
                    <li>POST /api/tools/generate_markdown_summary - マークダウン形式のまとめ記事生成</li>
                  </ul>
                </body>
              </html>
            `);
    });

    // Health check
    const healthCheckHandler: RequestHandler = (_req, res) => {
      res.status(200).send("OK");
    };
    this.app.get("/health", healthCheckHandler);

    // API Tool routes
    this.registerSearchItemsRoute();
    this.registerSaveItemRoute();
    this.registerGetItemsByCategoryRoute();
    this.registerGenerateMarkdownSummaryRoute();
  }

  // API Route Handlers (extracted from ItemMCPServer)

  private registerSearchItemsRoute(): void {
    this.app.post(
      "/api/tools/search_items",
      this.createExpressHandler(async (req, res) => {
        const { query, category, useWeb } = req.body;
        if (!query) {
          return res.status(400).json({
            error: "検索キーワードは必須です",
            content: [
              { type: "text", text: "検索キーワードを指定してください" },
            ],
          });
        }
        // Delegate to searchService
        const result = await this.searchService.handleSearchItems({
          query,
          category,
          useWeb,
        });
        res.status(result.isError ? 500 : 200).json(result);
      })
    );
  }

  private registerSaveItemRoute(): void {
    // Define schema here or import if needed elsewhere
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

    this.app.post(
      "/api/tools/save_item",
      this.createExpressHandler(async (req, res) => {
        const validationResult = itemSchema.safeParse(req.body);
        if (!validationResult.success) {
          return res.status(400).json({
            error: "無効なリクエストデータ",
            details: validationResult.error.errors,
            content: [{ type: "text", text: "入力データを確認してください" }],
          });
        }
        // Delegate to searchService
        const result = await this.searchService.handleSaveItem(
          validationResult.data
        );
        res.status(result.isError ? 500 : 200).json(result);
      })
    );
  }

  private registerGetItemsByCategoryRoute(): void {
    this.app.post(
      "/api/tools/get_items_by_category",
      this.createExpressHandler(async (req, res) => {
        const { category } = req.body;
        // Delegate to searchService
        const result = await this.searchService.handleGetItemsByCategory({
          category: category || "", // Handle undefined category
        });
        res.status(result.isError ? 500 : 200).json(result);
      })
    );
  }

  private registerGenerateMarkdownSummaryRoute(): void {
    this.app.post(
      "/api/tools/generate_markdown_summary",
      this.createExpressHandler(async (req, res) => {
        const { title, category, includeIntro, includeConclusion } = req.body;
        if (!title) {
          return res.status(400).json({
            error: "タイトルは必須です",
            content: [{ type: "text", text: "タイトルを指定してください" }],
          });
        }
        // Delegate to searchService
        const result = await this.searchService.handleGenerateMarkdownSummary({
          title,
          category,
          includeIntro: includeIntro !== undefined ? includeIntro : true,
          includeConclusion:
            includeConclusion !== undefined ? includeConclusion : true,
        });
        // Markdown result might not have isError structure, adjust response as needed
        if (result.isError) {
          res.status(500).json(result);
        } else {
          // Send markdown directly or wrap it
          res.status(200).json(result); // Assuming result structure is ApiResponse<string>
        }
      })
    );
  }

  // Helper to wrap async handlers and catch errors
  private createExpressHandler(
    handler: (req: Request, res: Response) => Promise<any>
  ): RequestHandler {
    return async (req: Request, res: Response) => {
      try {
        await handler(req, res);
      } catch (error) {
        this.logger.error("API Error in HTTP Handler:", error);
        const response: ApiResponse<null> = {
          content: [
            { type: "text", text: "サーバー内部でエラーが発生しました。" },
          ],
          error:
            error instanceof Error
              ? error.message
              : "Unknown internal server error",
          isError: true,
        };
        res.status(500).json(response);
      }
    };
  }
}
