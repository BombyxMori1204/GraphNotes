export type ItemType = 'link' | 'file' | 'table' | 'image' | 'text';

export type OfflineCopyStatus = 'full' | 'text_only' | 'none';

export interface Topic {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  createdAt: string;
}

export interface Item {
  id: string;
  title: string;
  type: ItemType;
  description: string;
  sourceLabel: string;
  copyStatus: OfflineCopyStatus;
  url?: string | null;
  filePath?: string | null;
  copyPath?: string | null;
  cleanText?: string;
  updatedAt?: string;
  topicIds: string[];
  isRead: boolean;
  createdAt: string;
}

export interface VectorSearchResult {
  itemId: string;
  chunkId: string;
  score: number;
}
