/**
 * Dual-Mode EPUB Reader Engine
 * - Mode A (EPUB Asli): Menggunakan Sandboxed Asset Resolver (CSS, Font, Gambar lokal via Blob URL dengan GC otomatis)
 *   atau epub.js untuk buku berformat standar.
 * - Mode B (Text Reader): Teks terstruktur bersih dengan kustomisasi tipografi dan tema.
 */

import { db } from './database.js';
import { EpubProcessor } from './epub-parser.js';
import { VirtualChapterList } from './virtual-list.js';
import { resolveEpubPath, getMimeType, showToast } from './utils.js';

export class EpubReaderController {
    constructor({ onExit }) {
        this.onExit = onExit;
        this.book = null;
        this.zip = null;
        this.epubjsBook = null;
        this.epubjsRendition = null;

        this.currentChapterIndex = 0;
        this.readerMode = 'original'; // 'original' | 'text'
        this.originalEngine = 'auto'; // 'auto' | 'sandbox' | 'epubjs'

        // Cache Blob URL aset per chapter agar tidak terjadi kebocoran memori (RAM leak)
        this.activeBlobUrls = new Set();
        this.cachedParsedDoc = null; // Cache DOM chapter aktif untuk pindah mode instan

        this.initElements();
        this.bindEvents();
        this.loadSavedPreferences();
    }

    initElements() {
        this.view = document.getElementById('reader-view');
        this.bookTitleEl = document.getElementById('reader-book-title');
        this.chapterTitleEl = document.getElementById('reader-chapter-title');
        this.footerProgressEl = document.getElementById('footer-progress');

        this.sandboxContainer = document.getElementById('original-sandbox-container');
        this.sandboxFrame = document.getElementById('chapter-sandbox-frame');
        this.epubjsContainer = document.getElementById('epubjs-container');
        this.epubjsViewer = document.getElementById('epubjs-viewer');
        this.textContainer = document.getElementById('text-reader-container');
        this.textContent = document.getElementById('text-reader-content');

        this.tocDrawer = document.getElementById('toc-drawer');
        this.settingsDrawer = document.getElementById('settings-drawer');

        this.virtualToc = new VirtualChapterList({
            viewportEl: document.getElementById('toc-virtual-container'),
            spacerEl: document.getElementById('toc-virtual-spacer'),
            contentEl: document.getElementById('toc-virtual-content'),
            onSelect: (index) => {
                this.loadChapter(index);
                this.tocDrawer.classList.add('hidden');
            }
        });
    }

