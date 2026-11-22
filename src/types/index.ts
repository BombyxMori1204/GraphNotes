export type ItemType = 'link' | 'file' | 'table' | 'image' | 'text';

export type OfflineCopyStatus = 'full' | 'text_only' | 'none';

export interface Topic {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface Item {
  id: string;
  type: ItemType;
  topicId: string | null;
  title: string;
  description: string | null;
  url: string | null;
  filePath: string | null;
  offlineStatus: OfflineCopyStatus;
  createdAt: number;
  updatedAt: number;
}

export interface VectorSearchResult {
  itemId: string;
  chunkId: string;
  score: number;
}
