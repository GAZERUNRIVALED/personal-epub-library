/**
 * Main Application Entry Point
 * Mengelola Dashboard Perpustakaan, Import EPUB, Pencarian, Detail Modal, Split EPUB, dan Backup/Restore.
 */

import { db } from './database.js';
import { EpubProcessor } from './epub-parser.js';
import { EpubReaderController } from './reader.js';
import { showToast, escapeHtml } from './utils.js';

class PersonalLibraryApp {
    constructor() {
        this.books = [];
        this.selectedBook = null;
        this.reader = new EpubReaderController({
            onExit: () => this.refreshLibrary()
        });

        this.init();
    }

    async init() {
        this.bindDashboardEvents();
        await this.refreshLibrary();
    }

    bindDashboardEvents() {
        const fileInput = document.getElementById('epub-file-input');
        document.getElementById('btn-upload-trigger').addEventListener('click', () => fileInput.click());
        document.getElementById('btn-empty-upload').addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) {
                await this.handleImportFiles(files);
                fileInput.value = '';
            }
        });

        // Pencarian Judul & Penulis
        document.getElementById('library-search').addEventListener('input', (e) => {
            this.renderBookGrid(e.target.value);
        });

        // Backup & Restore JSON
        document.getElementById('btn-backup').addEventListener('click', () => this.handleBackup());
        const restoreInput = document.getElementById('restore-input');
        document.getElementById('btn-restore').addEventListener('click', () => restoreInput.click());
        restoreInput.addEventListener('change', async (e) => {
            if (e.target.files?.[0]) {
                await this.handleRestore(e.target.files[0]);
                restoreInput.value = '';
            }
        });

        // Modal Controls
        document.getElementById('btn-close-modal').addEventListener('click', () => this.closeModal());
        document.querySelector('#book-detail-modal .modal-backdrop').addEventListener('click', () => this.closeModal());

        document.getElementById('btn-modal-read').addEventListener('click', () => {
            if (!this.selectedBook) return;
            const id = this.selectedBook.id;
            this.closeModal();
            this.reader.openBook(id);
        });

        document.getElementById('btn-modal-delete').addEventListener('click', async () => {
            if (!this.selectedBook) return;
            await this.confirmAndDeleteBook(this.selectedBook);
            this.closeModal();
        });

        document.getElementById('btn-modal-export-range').addEventListener('click', () => {
            document.getElementById('split-panel').classList.toggle('hidden');
        });

        document.getElementById('btn-execute-split').addEventListener('click', () => this.handleSplitEpub());
    }

    async refreshLibrary() {
        this.books = await db.getAllBooks();
        document.getElementById('book-count-badge').textContent = `${this.books.length} Novel Tersimpan`;
        const currentQuery = document.getElementById('library-search').value;
        this.renderBookGrid(currentQuery);
    }

    renderBookGrid(searchQuery = '') {
        const grid = document.getElementById('book-grid');
        const emptyState = document.getElementById('empty-state');
        const q = searchQuery.trim().toLowerCase();

        const filtered = q
            ? this.books.filter(b =>
                b.title.toLowerCase().includes(q) ||
                b.author.toLowerCase().includes(q)
            )
            : this.books;

        if (this.books.length === 0) {
            grid.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        grid.innerHTML = '';

        const fragment = document.createDocumentFragment();
        for (const book of filtered) {
            const currentCh = (book.progress?.chapterIndex || 0) + 1;
            const totalCh = book.totalChapters || 1;
            const pct = Math.min(100, Math.round((currentCh / totalCh) * 100));

            const card = document.createElement('div');
            card.className = 'book-item';
            card.innerHTML = `
                <div class="book-cover-wrapper">
                    <img src="${book.coverDataUrl}" alt="${escapeHtml(book.title)}" loading="lazy">
                    <div class="book-actions-overlay">
                        <button class="mini-action-btn info-btn" title="Detail & Split EPUB">ⓘ</button>
                        <button class="mini-action-btn delete del-btn" title="Hapus Novel">✕</button>
                    </div>
                    <div class="book-progress-bar"><span style="width: ${pct}%"></span></div>
                </div>
                <div class="book-title">${escapeHtml(book.title)}</div>
                <div class="book-author">${escapeHtml(book.author)}</div>
                <div class="book-meta-line">Ch ${currentCh} / ${totalCh} (${pct}%)</div>
            `;

            // Klik langsung pada cover/judul membuka Reader
            card.addEventListener('click', (e) => {
                if (e.target.closest('.info-btn')) {
                    this.openBookModal(book);
                } else if (e.target.closest('.del-btn')) {
                    this.confirmAndDeleteBook(book);
                } else {
                    this.reader.openBook(book.id);
                }
            });

            fragment.appendChild(card);
        }

        grid.appendChild(fragment);
    }

    async handleImportFiles(files) {
        const progressBox = document.getElementById('import-progress-box');
        const statusText = document.getElementById('import-status-text');
        const subStatus = document.getElementById('import-substatus');
        const percentEl = document.getElementById('import-percent');
        const barEl = document.getElementById('import-progress-bar');

        progressBox.classList.remove('hidden');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            statusText.textContent = `Mengimpor (${i + 1}/${files.length}): ${file.name}`;

            try {
                const bookRecord = await EpubProcessor.parseEpubForImport(file, (pct, msg) => {
                    percentEl.textContent = `${pct}%`;
                    barEl.style.width = `${pct}%`;
                    subStatus.textContent = msg;
                });

                subStatus.textContent = 'Menyimpan ke IndexedDB browser...';
                await db.saveBook(bookRecord, file);
                showToast(`Berhasil menambahkan "${bookRecord.title}" (${bookRecord.totalChapters} chapter)`);
            } catch (err) {
                console.error('Error import EPUB:', err);
                showToast(`Gagal mengimpor ${file.name}: ${err.message}`, 5000);
            }
        }

        setTimeout(() => {
            progressBox.classList.add('hidden');
            barEl.style.width = '0%';
        }, 600);

        await this.refreshLibrary();
    }

    openBookModal(book) {
        this.selectedBook = book;
        document.getElementById('modal-cover').src = book.coverDataUrl;
        document.getElementById('modal-lang').textContent = (book.language || 'ID').toUpperCase();
        document.getElementById('modal-title').textContent = book.title;
        document.getElementById('modal-author').textContent = book.author;
        document.getElementById('modal-chapters').textContent = `${book.totalChapters} Chapter`;
        document.getElementById('modal-publisher').textContent = book.publisher;
        document.getElementById('modal-format').textContent = book.formatSource;
        document.getElementById('modal-desc').textContent = book.description;

        const genreBox = document.getElementById('modal-genres');
        genreBox.innerHTML = (book.genres || [])
            .map(g => `<span class="genre-pill">${escapeHtml(g)}</span>`)
            .join('');

        // Konfigurasi batas split chapter
        const startInput = document.getElementById('split-start');
        const endInput = document.getElementById('split-end');
        startInput.value = 1;
        startInput.max = book.totalChapters;
        endInput.value = Math.min(500, book.totalChapters);
        endInput.max = book.totalChapters;
        document.getElementById('split-panel').classList.add('hidden');
        document.getElementById('split-status').textContent = '';

        document.getElementById('book-detail-modal').classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('book-detail-modal').classList.add('hidden');
        this.selectedBook = null;
    }

    async confirmAndDeleteBook(book) {
        const ok = confirm(`Hapus permanen "${book.title}" dari penyimpanan browser ini?`);
        if (!ok) return;
        await db.deleteBook(book.id);
        showToast(`"${book.title}" telah dihapus.`);
        await this.refreshLibrary();
    }

    async handleSplitEpub() {
        if (!this.selectedBook) return;
        const start = parseInt(document.getElementById('split-start').value, 10) - 1;
        const end = parseInt(document.getElementById('split-end').value, 10) - 1;
        const statusEl = document.getElementById('split-status');

        if (isNaN(start) || isNaN(end) || start < 0 || end >= this.selectedBook.totalChapters || start > end) {
            statusEl.textContent = 'Rentang nomor chapter tidak valid.';
            return;
        }

        const blob = await db.getBookFileBlob(this.selectedBook.id);
        if (!blob) {
            statusEl.textContent = 'File EPUB asli tidak tersedia.';
            return;
        }

        statusEl.textContent = 'Mengemas ulang chapter menjadi EPUB...';
        try {
            const { blob: outBlob, filename } = await EpubProcessor.splitEpubRange(
                blob,
                this.selectedBook,
                start,
                end,
                (pct) => { statusEl.textContent = `Memproses EPUB pecahan: ${pct}%`; }
            );

            const url = URL.createObjectURL(outBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            statusEl.textContent = `Berhasil diunduh: ${filename}`;
        } catch (err) {
            statusEl.textContent = `Gagal memecah EPUB: ${err.message}`;
        }
    }

    async handleBackup() {
        const jsonStr = await db.exportBackupJson();
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `personal-epub-library-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        showToast('Backup metadata & progress berhasil diunduh.');
    }

    async handleRestore(file) {
        try {
            const text = await file.text();
            const count = await db.importBackupJson(text);
            showToast(`Berhasil memulihkan ${count} data novel. (Upload ulang file .epub jika ingin membaca isinya).`, 5000);
            await this.refreshLibrary();
        } catch (err) {
            showToast(`Gagal restore: ${err.message}`, 4000);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new PersonalLibraryApp();
});
