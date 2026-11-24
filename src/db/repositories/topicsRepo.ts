import { initDatabase } from '@/db/client';
import type { Topic } from '@/types';

export interface TopicWithStats extends Topic {
  totalCount: number;
  readCount: number;
}

export interface TopicEdge {
  source: string;
  target: string;
  weight: number;
}

function createId(): string {
  return `topic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getAllTopicsWithStats(): Promise<TopicWithStats[]> {
  const database = await initDatabase();
  const rows = await database.getAllAsync<{
    id: string;
    name: string;
    parent_id: string | null;
    color: string | null;
    created_at: string;
    total_count: number;
    read_count: number;
  }>(`
    SELECT
      t.id,
      t.name,
      t.parent_id,
      t.color,
      t.created_at,
      COUNT(i.id) AS total_count,
      COALESCE(SUM(CASE WHEN i.is_read = 1 THEN 1 ELSE 0 END), 0) AS read_count
    FROM topics t
    LEFT JOIN item_topics it ON it.topic_id = t.id
    LEFT JOIN items i ON i.id = it.item_id
    GROUP BY t.id
    ORDER BY t.created_at, t.id
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    color: row.color,
    createdAt: row.created_at,
    totalCount: row.total_count,
    readCount: row.read_count,
  }));
}

export async function getTopicEdges(): Promise<TopicEdge[]> {
  const database = await initDatabase();
  return database.getAllAsync<TopicEdge>(`
    SELECT
      it1.topic_id AS source,
      it2.topic_id AS target,
      COUNT(*) AS weight
    FROM item_topics it1
    JOIN item_topics it2
      ON it1.item_id = it2.item_id
      AND it1.topic_id < it2.topic_id
    GROUP BY it1.topic_id, it2.topic_id
  `);
}

export async function createTopic(
  name: string,
  parentId?: string,
  color?: string,
): Promise<Topic> {
  const database = await initDatabase();
  const topic: Topic = {
    id: createId(),
    name,
    parentId: parentId ?? null,
    color: color ?? null,
    createdAt: new Date().toISOString(),
  };
  await database.runAsync(
    `INSERT INTO topics (id, name, parent_id, color, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    topic.id,
    topic.name,
    topic.parentId,
    topic.color,
    topic.createdAt,
  );
  return topic;
}

export async function deleteTopic(id: string): Promise<void> {
  const database = await initDatabase();
  await database.withTransactionAsync(async () => {
    const affectedItems = await database.getAllAsync<{ item_id: string }>(
      'SELECT item_id FROM item_topics WHERE topic_id = ?',
      id,
    );
    await database.runAsync('DELETE FROM topics WHERE id = ?', id);

    for (const { item_id: itemId } of affectedItems) {
      await database.runAsync(
        `UPDATE items_fts
         SET topics_text = COALESCE((
           SELECT group_concat(t.name, ' ')
           FROM item_topics it JOIN topics t ON t.id = it.topic_id
           WHERE it.item_id = ?
         ), '')
         WHERE item_id = ?`,
        itemId,
        itemId,
      );
    }
  });
}
