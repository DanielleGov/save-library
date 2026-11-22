export const PLATFORMS = [
  'instagram',
  'facebook',
  'tiktok',
  'youtube',
  'pinterest',
  'etsy',
  'other',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const MEDIA_TYPES = [
  'reel',
  'video',
  'short',
  'post',
  'photo',
  'story',
  'pin',
  'listing',
  'shop',
  'playlist',
  'profile',
  'unknown',
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export type BookmarkSource = 'manual' | 'paste' | 'shortcut' | 'backup';

export interface Bookmark {
  id: string;
  /** The original link exactly as received (trimmed). Always opened as-is. */
  url: string;
  /** Normalized key used only for duplicate detection. */
  key: string;
  platform: Platform;
  mediaType: MediaType;
  /** True once the user overrides the inferred media type. */
  mediaTypeEdited?: boolean;
  savedAt: number;
  updatedAt: number;
  /** Untrusted text that arrived with the link (share sheet / paste). Plain text only. */
  sharedText?: string;
  title?: string;
  /** Title found automatically (share-sheet title or screenshot text). The user's title wins. */
  autoTitle?: string;
  /** Cleaned on-device text recognized in a screenshot taken when saving. Plain text, searchable. */
  screenText?: string;
  note?: string;
  tags: string[];
  categoryId: string | null;
  hasCover?: boolean;
  /** User chose to ignore the category suggestion. */
  suggestDismissed?: boolean;
  source: BookmarkSource;
}

export interface Category {
  id: string;
  name: string;
  createdAt: number;
}

export interface Cover {
  id: string; // bookmark id
  type: string; // image/jpeg
  bytes: ArrayBuffer;
  width: number;
  height: number;
}

export interface Settings {
  remoteThumbnails: boolean;
  view: 'list' | 'grid';
}

export const DEFAULT_SETTINGS: Settings = { remoteThumbnails: false, view: 'list' };

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  etsy: 'Etsy',
  other: 'Website',
};

export const MEDIA_LABELS: Record<MediaType, string> = {
  reel: 'Reel',
  video: 'Video',
  short: 'Short',
  post: 'Post',
  photo: 'Photo',
  story: 'Story',
  pin: 'Pin',
  listing: 'Listing',
  shop: 'Shop',
  playlist: 'Playlist',
  profile: 'Profile',
  unknown: 'Unknown',
};

/** Field length limits applied to every route (manual, paste, shortcut, backup). */
export const LIMITS = {
  url: 2048,
  sharedText: 2000,
  title: 300,
  note: 5000,
  tag: 50,
  tags: 30,
  categoryName: 60,
  categories: 500,
  captureFileBytes: 64 * 1024,
  /** A capture carrying a screenshot cover (base64) may be larger. */
  captureWithCoverBytes: 3 * 1024 * 1024,
  captureCoverBytes: 2 * 1024 * 1024,
  screenText: 3000,
  captureFiles: 500,
  bulkPasteChars: 500_000,
  bulkPasteUrls: 5000,
  backupBytes: 40 * 1024 * 1024,
  backupBookmarks: 50_000,
  coverBytes: 200 * 1024,
  coverInputBytes: 30 * 1024 * 1024,
} as const;
