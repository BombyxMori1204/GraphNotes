import { initDatabase } from '@/db/client';
import type { Item, ItemType, OfflineCopyStatus } from '@/types';

type ItemInput = Item & {
  url?: string | null;
  filePath?: string | null;
  copyPath?: string | null;
  cleanText?: string;
};

interface ItemRow {
  id: string;
  type: string;
  title: string;
  description: string;
  url: string | null;
  source_label: string;
  file_path: string | null;
  copy_status: string;
  copy_path: string | null;
  clean_text: string;
  is_read: number;
  created_at: string;
  updated_at: string;
}

function parseItemType(value: string): ItemType {
  switch (value) {
    case 'link':
    case 'table':
    case 'file':
    case 'image':
    case 'text':
      return value;
    default:
      throw new Error(`Unknown item type in database: ${value}`);
  }
}

function parseCopyStatus(value: string): OfflineCopyStatus {
  switch (value) {
    case 'full':
    case 'text_only':
    case 'none':
      return value;
    default:
      throw new Error(`Unknown copy status in database: ${value}`);
  }
}

function mapItem(row: ItemRow, topicIds: string[]): Item {
  return {
    id: row.id,
    type: parseItemType(row.type),
    title: row.title,
    description: row.description,
    url: row.url,
    sourceLabel: row.source_label,
    filePath: row.file_path,
    copyStatus: parseCopyStatus(row.copy_status),
    copyPath: row.copy_path,
    cleanText: row.clean_text,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    topicIds,
  };
}

async function loadTopicIds(
  database: Awaited<ReturnType<typeof initDatabase>>,
  itemIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(itemIds.map((id) => [id, []]));
  if (itemIds.length === 0) {
    return result;
  }

  const placeholders = itemIds.map(() => '?').join(', ');
  const rows = await database.getAllAsync<{
    item_id: string;
    topic_id: string;
  }>(
    `SELECT item_id, topic_id FROM item_topics
     WHERE item_id IN (${placeholders})`,
    ...itemIds,
  );
  for (const row of rows) {
    result.get(row.item_id)?.push(row.topic_id);
  }
  return result;
}

export async function getAllItems(): Promise<Item[]> {
  const database = await initDatabase();
  const rows = await database.getAllAsync<ItemRow>(
    'SELECT * FROM items ORDER BY created_at DESC, id',
  );
  const topicsByItem = await loadTopicIds(
    database,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapItem(row, topicsByItem.get(row.id) ?? []));
}

export async function getItemsByTopic(
  topicId: string | 'inbox',
): Promise<Item[]> {
  const database = await initDatabase();
  const rows =
    topicId === 'inbox'
      ? await database.getAllAsync<ItemRow>(`
          SELECT i.*
          FROM items i
          WHERE NOT EXISTS (
            SELECT 1 FROM item_topics it WHERE it.item_id = i.id
          )
          ORDER BY i.created_at DESC, i.id
        `)
      : await database.getAllAsync<ItemRow>(
          `SELECT i.*
           FROM items i
           JOIN item_topics it ON it.item_id = i.id
           WHERE it.topic_id = ?
           ORDER BY i.created_at DESC, i.id`,
          topicId,
        );
  const topicsByItem = await loadTopicIds(
    database,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapItem(row, topicsByItem.get(row.id) ?? []));
}

export async function getInboxCount(): Promise<number> {
  const database = await initDatabase();
  const row = await database.getFirstAsync<{ count: number }>(`
    SELECT COUNT(*) AS count
    FROM items i
    WHERE NOT EXISTS (
      SELECT 1 FROM item_topics it WHERE it.item_id = i.id
    )
  `);
  return row?.count ?? 0;
}

export async function createItem(input: ItemInput): Promise<void> {
  const database = await initDatabase();
  const topicIds = [...new Set(input.topicIds)];
  const cleanText = input.cleanText ?? input.description;
  const updatedAt = input.updatedAt ?? input.createdAt;

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO items (
        id, type, title, description, url, source_label, file_path,
        copy_status, copy_path, clean_text, is_read, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.type,
      input.title,
      input.description,
      input.url ?? null,
      input.sourceLabel,
      input.filePath ?? null,
      input.copyStatus,
      input.copyPath ?? null,
      cleanText,
      input.isRead ? 1 : 0,
      input.createdAt,
      updatedAt,
    );

    for (const topicId of topicIds) {
      await database.runAsync(
        'INSERT INTO item_topics (item_id, topic_id) VALUES (?, ?)',
        input.id,
        topicId,
      );
    }

    const topicText = await getTopicNames(database, topicIds);
    await database.runAsync(
      `INSERT INTO items_fts (item_id, title, description, clean_text, topics_text)
       VALUES (?, ?, ?, ?, ?)`,
      input.id,
      input.title,
      input.description,
      cleanText,
      topicText,
    );
  });
}

async function getTopicNames(
  database: Awaited<ReturnType<typeof initDatabase>>,
  topicIds: string[],
): Promise<string> {
  if (topicIds.length === 0) {
    return '';
  }
  const placeholders = topicIds.map(() => '?').join(', ');
  const rows = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM topics WHERE id IN (${placeholders}) ORDER BY name`,
    ...topicIds,
  );
  return rows.map((row) => row.name).join(' ');
}

export async function toggleItemRead(
  id: string,
  isRead: boolean,
): Promise<void> {
  const database = await initDatabase();
  const result = await database.runAsync(
    'UPDATE items SET is_read = ?, updated_at = ? WHERE id = ?',
    isRead ? 1 : 0,
    new Date().toISOString(),
    id,
  );
  if (result.changes === 0) {
    throw new Error(`Cannot update read status: item ${id} was not found`);
  }
}

export async function updateItemTopics(
  itemId: string,
  topicIds: string[],
): Promise<void> {
  const database = await initDatabase();
  const uniqueTopicIds = [...new Set(topicIds)];

  await database.withTransactionAsync(async () => {
    const existing = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM items WHERE id = ?',
      itemId,
    );
    if (!existing) {
      throw new Error(`Cannot update topics: item ${itemId} was not found`);
    }

    await database.runAsync('DELETE FROM item_topics WHERE item_id = ?', itemId);
    for (const topicId of uniqueTopicIds) {
      await database.runAsync(
        'INSERT INTO item_topics (item_id, topic_id) VALUES (?, ?)',
        itemId,
        topicId,
      );
    }

    const topicsText = await getTopicNames(database, uniqueTopicIds);
    await database.runAsync(
      `UPDATE items_fts SET topics_text = ? WHERE item_id = ?`,
      topicsText,
      itemId,
    );
  });
}

export async function deleteItem(id: string): Promise<void> {
  const database = await initDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM items_fts WHERE item_id = ?', id);
    await database.runAsync('DELETE FROM items WHERE id = ?', id);
  });
}
