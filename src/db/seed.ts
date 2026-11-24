import type { SQLiteDatabase } from 'expo-sqlite';

import { MOCK_ITEMS } from '@/features/items/mockItems';

const INITIAL_TOPICS = [
  { id: 'diploma', name: 'Диплом', color: '#3B82F6' },
  { id: 'rn', name: 'React Native', color: '#06B6D4' },
  { id: 'ux', name: 'UX и Фиттс', color: '#8B5CF6' },
  { id: 'skia', name: 'Skia', color: '#EC4899' },
  { id: 'ollama', name: 'Ollama', color: '#10B981' },
  { id: 'python', name: 'Python', color: '#EAB308' },
  { id: 'sqlite', name: 'SQLite', color: '#6366F1' },
  { id: 'articles', name: 'Статьи', color: '#14B8A6' },
  { id: 'ideas', name: 'Идеи', color: '#F43F5E' },
  { id: 'design', name: 'Дизайн', color: '#A855F7' },
  { id: 'books', name: 'Книги', color: '#64748B' },
] as const;

export async function seedDatabase(database: SQLiteDatabase): Promise<void> {
  await database.withTransactionAsync(async () => {
    for (const topic of INITIAL_TOPICS) {
      await database.runAsync(
        `INSERT INTO topics (id, name, parent_id, color, created_at)
         VALUES (?, ?, NULL, ?, ?)`,
        topic.id,
        topic.name,
        topic.color,
        new Date().toISOString(),
      );
    }

    for (const item of MOCK_ITEMS) {
      await database.runAsync(
        `INSERT INTO items (
          id, type, title, description, url, source_label, file_path,
          copy_status, copy_path, clean_text, is_read, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        item.id,
        item.type,
        item.title,
        item.description,
        item.url ?? null,
        item.sourceLabel,
        item.filePath ?? null,
        item.copyStatus,
        item.copyPath ?? null,
        item.cleanText ?? item.description,
        item.isRead ? 1 : 0,
        item.createdAt,
        item.updatedAt ?? item.createdAt,
      );

      for (const topicId of item.topicIds) {
        await database.runAsync(
          'INSERT INTO item_topics (item_id, topic_id) VALUES (?, ?)',
          item.id,
          topicId,
        );
      }

      await database.runAsync(
        `INSERT INTO items_fts (item_id, title, description, clean_text, topics_text)
         VALUES (
           ?, ?, ?, ?,
           COALESCE((
             SELECT group_concat(t.name, ' ')
             FROM item_topics it JOIN topics t ON t.id = it.topic_id
             WHERE it.item_id = ?
           ), '')
         )`,
        item.id,
        item.title,
        item.description,
        item.cleanText ?? item.description,
        item.id,
      );
    }
  });
}
