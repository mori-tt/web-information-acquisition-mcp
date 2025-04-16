import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "./logger.js";
import { ItemInfo, PageData, WebsiteConfig } from "./types.js";

export class LlmService {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private logger: Logger;

  constructor(apiKey: string, modelName: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: modelName });
    this.logger = new Logger("LlmService");
  }

  /**
   * AI（Gemini）を使って情報を検索
   */
  async searchWithAI(query: string, category?: string): Promise<ItemInfo[]> {
    try {
      const currentDate = new Date().toISOString().split("T")[0];
      const prompt = `
        以下のキーワードに関連する情報を5件、現在（${currentDate}）利用可能な最新情報のみを非常に詳細に調査し提供してください:
        キーワード: ${query}
        ${category ? `カテゴリ: ${category}` : ""}

        各情報について、以下の形式で情報をJSON形式で提供してください:
        [
          {
            "name": "情報の正式名称",
            "organization": "提供元・組織名（具体的な名称）",
            "description": "情報の概要（300文字程度で詳細に）",
            "eligibility": "対象者・条件（具体的な要件、制限など詳細に）",
            "amount": "関連する量・金額・規模など（具体的な数値や計算方法）",
            "deadline": "関連する期限・日付（正確な日付、次回予定など）",
            "applicationProcess": "利用手順・プロセス（必要書類、窓口、オンライン情報など）",
            "requirementDetails": "達成すべき要件の詳細（計画の要件、評価基準など）",
            "exclusions": "対象外となる条件（制限事項など具体的な除外例）",
            "url": "公式サイトなどの参照URL（できるだけ詳細ページへのリンク）",
            "category": "適切なカテゴリ",
            "contactInfo": "問い合わせ先情報（電話番号、メールアドレスなど）"
          },
          ...
        ]

        特に「対象者・条件」と「要件詳細」については、できるだけ具体的かつ実務的に役立つ詳細情報を提供してください。
        期限に関する情報は、${currentDate}以降のもののみ含めてください。
        回答はJSON形式のみで返してください。JSONの構造を崩さないよう注意してください。
        `;

      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\s*\[\s*\{[\s\S]*?\}\s*\]\s*/); // More robust regex
      if (!jsonMatch || !jsonMatch[0]) {
        this.logger.error(
          "AIレスポンスからJSONデータを抽出できませんでした (searchWithAI)"
        );
        this.logger.debug("Raw AI Response:", text); // Log raw response for debugging
        return [];
      }

      try {
        const items = JSON.parse(jsonMatch[0]);
        return items.map(
          (item: Omit<ItemInfo, "id" | "source" | "createdAt">) => ({
            ...item,
            id: `item_${uuidv4()}`,
            source: "Gemini API",
            createdAt: new Date().toISOString(),
          })
        );
      } catch (parseError) {
        this.logger.error(
          "AIレスポンスのJSONパースに失敗しました (searchWithAI):",
          parseError
        );
        this.logger.debug("Matched JSON string:", jsonMatch[0]);
        return [];
      }
    } catch (error) {
      this.logger.error(`AI検索中にエラーが発生しました: ${error}`);
      return [];
    }
  }

  /**
   * マークダウン形式のまとめを生成
   */
  async generateMarkdownSummary(params: {
    title: string;
    items: ItemInfo[];
    includeIntro: boolean;
    includeConclusion: boolean;
  }): Promise<string> {
    const { title, items, includeIntro, includeConclusion } = params;

    try {
      if (items.length === 0) {
        return `# ${title}\n\n情報が見つかりませんでした。`;
      }

      const currentDate = new Date().toISOString().split("T")[0];
      const itemsJson = JSON.stringify(items, null, 2);
      const prompt = `
        以下の情報を基に、${currentDate}時点での最新情報として、わかりやすいマークダウン形式のまとめ記事を作成してください:

        ${itemsJson}

        タイトル: ${title}

        要件:
        ${
          includeIntro
            ? "- 導入部分には、これらの情報の概要や重要性、現状について説明してください。"
            : ""
        }
        - 各情報を整理して見やすく表示してください。
        - 情報ごとに見出しを付け、詳細を箇条書きで説明してください。
        - 手順や期限など重要な情報を強調してください。
        - 適切な見出し（##, ###）を使用して階層構造を作ってください。
        - URLがある場合は、クリック可能なリンクとして挿入してください。
        - 情報源（source）がある場合は、「情報源: [Source Name]」という形で明記してください。
        ${
          includeConclusion
            ? "- まとめ部分には、利用時の注意点や次のステップについてのアドバイスを含めてください。"
            : ""
        }

        回答はマークダウン形式のみで返してください。HTMLタグは使用しないでください。
        最後に「※この情報は${currentDate}時点のものです。最新情報は各公式サイトでご確認ください。」と記載してください。
        `;

      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      this.logger.error("マークダウン生成中にエラーが発生しました: ", error);
      throw new Error(
        `マークダウン生成に失敗しました: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Gemini APIを使ってWeb検索結果から情報を直接生成する
   */
  async generateWebItems(
    query: string,
    category?: string
  ): Promise<ItemInfo[]> {
    try {
      const prompt = `
        以下のキーワードに関連する情報について、Webで検索して見つけてください:
        キーワード: ${query}
        ${category ? `カテゴリ: ${category}` : ""}

        実際のWebサイトから情報を収集し、以下の形式で3-5件の情報をJSON形式で提供してください:
        [
          {
            "name": "情報の正式名称",
            "organization": "提供元・組織名",
            "description": "情報の概要（200文字程度）",
            "eligibility": "対象条件",
            "amount": "関連する量・金額・規模",
            "deadline": "関連する期限・日付",
            "applicationProcess": "利用手順・プロセス",
            "url": "公式サイトなどの参照URL",
            "category": "適切なカテゴリ"
          },
          ...
        ]

        回答はJSON形式のみで返してください。公式サイトURLは必ず含めるようにしてください。
        `;

      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\s*\[\s*\{[\s\S]*?\}\s*\]\s*/); // More robust regex
      if (!jsonMatch || !jsonMatch[0]) {
        this.logger.error(
          "AIレスポンスからJSONデータを抽出できませんでした (generateWebItems)"
        );
        this.logger.debug("Raw AI Response:", text);
        return [];
      }

      try {
        const items = JSON.parse(jsonMatch[0]);
        return items.map(
          (item: Omit<ItemInfo, "id" | "source" | "createdAt">) => ({
            ...item,
            id: `web_${
              item.organization
                ?.replace(/[^a-zA-Z0-9]/g, "")
                ?.toLowerCase()
                ?.substring(0, 10) || "unk"
            }_${uuidv4()}`,
            source: `${item.organization || "Web"} (Web検索)`,
            createdAt: new Date().toISOString(),
          })
        );
      } catch (parseError) {
        this.logger.error(
          "AIレスポンスのJSONパースに失敗しました (generateWebItems):",
          parseError
        );
        this.logger.debug("Matched JSON string:", jsonMatch[0]);
        return [];
      }
    } catch (error) {
      this.logger.error(`Web検索データ生成中にエラーが発生しました: ${error}`);
      return [];
    }
  }

  /**
   * ウェブページから情報を抽出して構造化
   */
  async extractInfoFromPage(
    pageData: PageData,
    website: WebsiteConfig,
    originalUrl: string
  ): Promise<ItemInfo | null> {
    try {
      if (!pageData.content || typeof pageData.content !== "string")
        return null;

      const title = pageData.title || "不明なタイトル";
      const content = pageData.content;
      const prompt = `
        以下のWebページから主要な情報を抽出し、定型フォーマットに従って構造化してください。
        情報が不完全な場合は、該当項目を「情報なし」と記入してください。

        ウェブサイト: ${website.name} (${website.url})
        ページタイトル: ${title}
        ページURL: ${originalUrl}

        ページ内容 (先頭10000文字):
        ${content.slice(0, 10000)}

        以下のJSON形式で回答してください:
        {
          "name": "情報の名称",
          "organization": "提供元・組織名",
          "description": "概要（300文字程度）",
          "eligibility": "対象条件",
          "amount": "関連する量・金額・規模",
          "deadline": "関連する期限・日付",
          "applicationProcess": "手順・プロセス",
          "url": "${originalUrl}",
          "category": "適切なカテゴリ"
        }

        ページ内に主要な情報が見つからない場合や、内容が極めて不十分な場合は、"null"と回答してください。
        回答はJSON形式のみで返してください。
        `;

      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\s*\{[\s\S]*?\}\s*/); // Match JSON object
      if (
        !jsonMatch ||
        !jsonMatch[0] ||
        jsonMatch[0].toLowerCase().trim() === "null"
      ) {
        this.logger.debug(
          `ページから抽出する情報が見つかりませんでした (${originalUrl})`
        );
        return null;
      }

      try {
        const itemData = JSON.parse(jsonMatch[0]);
        if (!itemData.name || itemData.name === "情報なし") {
          this.logger.debug(
            `抽出された情報に有効な名前が含まれていません (${originalUrl})`
          );
          return null; // 名称がなければ無効な情報とみなす
        }

        const itemInfo: ItemInfo = {
          id: `web_${website.name}_${uuidv4()}`,
          name: itemData.name,
          organization: itemData.organization || website.name,
          description: itemData.description || "詳細情報なし",
          eligibility: itemData.eligibility || "対象条件の詳細情報なし",
          amount: itemData.amount || "関連数値の詳細情報なし",
          deadline: itemData.deadline || "期限情報の詳細情報なし",
          applicationProcess:
            itemData.applicationProcess || "手順の詳細情報なし",
          url: originalUrl,
          category: itemData.category || "未分類",
          source: `${website.name} (Web抽出)`,
          createdAt: new Date().toISOString(),
        };
        return itemInfo;
      } catch (parseError) {
        this.logger.error(
          `ページ抽出結果のJSONパースに失敗しました (${originalUrl}):`,
          parseError
        );
        this.logger.debug("Matched JSON string:", jsonMatch[0]);
        return null;
      }
    } catch (error) {
      this.logger.error(
        `ページからの情報抽出に失敗 (${originalUrl}): ${error}`
      );
      return null;
    }
  }
}
