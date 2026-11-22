import * as SQLite from 'expo-sqlite';

import { runMigrations } from './migrations';

const DATABASE_NAME = 'localvault.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase();
  }

  return databasePromise;
}

async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  await runMigrations(database);
  await database.runAsync(
    'INSERT OR IGNORE INTO topics (id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)',
    'inbox',
    'Входящие',
    Date.now(),
  );

  return database;
}
