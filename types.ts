// ==========================================
// データモデルとインターフェース
// ==========================================

// 取得する情報の型定義 (汎用化)
export interface ItemInfo {
  id: string; // 一意なID
  name: string; // 項目の名称
  organization: string; // 提供元・組織名
  description: string; // 概要説明
  eligibility: string; // 対象条件・資格など
  amount: string; // 量・金額・規模など
  deadline: string; // 期限・日付など
  applicationProcess: string; // 手順・プロセス
  url: string; // 参照URL
  category: string; // カテゴリ
  source?: string; // 情報源 (例: "Gemini API", "Web Search")
  createdAt: string; // 作成日時
  requirementDetails?: string; // 要件詳細
  exclusions?: string; // 除外条件
  contactInfo?: string; // 問い合わせ先
  updatedAt?: string; // 更新日時
}

// WebサイトのAPIリクエスト・レスポンス型
export interface ApiSearchRequest {
  query: string;
  category?: string;
  useWeb?: boolean;
}

// 検索結果の型定義
export interface SearchResult {
  url: string;
  title?: string;
  snippet?: string;
}

// 検索APIのレスポンス型
export interface SearchApiResponse {
  results: SearchResult[];
}

// ページデータの型定義
export interface PageData {
  title?: string;
  content?: string;
  url?: string;
}

// MCP SDKが期待するレスポンス型に合わせた定義
export interface ApiResponse<T = any> {
  content: Array<{
    type: "text";
    text: string;
  }>;
  data?: T;
  error?: string;
  isError?: boolean;
  _meta?: { [key: string]: unknown };
  [key: string]: unknown; // インデックスシグネチャを追加
}

// WebサイトConfigインターフェース
export interface WebsiteConfig {
  name: string;
  url: string;
  enabled: boolean;
  description: string;
}
