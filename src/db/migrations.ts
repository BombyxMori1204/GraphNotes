import type { SQLiteDatabase } from 'expo-sqlite';

const SCHEMA_V1 = `
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    color TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('link', 'table', 'file', 'image', 'text')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    url TEXT,
    source_label TEXT NOT NULL DEFAULT '',
    file_path TEXT,
    copy_status TEXT NOT NULL DEFAULT 'none'
      CHECK (copy_status IN ('full', 'text_only', 'none')),
    copy_path TEXT,
    clean_text TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS item_topics (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, topic_id)
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('parse_link', 'embed_item')),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    item_id UNINDEXED, title, description, clean_text, topics_text
  );

  CREATE INDEX IF NOT EXISTS idx_item_topics_topic_id ON item_topics(topic_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_item_id ON chunks(item_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`;

async function getColumnNames(
  database: SQLiteDatabase,
  tableName: string,
): Promise<Set<string>> {
  const rows = await database.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${tableName})`,
  );
  return new Set(rows.map((row) => row.name));
}

async function migrateLegacyV1(database: SQLiteDatabase): Promise<void> {
  const columns = await getColumnNames(database, 'items');
  if (!columns.has('topic_id')) {
    return;
  }

  await database.withTransactionAsync(async () => {
    await database.execAsync(`
      CREATE TEMP TABLE legacy_topics AS SELECT * FROM topics;
      CREATE TEMP TABLE legacy_items AS SELECT * FROM items;
      CREATE TEMP TABLE legacy_tags AS SELECT * FROM tags;
      CREATE TEMP TABLE legacy_item_tags AS SELECT * FROM item_tags;
      DROP TABLE items_fts;
      DROP TABLE item_tags;
      DROP TABLE tags;
      DROP TABLE chunks;
      DROP TABLE jobs;
      DROP TABLE items;
      DROP TABLE topics;
      ${SCHEMA_V1}

      INSERT INTO topics (id, name, parent_id, color, created_at)
      SELECT id, name, parent_id, NULL, CAST(created_at AS TEXT)
      FROM legacy_topics;

      INSERT OR IGNORE INTO topics (id, name, parent_id, color, created_at)
      SELECT id, name, NULL, NULL, CAST(strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS TEXT)
      FROM legacy_tags;

      INSERT INTO items (
        id, type, title, description, url, source_label, file_path,
        copy_status, clean_text, is_read, created_at, updated_at
      )
      SELECT
        id, type, title, COALESCE(description, ''), url, '', file_path,
        COALESCE(offline_status, 'none'), COALESCE(description, ''), 0,
        CAST(created_at AS TEXT), CAST(updated_at AS TEXT)
      FROM legacy_items;

      INSERT OR IGNORE INTO item_topics (item_id, topic_id)
      SELECT id, topic_id FROM legacy_items WHERE topic_id IS NOT NULL;

      INSERT OR IGNORE INTO item_topics (item_id, topic_id)
      SELECT item_id, tag_id FROM legacy_item_tags;

      INSERT INTO items_fts (item_id, title, description, clean_text, topics_text)
      SELECT
        i.id, i.title, i.description, i.clean_text,
        COALESCE((
          SELECT group_concat(t.name, ' ')
          FROM item_topics it JOIN topics t ON t.id = it.topic_id
          WHERE it.item_id = i.id
        ), '')
      FROM items i;

      DROP TABLE legacy_item_tags;
      DROP TABLE legacy_tags;
      DROP TABLE legacy_items;
      DROP TABLE legacy_topics;
    `);
  });
}

export async function runMigrations(database: SQLiteDatabase): Promise<void> {
  const result = await database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  let version = result?.user_version ?? 0;

  if (version < 1) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(SCHEMA_V1);
      await database.execAsync('PRAGMA user_version = 1');
    });
    version = 1;
  }

  if (version < 2) {
    await migrateLegacyV1(database);
    await database.execAsync('PRAGMA user_version = 2');
  }
}
