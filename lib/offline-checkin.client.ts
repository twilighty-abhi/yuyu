export type OfflineAttendee = {
  rsvpId: string;
  ticketToken: string;
  displayName: string;
  email: string | null;
  status: string;
  checkedInAt: string | null;
};

export type OfflineRoster = {
  eventId: string;
  generatedAt: string;
  expiresAt: string;
  rows: OfflineAttendee[];
};

export type PendingOfflineCheckIn = {
  id: string;
  eventId: string;
  rsvpId: string;
  checkedInAt: string;
  force: boolean;
};

const DB_NAME = "yuyu-offline-checkin";
const DB_VERSION = 1;
const ROSTER_STORE = "rosters";
const QUEUE_STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROSTER_STORE)) db.createObjectStore(ROSTER_STORE, { keyPath: "eventId" });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        store.createIndex("eventId", "eventId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function runTransaction<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export function saveOfflineRoster(roster: OfflineRoster) {
  return runTransaction(ROSTER_STORE, "readwrite", (store) => store.put(roster));
}

export function getOfflineRoster(eventId: string) {
  return runTransaction<OfflineRoster | undefined>(ROSTER_STORE, "readonly", (store) => store.get(eventId)).then(async (roster) => {
    if (roster && new Date(roster.expiresAt).getTime() <= Date.now()) {
      await removeOfflineRoster(eventId);
      return undefined;
    }
    return roster;
  });
}

export function queueOfflineCheckIn(checkIn: Omit<PendingOfflineCheckIn, "id">) {
  const item: PendingOfflineCheckIn = { ...checkIn, id: crypto.randomUUID() };
  return runTransaction(QUEUE_STORE, "readwrite", (store) => store.put(item));
}

export async function getPendingOfflineCheckIns(eventId: string): Promise<PendingOfflineCheckIn[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, "readonly");
    const request = transaction.objectStore(QUEUE_STORE).index("eventId").getAll(eventId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function removeQueuedOfflineCheckIns(ids: string[]) {
  if (ids.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(QUEUE_STORE);
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export function removeOfflineRoster(eventId: string) {
  return runTransaction(ROSTER_STORE, "readwrite", (store) => store.delete(eventId));
}
