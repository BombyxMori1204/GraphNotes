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
  title: string;
  type: ItemType;
  description: string;
  sourceLabel: string;
  copyStatus: OfflineCopyStatus;
  topicIds: string[];
  createdAt: string;
}

export interface VectorSearchResult {
  itemId: string;
  chunkId: string;
  score: number;
}
