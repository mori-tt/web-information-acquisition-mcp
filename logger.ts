import { CONFIG } from "./config.js";

// ロガーの設定
type LogLevel = "debug" | "info" | "warn" | "error";
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private context: string;
  private currentLevel: number;

  constructor(context: string) {
    this.context = context;
    this.currentLevel =
      LOG_LEVELS[CONFIG.LOG_LEVEL as LogLevel] || LOG_LEVELS.info;
  }

  debug(message: string, ...args: any[]): void {
    if (this.currentLevel <= LOG_LEVELS.debug) {
      console.log(`[DEBUG][${this.context}] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.currentLevel <= LOG_LEVELS.info) {
      console.log(`[INFO][${this.context}] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.currentLevel <= LOG_LEVELS.warn) {
      console.warn(`[WARN][${this.context}] ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.currentLevel <= LOG_LEVELS.error) {
      console.error(`[ERROR][${this.context}] ${message}`, ...args);
    }
  }
}
