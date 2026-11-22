# Personal EPUB Library
Perpustakaan EPUB pribadi, statis, tanpa backend. Semua data disimpan di IndexedDB browser; tidak ada yang dikirim ke server.

## Struktur
index.html · styles/main.css · scripts/{database,epub-parser,asset-resolver,library,reader,app}.js

## Alur
1. Import: JSZip → container.xml → OPF → metadata, cover, manifest, spine, nav/NCX → filter halaman non-chapter → simpan (books / files / chapters) di IndexedDB.
2. Buka: ZIP dimuat ulang dari Blob; chapter diproses hanya saat dibuka (DOMParser `text/html`, jadi HTML Legado dan XHTML sama-sama terbaca).
3. Asset: path relatif dihitung dari lokasi chapter/CSS (`../` didukung), lalu diganti Blob URL (img src/srcset, SVG image, CSS url(), @import, font). Script/handler dibuang; iframe `sandbox` tanpa JS + CSP.
4. Daftar chapter: virtual list (hanya ±20 baris DOM), pencarian pada array judul.

## Jalan lokal
`python3 -m http.server 8080` lalu buka http://localhost:8080 (IndexedDB butuh http/https, bukan file://).

## Deploy Cloudflare Pages
Push folder ini ke GitHub → Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → Build command kosong, output directory `/`. 
Akses pribadi: Zero Trust → Access → Applications → Add self-hosted → pilih domain *.pages.dev proyek → policy Allow dengan email Anda (One-time PIN).

## Keterbatasan
- JSZip dimuat dari cdnjs; untuk offline total, unduh `jszip.min.js` ke `scripts/` dan ubah tag di index.html.
- Link antar-chapter di dalam teks dinonaktifkan (navigasi lewat tombol/daftar).
- Belum diuji dengan EPUB sungguhan di browser: lakukan uji manual dengan EPUB biasa, ekspor Legado, dan file ±6.852 chapter. Hanya pemeriksaan sintaks JS yang dijalankan.
- Pengaturan baca di localStorage (kecil); EPUB di IndexedDB. Tidak ada autentikasi bawaan (gunakan Cloudflare Access).