    bindEvents() {
        document.getElementById('btn-back-library').addEventListener('click', () => this.closeReader());

        document.getElementById('btn-toggle-toc').addEventListener('click', () => {
            this.settingsDrawer.classList.add('hidden');
            this.tocDrawer.classList.toggle('hidden');
            if (!this.tocDrawer.classList.contains('hidden')) {
                this.virtualToc.setActiveIndex(this.currentChapterIndex, true);
            }
        });

        document.getElementById('btn-close-toc').addEventListener('click', () => {
            this.tocDrawer.classList.add('hidden');
        });

        document.getElementById('toc-search-input').addEventListener('input', (e) => {
            this.virtualToc.filter(e.target.value);
        });

        document.getElementById('btn-toggle-settings').addEventListener('click', () => {
            this.tocDrawer.classList.add('hidden');
            this.settingsDrawer.classList.toggle('hidden');
        });

        document.getElementById('btn-close-settings').addEventListener('click', () => {
            this.settingsDrawer.classList.add('hidden');
        });

        // Mode switcher
        document.getElementById('mode-original').addEventListener('click', () => this.switchMode('original'));
        document.getElementById('mode-text').addEventListener('click', () => this.switchMode('text'));

        // Navigasi chapter
        document.getElementById('btn-prev-chapter').addEventListener('click', () => {
            if (this.currentChapterIndex > 0) {
                this.loadChapter(this.currentChapterIndex - 1);
            }
        });

        document.getElementById('btn-next-chapter').addEventListener('click', () => {
            if (this.book && this.currentChapterIndex < this.book.chapters.length - 1) {
                this.loadChapter(this.currentChapterIndex + 1);
            }
        });

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (this.view.classList.contains('hidden')) return;
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'ArrowRight') document.getElementById('btn-next-chapter').click();
            if (e.key === 'ArrowLeft') document.getElementById('btn-prev-chapter').click();
        });

        // Pengaturan Text Reader
        document.querySelectorAll('.theme-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.theme-chip').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const theme = btn.dataset.rtheme;
                this.textContainer.setAttribute('data-rtheme', theme);
                this.savePreferences();
            });
        });

        document.getElementById('setting-font-family').addEventListener('change', (e) => {
            this.textContent.style.fontFamily = e.target.value;
            this.savePreferences();
        });

        document.getElementById('setting-font-size').addEventListener('input', (e) => {
            const val = `${e.target.value}px`;
            document.getElementById('val-font-size').textContent = val;
            this.textContent.style.fontSize = val;
            this.savePreferences();
        });

        document.getElementById('setting-line-height').addEventListener('input', (e) => {
            document.getElementById('val-line-height').textContent = e.target.value;
            this.textContent.style.lineHeight = e.target.value;
            this.savePreferences();
        });

        document.getElementById('setting-max-width').addEventListener('input', (e) => {
            const val = `${e.target.value}px`;
            document.getElementById('val-max-width').textContent = val;
            this.textContent.style.maxWidth = val;
            this.savePreferences();
        });

        document.getElementById('setting-original-engine').addEventListener('change', (e) => {
            this.originalEngine = e.target.value;
            this.savePreferences();
            if (this.readerMode === 'original') {
                this.renderCurrentChapter();
            }
        });
    }

    loadSavedPreferences() {
        try {
            const raw = localStorage.getItem('pel_reader_prefs');
            if (!raw) return;
            const p = JSON.parse(raw);
            if (p.theme) {
                this.textContainer.setAttribute('data-rtheme', p.theme);
                document.querySelectorAll('.theme-chip').forEach(b => {
                    b.classList.toggle('active', b.dataset.rtheme === p.theme);
                });
            }
            if (p.fontFamily) {
                document.getElementById('setting-font-family').value = p.fontFamily;
                this.textContent.style.fontFamily = p.fontFamily;
            }
            if (p.fontSize) {
                document.getElementById('setting-font-size').value = p.fontSize;
                document.getElementById('val-font-size').textContent = `${p.fontSize}px`;
                this.textContent.style.fontSize = `${p.fontSize}px`;
            }
            if (p.lineHeight) {
                document.getElementById('setting-line-height').value = p.lineHeight;
                document.getElementById('val-line-height').textContent = p.lineHeight;
                this.textContent.style.lineHeight = p.lineHeight;
            }
            if (p.maxWidth) {
                document.getElementById('setting-max-width').value = p.maxWidth;
                document.getElementById('val-max-width').textContent = `${p.maxWidth}px`;
                this.textContent.style.maxWidth = `${p.maxWidth}px`;
            }
            if (p.originalEngine) {
                this.originalEngine = p.originalEngine;
                document.getElementById('setting-original-engine').value = p.originalEngine;
            }
        } catch (e) {
            console.warn('Gagal memuat preferensi pembaca:', e);
        }
    }

    savePreferences() {
        const prefs = {
            theme: this.textContainer.getAttribute('data-rtheme'),
            fontFamily: document.getElementById('setting-font-family').value,
            fontSize: document.getElementById('setting-font-size').value,
            lineHeight: document.getElementById('setting-line-height').value,
            maxWidth: document.getElementById('setting-max-width').value,
            originalEngine: this.originalEngine
        };
        localStorage.setItem('pel_reader_prefs', JSON.stringify(prefs));
    }

    revokeActiveBlobs() {
        for (const url of this.activeBlobUrls) {
            URL.revokeObjectURL(url);
        }
        this.activeBlobUrls.clear();
    }

    async openBook(bookId) {
        const bookMeta = await db.getBookMetadata(bookId);
        const blob = await db.getBookFileBlob(bookId);

        if (!bookMeta || !blob) {
            showToast('File EPUB asli tidak ditemukan di IndexedDB. Silakan import ulang.');
            return;
        }

        this.book = bookMeta;
        this.zip = await window.JSZip.loadAsync(blob);
        this.currentChapterIndex = bookMeta.progress?.chapterIndex || 0;

        this.bookTitleEl.textContent = bookMeta.title;
        document.getElementById('toc-total-count').textContent = bookMeta.chapters.length;
        this.virtualToc.setItems(bookMeta.chapters, this.currentChapterIndex);

        // Siapkan instance epub.js hanya jika buku standar & epub.js tersedia
        if (window.ePub && !bookMeta.formatSource.includes('Legado')) {
            try {
                if (this.epubjsBook) this.epubjsBook.destroy();
                this.epubjsBook = window.ePub(blob);
            } catch (err) {
                console.warn('epub.js init fallback ke sandbox:', err);
                this.epubjsBook = null;
            }
        }

        document.getElementById('library-view').classList.add('hidden');
        this.view.classList.remove('hidden');

        await this.loadChapter(this.currentChapterIndex);
    }

    closeReader() {
        this.revokeActiveBlobs();
        if (this.epubjsBook) {
            try { this.epubjsBook.destroy(); } catch {}
            this.epubjsBook = null;
        }
        this.zip = null;
        this.book = null;
        this.view.classList.add('hidden');
        document.getElementById('library-view').classList.remove('hidden');
        if (this.onExit) this.onExit();
    }

    switchMode(mode) {
        this.readerMode = mode;
        document.getElementById('mode-original').classList.toggle('active', mode === 'original');
        document.getElementById('mode-text').classList.toggle('active', mode === 'text');
        this.renderCurrentChapter();
    }

    async loadChapter(index) {
        if (!this.book || !this.zip) return;
        const clamped = Math.max(0, Math.min(index, this.book.chapters.length - 1));
        this.currentChapterIndex = clamped;
        const chapter = this.book.chapters[clamped];

        this.chapterTitleEl.textContent = chapter.title;
        this.footerProgressEl.textContent = `Chapter ${clamped + 1} / ${this.book.chapters.length}`;
        this.virtualToc.setActiveIndex(clamped, false);

        // Simpan progress secara otomatis ke IndexedDB
        db.updateProgress(this.book.id, clamped, 0).catch(console.error);

        // Bebaskan Blob URL dari chapter sebelumnya agar RAM tetap rendah
        this.revokeActiveBlobs();

        // Ekstrak & parse dokumen chapter aktif
        const zipEntry = EpubProcessor.findZipFileCaseInsensitive(this.zip, chapter.href);
        if (!zipEntry) {
            this.textContent.innerHTML = `<p><em>File chapter (${chapter.href}) tidak ditemukan dalam arsip EPUB.</em></p>`;
            return;
        }

        const rawHtml = await zipEntry.async('text');
        // Gunakan text/html agar HTML5 dari Legado maupun XHTML standar ter-parse tanpa error XML
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawHtml, 'text/html');

        this.cachedParsedDoc = {
            doc,
            baseHref: chapter.href,
            title: chapter.title
        };

        await this.renderCurrentChapter();
    }

    async renderCurrentChapter() {
        if (!this.cachedParsedDoc) return;

        // Sembunyikan semua pane
        this.sandboxContainer.classList.add('hidden');
        this.epubjsContainer.classList.add('hidden');
        this.textContainer.classList.add('hidden');

        if (this.readerMode === 'text') {
            this.textContainer.classList.remove('hidden');
            await this.renderTextMode();
            return;
        }

        // Mode A: EPUB Asli
        const useEpubJs = (
            this.originalEngine === 'epubjs' ||
            (this.originalEngine === 'auto' && this.epubjsBook && !this.book.formatSource.includes('Legado'))
        );

        if (useEpubJs && this.epubjsBook) {
            this.epubjsContainer.classList.remove('hidden');
            await this.renderEpubJsMode();
        } else {
            this.sandboxContainer.classList.remove('hidden');
            await this.renderSandboxedOriginalMode();
        }
    }

    /**
     * Resolusi seluruh aset internal (img, svg image, link stylesheet, CSS url() font & background)
     * menjadi Blob URL sementara agar tampil utuh di dalam iframe maupun Text Reader.
     */
    async resolveAssetBlobUrl(baseFilePath, relativeUrl) {
        const resolvedZipPath = resolveEpubPath(baseFilePath, relativeUrl);
        if (!resolvedZipPath || /^(data:|blob:|https?:)/i.test(resolvedZipPath)) {
            return resolvedZipPath;
        }

        const entry = EpubProcessor.findZipFileCaseInsensitive(this.zip, resolvedZipPath);
        if (!entry) return relativeUrl;

        const mime = getMimeType(resolvedZipPath);

        // Jika file adalah CSS, proses juga url(...) di dalamnya (misal font lokal atau background image)
        if (mime === 'text/css') {
            let cssText = await entry.async('text');
            const urlMatches = [...cssText.matchAll(/url\(['"]?([^'")]+)['"]?\)/gi)];
            for (const match of urlMatches) {
                const rawAssetRef = match[1];
                if (/^(data:|blob:|https?:)/i.test(rawAssetRef)) continue;
                const nestedBlobUrl = await this.resolveAssetBlobUrl(resolvedZipPath, rawAssetRef);
                cssText = cssText.replace(match[0], `url("${nestedBlobUrl}")`);
            }
            const cssBlob = new Blob([cssText], { type: 'text/css' });
            const blobUrl = URL.createObjectURL(cssBlob);
            this.activeBlobUrls.add(blobUrl);
            return blobUrl;
        }

        const arrayBuffer = await entry.async('arraybuffer');
        const blob = new Blob([arrayBuffer], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        this.activeBlobUrls.add(blobUrl);
        return blobUrl;
    }

    async renderSandboxedOriginalMode() {
        const { doc, baseHref } = this.cachedParsedDoc;
        const clone = doc.cloneNode(true);

        // 1. Resolve semua gambar (<img src> dan <image xlink:href / href>)
        const images = clone.querySelectorAll('img[src]');
        for (const img of images) {
            const src = img.getAttribute('src');
            img.setAttribute('src', await this.resolveAssetBlobUrl(baseHref, src));
        }

        const svgImages = clone.querySelectorAll('image');
        for (const svgImg of svgImages) {
            const href = svgImg.getAttribute('href') || svgImg.getAttribute('xlink:href');
            if (href) {
                const resolved = await this.resolveAssetBlobUrl(baseHref, href);
                svgImg.setAttribute('href', resolved);
            }
        }

        // 2. Resolve semua stylesheet eksternal (<link rel="stylesheet">)
        const links = clone.querySelectorAll('link[rel="stylesheet"][href]');
        for (const link of links) {
            const href = link.getAttribute('href');
            link.setAttribute('href', await this.resolveAssetBlobUrl(baseHref, href));
        }

        // 3. Inject dark-mode base fallback yang tetap menghormati CSS bawaan buku
        const baseStyle = clone.createElement('style');
        baseStyle.textContent = `
            html, body {
                background-color: #141416;
                color: #e4e4e7;
                margin: 0 auto;
                padding: 24px 20px 64px;
                max-width: 820px;
                line-height: 1.75;
                font-size: 18px;
                word-wrap: break-word;
            }
            img, svg { max-width: 100% !important; height: auto !important; }
            p { margin-bottom: 1em; }
        `;
        if (clone.head) {
            clone.head.prepend(baseStyle);
        }

        const serializedHtml = '<!DOCTYPE html>\n' + clone.documentElement.outerHTML;
        this.sandboxFrame.srcdoc = serializedHtml;
    }

    async renderEpubJsMode() {
        try {
            const chapter = this.book.chapters[this.currentChapterIndex];
            if (!this.epubjsRendition) {
                this.epubjsViewer.innerHTML = '';
                this.epubjsRendition = this.epubjsBook.renderTo('epubjs-viewer', {
                    width: '100%',
                    height: '100%',
                    flow: 'scrolled-doc'
                });
                this.epubjsRendition.themes.default({
                    body: { background: '#141416', color: '#e4e4e7', 'padding': '20px' }
                });
            }
            await this.epubjsRendition.display(chapter.href);
        } catch (err) {
            console.warn('epub.js gagal merender chapter ini, beralih ke Sandbox Renderer:', err);
            this.originalEngine = 'sandbox';
            this.renderCurrentChapter();
        }
    }

    async renderTextMode() {
        const { doc, baseHref, title } = this.cachedParsedDoc;
        const bodyClone = doc.body ? doc.body.cloneNode(true) : document.createElement('div');

        // Hapus script/style inline yang bisa merusak keterbacaan Text Mode
        bodyClone.querySelectorAll('script, style, link, meta').forEach(el => el.remove());

        // Resolve gambar di dalam teks agar ilustrasi novel tetap muncul di Text Reader
        const imgs = bodyClone.querySelectorAll('img[src]');
        for (const img of imgs) {
            const src = img.getAttribute('src');
            img.setAttribute('src', await this.resolveAssetBlobUrl(baseHref, src));
            img.removeAttribute('width');
            img.removeAttribute('height');
        }

        // Pastikan judul chapter tampil jika belum ada heading di awal
        const firstHeading = bodyClone.querySelector('h1, h2, h3');
        const hasHeading = firstHeading && firstHeading.textContent.trim().length > 0;

        this.textContent.innerHTML = '';
        if (!hasHeading) {
            const h2 = document.createElement('h2');
            h2.textContent = title;
            this.textContent.appendChild(h2);
        }
        this.textContent.appendChild(bodyClone);
        this.textContainer.scrollTop = 0;
    }
}
