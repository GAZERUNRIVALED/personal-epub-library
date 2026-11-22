/**
 * EPUB Parser & Asset Resolver Engine
 * Dirancang untuk kompatibilitas penuh antara standar EPUB 2/3 (XHTML) dan ekspor Legado (HTML5/non-strict).
 * Memisahkan ekstraksi metadata/TOC dari pembacaan konten chapter demi efisiensi RAM (6.000+ chapter).
 */

import { resolveEpubPath, getMimeType, generateBookId, generateFallbackCover } from './utils.js';

// Pola judul halaman non-chapter (cover, sinopsis, info buku) agar tidak masuk ke urutan chapter utama
const NON_CHAPTER_TITLE_REGEX = /^(cover|sampul|title\s*page|halaman\s*judul|book\s*info|informasi\s*buku|deskripsi|description|synopsis|sinopsis|copyright|hak\s*cipta|table\s*of\s*contents|daftar\s*isi|toc|nav)$/i;
const NON_CHAPTER_FILE_REGEX = /(cover|titlepage|bookinfo|info|desc|copyright|toc|nav)\.(x?html?|htm)$/i;

export class EpubProcessor {
    /**
     * Parse struktur utama EPUB saat proses import (Metadata, Cover, Manifest, Spine, TOC).
     * Tidak memuat isi teks ribuan chapter ke RAM saat import.
     */
    static async parseEpubForImport(file, onProgress = () => {}) {
        onProgress(5, 'Membuka kontainer ZIP EPUB...');
        const zip = await window.JSZip.loadAsync(file);

        // 1. Baca META-INF/container.xml untuk menemukan lokasi file .opf
        onProgress(15, 'Mencari paket OPF...');
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) {
            throw new Error('File EPUB tidak valid: META-INF/container.xml tidak ditemukan.');
        }
        const containerXml = await containerFile.async('text');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'text/xml');
        const rootfileEl = containerDoc.querySelector('rootfile');
        const opfPath = rootfileEl ? rootfileEl.getAttribute('full-path') : null;

        if (!opfPath || !zip.file(opfPath)) {
            throw new Error('File OPF tidak ditemukan di dalam arsip EPUB.');
        }

        // 2. Parse file OPF menggunakan mode text/html yang lebih toleran terhadap namespace tidak standar
        onProgress(30, 'Membaca metadata & manifest...');
        const opfContent = await zip.file(opfPath).async('text');
        const opfDoc = parser.parseFromString(opfContent, 'text/html');

        const getMetaText = (selectors) => {
            for (const sel of selectors) {
                const el = opfDoc.querySelector(sel);
                if (el && el.textContent.trim()) return el.textContent.trim();
            }
            return '';
        };

        const title = getMetaText(['dc\\:title', 'title']) || file.name.replace(/\.epub$/i, '');
        const author = getMetaText(['dc\\:creator', 'creator']) || 'Penulis Tidak Diketahui';
        const description = getMetaText(['dc\\:description', 'description']) || 'Tidak ada deskripsi.';
        const language = getMetaText(['dc\\:language', 'language']) || 'id';
        const publisher = getMetaText(['dc\\:publisher', 'publisher']) || 'Mandiri / Legado';

        const genreEls = opfDoc.querySelectorAll('dc\\:subject, subject');
        const genres = Array.from(genreEls)
            .map(el => el.textContent.trim())
            .filter(Boolean)
            .slice(0, 8);

        // 3. Petakan Manifest (id -> { href, mediaType, properties })
        const manifest = new Map();
        let coverHref = null;
        let ncxHref = null;
        let navHref = null;

        // Cek meta name="cover"
        const metaCover = opfDoc.querySelector('meta[name="cover"]');
        const metaCoverId = metaCover ? metaCover.getAttribute('content') : null;

        opfDoc.querySelectorAll('manifest item').forEach(item => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            const mediaType = item.getAttribute('media-type') || '';
            const properties = item.getAttribute('properties') || '';

            if (!id || !href) return;
            const resolvedHref = resolveEpubPath(opfPath, href);
            manifest.set(id, { id, href: resolvedHref, rawHref: href, mediaType, properties });

            if (properties.includes('cover-image') || id === metaCoverId) {
                coverHref = resolvedHref;
            }
            if (mediaType === 'application/x-dtbncx+xml' || href.toLowerCase().endsWith('.ncx')) {
                ncxHref = resolvedHref;
            }
            if (properties.includes('nav')) {
                navHref = resolvedHref;
            }
        });

        // Fallback pencarian gambar cover jika tidak dideklarasikan eksplisit
        if (!coverHref) {
            for (const item of manifest.values()) {
                if (item.mediaType.startsWith('image/') && /cover/i.test(item.href)) {
                    coverHref = item.href;
                    break;
                }
            }
        }

        // Ekstrak Cover sebagai Data URL terkompresi ringan untuk thumbnail Dashboard
        onProgress(48, 'Mengekstrak sampul novel...');
        let coverDataUrl = null;
        if (coverHref) {
            const coverZipEntry = this.findZipFileCaseInsensitive(zip, coverHref);
            if (coverZipEntry) {
                const base64 = await coverZipEntry.async('base64');
                const mime = getMimeType(coverHref);
                coverDataUrl = `data:${mime};base64,${base64}`;
            }
        }
        if (!coverDataUrl) {
            coverDataUrl = generateFallbackCover(title, author);
        }

        // 4. Parse Daftar Isi (NCX atau EPUB3 Nav) untuk mendapatkan judul asli chapter
        onProgress(65, 'Memetakan daftar isi (NCX / Nav)...');
        const tocTitleMap = new Map(); // normalizedPath -> title

        if (navHref) {
            const navEntry = this.findZipFileCaseInsensitive(zip, navHref);
            if (navEntry) {
                const navHtml = await navEntry.async('text');
                const navDoc = parser.parseFromString(navHtml, 'text/html');
                navDoc.querySelectorAll('nav a[href]').forEach(a => {
                    const target = resolveEpubPath(navHref, a.getAttribute('href'));
                    const label = a.textContent.trim();
                    if (target && label && !tocTitleMap.has(target)) {
                        tocTitleMap.set(target, label);
                    }
                });
            }
        }

        if (tocTitleMap.size === 0 && ncxHref) {
            const ncxEntry = this.findZipFileCaseInsensitive(zip, ncxHref);
            if (ncxEntry) {
                const ncxText = await ncxEntry.async('text');
                const ncxDoc = parser.parseFromString(ncxText, 'text/html');
                ncxDoc.querySelectorAll('navpoint').forEach(np => {
                    const labelEl = np.querySelector('navlabel text');
                    const contentEl = np.querySelector('content');
                    if (labelEl && contentEl) {
                        const src = contentEl.getAttribute('src');
                        const target = resolveEpubPath(ncxHref, src);
                        const label = labelEl.textContent.trim();
                        if (target && label && !tocTitleMap.has(target)) {
                            tocTitleMap.set(target, label);
                        }
                    }
                });
            }
        }

        // 5. Susun Spine (Urutan Chapter Utama)
        onProgress(82, 'Menyusun struktur chapter...');
        const spineItems = opfDoc.querySelectorAll('spine itemref');
        const chapters = [];
        let isLegadoExport = false;

        spineItems.forEach((itemref, idx) => {
            const idref = itemref.getAttribute('idref');
            const linear = itemref.getAttribute('linear');
            if (linear === 'no') return;

            const manifestItem = manifest.get(idref);
            if (!manifestItem) return;

            if (manifestItem.href.endsWith('.html') || manifestItem.href.endsWith('.htm')) {
                isLegadoExport = true;
            }

            const mappedTitle = tocTitleMap.get(manifestItem.href) || '';
            const cleanTitle = mappedTitle || `Chapter ${chapters.length + 1}`;

            // Filter halaman cover / metadata awal agar tidak menjadi chapter bacaan utama
            const isFrontMatter = idx <= 3 && (
                NON_CHAPTER_TITLE_REGEX.test(cleanTitle.trim()) ||
                NON_CHAPTER_FILE_REGEX.test(manifestItem.href)
            );

            if (isFrontMatter) return;

            chapters.push({
                index: chapters.length,
                href: manifestItem.href,
                title: cleanTitle
            });
        });

        // Fallback jika semua terfilter (misal buku hanya 1 halaman)
        if (chapters.length === 0) {
            spineItems.forEach((itemref) => {
                const manifestItem = manifest.get(itemref.getAttribute('idref'));
                if (manifestItem) {
                    chapters.push({
                        index: chapters.length,
                        href: manifestItem.href,
                        title: tocTitleMap.get(manifestItem.href) || `Bagian ${chapters.length + 1}`
                    });
                }
            });
        }

        onProgress(100, 'Selesai!');

        return {
            id: generateBookId(),
            title,
            author,
            description,
            language,
            publisher,
            genres,
            coverDataUrl,
            opfPath,
            formatSource: isLegadoExport ? 'EPUB (HTML / Legado)' : 'EPUB Standard',
            totalChapters: chapters.length,
            chapters, // Array ringan berisi { index, href, title }
            addedAt: Date.now(),
            lastReadAt: Date.now(),
            progress: {
                chapterIndex: 0,
                scrollRatio: 0,
                updatedAt: Date.now()
            }
        };
    }

    static findZipFileCaseInsensitive(zip, targetPath) {
        if (!targetPath) return null;
        const direct = zip.file(targetPath);
        if (direct) return direct;

        const lowerTarget = targetPath.toLowerCase();
        const foundKey = Object.keys(zip.files).find(k => k.toLowerCase() === lowerTarget);
        return foundKey ? zip.file(foundKey) : null;
    }

    /**
     * Memecah rentang chapter (misal Ch 1 - 500) menjadi file EPUB baru yang valid untuk diunduh.
     */
    static async splitEpubRange(originalBlob, bookMeta, startIndex, endIndex, onProgress = () => {}) {
        const sourceZip = await window.JSZip.loadAsync(originalBlob);
        const outZip = new window.JSZip();

        // File mimetype wajib tanpa kompresi di root EPUB
        outZip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        outZip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

        const slice = bookMeta.chapters.slice(startIndex, endIndex + 1);
        const manifestXml = [];
        const spineXml = [];
        const navLiXml = [];

        for (let i = 0; i < slice.length; i++) {
            const ch = slice[i];
            if (i % 50 === 0) {
                onProgress(Math.round((i / slice.length) * 90));
            }
            const zipEntry = this.findZipFileCaseInsensitive(sourceZip, ch.href);
            if (!zipEntry) continue;

            const content = await zipEntry.async('text');
            const newFilename = `ch_${i + 1}.html`;
            outZip.file(`OEBPS/${newFilename}`, content);

            manifestXml.push(`<item id="ch${i + 1}" href="${newFilename}" media-type="application/xhtml+xml"/>`);
            spineXml.push(`<itemref idref="ch${i + 1}"/>`);
            navLiXml.push(`<li><a href="${newFilename}">${ch.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</a></li>`);
        }

        const partTitle = `${bookMeta.title} (Ch ${startIndex + 1}-${endIndex + 1})`;
        outZip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Daftar Isi</title></head>
<body><nav epub:type="toc"><ol>${navLiXml.join('\n')}</ol></nav></body>
</html>`);

        outZip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">split-${Date.now()}</dc:identifier>
    <dc:title>${partTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</dc:title>
    <dc:creator>${bookMeta.author.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</dc:creator>
    <dc:language>${bookMeta.language || 'id'}</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestXml.join('\n    ')}
  </manifest>
  <spine>
    ${spineXml.join('\n    ')}
  </spine>
</package>`);

        onProgress(95);
        const generatedBlob = await outZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        onProgress(100);
        return { blob: generatedBlob, filename: `${partTitle.replace(/[\\/:*?"<>|]/g, '_')}.epub` };
    }
}
