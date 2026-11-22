/**
 * IndexedDB Storage Layer
 * Memisahkan store 'books' (metadata + daftar chapter ringan) dan 'files' (Blob EPUB asli)
 * agar daftar perpustakaan terbuka instan tanpa memuat puluhan MB Blob EPUB ke memori.
 */

const DB_NAME = 'PersonalEpubLibraryDB';
const DB_VERSION = 1;

class LibraryDatabase {
    constructor() {
        this.db = null;
    }

    async init() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('books')) {
                    const bookStore = db.createObjectStore('books', { keyPath: 'id' });
                    bookStore.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files', { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    async saveBook(bookRecord, epubBlob) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['books', 'files'], 'readwrite');
            tx.objectStore('books').put(bookRecord);
            if (epubBlob) {
                tx.objectStore('files').put({ id: bookRecord.id, blob: epubBlob });
            }
            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async getAllBooks() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['books'], 'readonly');
            const req = tx.objectStore('books').getAll();
            req.onsuccess = () => {
                const list = req.result || [];
                list.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
                resolve(list);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async getBookMetadata(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['books'], 'readonly');
            const req = tx.objectStore('books').get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async getBookFileBlob(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['files'], 'readonly');
            const req = tx.objectStore('files').get(id);
            req.onsuccess = () => resolve(req.result ? req.result.blob : null);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async updateProgress(id, chapterIndex, scrollRatio = 0) {
        await this.init();
        const book = await this.getBookMetadata(id);
        if (!book) return;
        book.progress = {
            chapterIndex,
            scrollRatio,
            updatedAt: Date.now()
        };
        book.lastReadAt = Date.now();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['books'], 'readwrite');
            tx.objectStore('books').put(book);
            tx.oncomplete = () => resolve(book);
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async deleteBook(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['books', 'files'], 'readwrite');
            tx.objectStore('books').delete(id);
            tx.objectStore('files').delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async exportBackupJson() {
        const books = await this.getAllBooks();
        return JSON.stringify({
            app: 'Personal EPUB Library',
            version: 2,
            exportedAt: new Date().toISOString(),
            books
        }, null, 2);
    }

    async importBackupJson(jsonString) {
        const parsed = JSON.parse(jsonString);
        if (!parsed || !Array.isArray(parsed.books)) {
            throw new Error('Format file backup JSON tidak valid.');
        }
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['books'], 'readwrite');
            const store = tx.objectStore('books');
            for (const b of parsed.books) {
                if (b.id && b.title) {
                    store.put(b);
                }
            }
            tx.oncomplete = () => resolve(parsed.books.length);
            tx.onerror = (e) => reject(e.target.error);
        });
    }
}

export const db = new LibraryDatabase();
