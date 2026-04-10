import { openDB, type IDBPDatabase } from "idb";

let dbPromise: Promise<IDBPDatabase> | null = null;

const initDB = (): Promise<IDBPDatabase> => {
  if (!dbPromise) {
    dbPromise = openDB("UpDownDB", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("keys")) {
          db.createObjectStore("keys");
        }
      },
    });
  }
  return dbPromise;
};

export async function saveIndexKey<T>(key: string, value: T): Promise<boolean> {
  const db = await initDB();
  await db.put("keys", value, key);
  return true;
}

export async function getIndexKey<T>(key: string): Promise<T | undefined> {
  const db = await initDB();
  return db.get("keys", key);
}

export async function deleteIndexKey(key: string): Promise<void> {
  const db = await initDB();
  await db.delete("keys", key);
}
