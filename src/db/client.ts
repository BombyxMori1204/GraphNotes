import * as SQLite from 'expo-sqlite';

import { runMigrations } from './migrations';
import { seedDatabase } from './seed';

const DATABASE_NAME = 'graphnotes.db';

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
  const topicCount = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM topics',
  );
  if ((topicCount?.count ?? 0) === 0) {
    await seedDatabase(database);
  }

  return database;
}
