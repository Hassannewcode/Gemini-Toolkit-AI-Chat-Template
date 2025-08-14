import { openDB, IDBPDatabase, DBSchema } from 'idb';
import { Chat } from './types';

interface GeminiChatDB extends DBSchema {
  chats: {
    value: Chat;
    key: string;
    indexes: { 'id': string };
  };
}

let dbPromise: Promise<IDBPDatabase<GeminiChatDB>> | null = null;

const getDb = (): Promise<IDBPDatabase<GeminiChatDB>> => {
    if (!dbPromise) {
        dbPromise = openDB<GeminiChatDB>('gemini-chat-db', 1, {
            upgrade(db) {
                const chatStore = db.createObjectStore('chats', {
                    keyPath: 'id',
                });
                chatStore.createIndex('id', 'id', { unique: true });
            },
        });
    }
    return dbPromise;
};

export const getAllChats = async (): Promise<Chat[]> => {
    const db = await getDb();
    return db.getAll('chats');
};

export const getChat = async (id: string): Promise<Chat | undefined> => {
    const db = await getDb();
    return db.get('chats', id);
};

export const putChat = async (chat: Chat): Promise<string> => {
    const db = await getDb();
    return db.put('chats', chat);
};

export const deleteChat = async (id: string): Promise<void> => {
    const db = await getDb();
    await db.delete('chats', id);
};
