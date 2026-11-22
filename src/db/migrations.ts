import type { SQLiteDatabase } from 'expo-sqlite';

const INITIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES topics (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('link', 'file', 'table', 'image', 'text')),
    topic_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT,
    file_path TEXT,
    offline_status TEXT NOT NULL DEFAULT 'none'
      CHECK (offline_status IN ('full', 'text_only', 'none')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (topic_id) REFERENCES topics (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS item_tags (
    item_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (item_id, tag_id),
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB,
    UNIQUE (item_id, chunk_index),
    FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    payload TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    item_id UNINDEXED,
    title,
    description
  );
`;

export async function runMigrations(database: SQLiteDatabase): Promise<void> {
  const version = await database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  const currentVersion = version?.user_version ?? 0;

  if (currentVersion < 1) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(INITIAL_SCHEMA);
      await database.execAsync('PRAGMA user_version = 1;');
    });
  }
}
