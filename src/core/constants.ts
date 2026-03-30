export const DIFF_CONTEXT_LINES = 3;
export const TOKENIZE_MAX_LINE_LENGTH = 1_000;
export const DEFAULT_TAB_SIZE = 2;
export const HIGHLIGHTER_PREFERRED = "shiki-wasm" as const;
export const WATCH_POLL_INTERVAL_MS = 250;

export const UI_LAYOUT_CONSTANTS = {
  BODY_PADDING: 2,
  DIFF_MIN_WIDTH: 48,
  DIVIDER_HIT_WIDTH: 5,
  DIVIDER_WIDTH: 1,
  FILES_MIN_WIDTH: 22,
  SIDEBAR_DEFAULT_WIDTH: 34,
} as const;

export const UI_SCROLL_CONSTANTS = {
  DIFF_SELECTION_MIN_TOP_PADDING: 2,
  SCROLLBAR_HIDE_DELAY_MS: 2_000,
  SCROLL_RESTORE_RETRY_DELAYS_MS: [0, 16, 48],
  VIEWPORT_OVERSCAN_ROWS: 8,
} as const;

export const THEME_CONSTANTS = {
  RESERVED_PIERRE_TOKEN_COLORS: {
    dark: {
      "#ff6762": "keyword",
      "#5ecc71": "string",
    },
    light: {
      "#d52c36": "keyword",
      "#199f43": "string",
    },
  },
} as const;
