import fs from "fs";
import path from "path";
import { Logger } from "./logger.js";
import { ItemInfo } from "./types.js";

// ==========================================
// データアクセス層（DAL）- ItemRepository
// ==========================================

/**
 * 情報データアクセスクラス
 */
export class ItemRepository {
  private dbDir: string;
  private logger: Logger;

  constructor(dbDir: string) {
    this.dbDir = dbDir;
    this.logger = new Logger("ItemRepository");
    // Ensure the directory exists upon instantiation
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
      this.logger.info(`Created database directory: ${this.dbDir}`);
    }
  }

  /**
   * 情報をDBに保存する
   */
  saveItem(item: ItemInfo): void {
    try {
      const filePath = path.join(this.dbDir, `${item.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(item, null, 2), "utf-8");
      this.logger.info(`情報を保存しました: ${item.id}`);
    } catch (error) {
      this.logger.error(`情報の保存に失敗しました: ${error}`);
      throw new Error(
        `保存に失敗しました: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 情報を更新する
   * @param id 既存のアイテムID
   * @param newData 新しいアイテムデータ（ID以外）
   */
  updateItem(id: string, newData: Omit<ItemInfo, "id">): ItemInfo | null {
    try {
      const existingItem = this.getItem(id);
      if (!existingItem) {
        this.logger.warn(`更新対象の情報が見つかりません: ${id}`);
        return null;
      }

      const updatedItem: ItemInfo = {
        ...newData,
        id,
        createdAt: existingItem.createdAt, // 作成日は維持
        updatedAt: new Date().toISOString(), // 更新日を追加
      };

      this.saveItem(updatedItem);
      this.logger.info(`情報を更新しました: ${id}`);
      return updatedItem;
    } catch (error) {
      this.logger.error(`情報の更新に失敗しました (ID: ${id}): ${error}`);
      return null;
    }
  }

  /**
   * 名前または内容の類似性に基づいて重複するアイテムを検索
   * @param item 検索するアイテム情報
   * @returns 重複する可能性のあるアイテムID、または null
   */
  findDuplicateItem(item: Partial<ItemInfo>): string | null {
    try {
      const allItems = this.getAllItems();

      // 名前が完全一致するものを優先
      const exactNameMatch = allItems.find(
        (existing) => existing.name.toLowerCase() === item.name?.toLowerCase()
      );
      if (exactNameMatch) {
        return exactNameMatch.id;
      }

      // 名前が類似するものを検索 (単純な部分一致と組織名、URLの一致で判断)
      const similarNameMatch = allItems.find((existing) => {
        if (
          item.name &&
          existing.name.toLowerCase().includes(item.name.toLowerCase())
        ) {
          // 提供元も一致する場合
          if (
            item.organization &&
            existing.organization
              .toLowerCase()
              .includes(item.organization.toLowerCase())
          ) {
            return true;
          }
          // URLが一致する場合
          if (item.url && existing.url && existing.url === item.url) {
            return true;
          }
        }
        return false;
      });

      return similarNameMatch ? similarNameMatch.id : null;
    } catch (error) {
      this.logger.error(`重複アイテムの検索に失敗しました: ${error}`);
      return null;
    }
  }

  /**
   * 指定されたIDの情報を取得する
   */
  getItem(id: string): ItemInfo | null {
    try {
      const filePath = path.join(this.dbDir, `${id}.json`);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data) as ItemInfo;
    } catch (error) {
      this.logger.error(`情報の取得に失敗しました (ID: ${id}): ${error}`);
      return null;
    }
  }

  /**
   * すべての情報を取得する
   */
  getAllItems(): ItemInfo[] {
    try {
      if (!fs.existsSync(this.dbDir)) {
        return [];
      }
      const files = fs
        .readdirSync(this.dbDir)
        .filter((file) => file.endsWith(".json"));
      return files.map((file) => {
        const data = fs.readFileSync(path.join(this.dbDir, file), "utf-8");
        return JSON.parse(data) as ItemInfo;
      });
    } catch (error) {
      this.logger.error(`全情報の取得に失敗しました: ${error}`);
      return [];
    }
  }

  /**
   * カテゴリ別に情報を取得する
   */
  getItemsByCategory(category: string): ItemInfo[] {
    try {
      const allItems = this.getAllItems();
      if (!category) {
        return allItems;
      }
      return allItems.filter((item) =>
        item.category.toLowerCase().includes(category.toLowerCase())
      );
    } catch (error) {
      this.logger.error(
        `カテゴリ別情報の取得に失敗しました (カテゴリ: ${category}): ${error}`
      );
      return [];
    }
  }
}
