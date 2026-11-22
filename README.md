# Personal EPUB Library V3.0
Perpustakaan EPUB pribadi + penyedia source untuk MiruTime. Satu Cloudflare Worker menyajikan frontend (`public/`), API, dan file source Lua; konten terpublikasi disimpan di R2.

## Struktur
- `public/` frontend (HTML/CSS/vanilla JS, IndexedDB, JSZip). EPUB asli, cover, progress, dan pengaturan reader **tetap lokal**.
- `worker/index.js` API + halaman HTML untuk source; `worker/source.lua` template source (baseUrl diisi otomatis saat diunduh).
- `wrangler.toml`: assets, binding R2 `BUCKET`, aturan import `.lua`.

## Deploy (sekali saja)
```
npm install
npx wrangler login
npx wrangler r2 bucket create epub-library
npx wrangler secret put ADMIN_KEY      # isi string acak panjang
npx wrangler deploy
```
Tidak ada file yang perlu diedit setelah deploy; frontend memakai origin yang sama. Lokal: buat `.dev.vars` berisi `ADMIN_KEY=xxx` lalu `npx wrangler dev`.

## Memakai
1. Buka situs, tekan ⚙, isi Admin API key, "Simpan & tes" (key hanya disimpan di localStorage browser Anda, tidak ada di kode).
2. Import EPUB → Detail → **Publish to MiruTime** (Update Publication / Unpublish menyusul setelah terbit). ID novel stabil per buku, jadi update tidak membuat duplikat.
3. Di ⚙ salin URL `…/source.lua` atau unduh filenya, lalu tambahkan ke MiruTime.

## API
Publik: `GET /api/novels`, `/api/search?keyword=`, `/api/novel/{id}`, `/api/novel/{id}/chapters`, `/api/novel/{id}/chapter/{n}`.
Untuk source Lua (HTML, meniru struktur `botaodz2.lua`): `/category/all/[N.html]`, `/s/search?searchkey=`, `/book/{id}/`, `/book/{id}/{n}.html`, `/asset/{id}/{nama}`.
Admin (Bearer ADMIN_KEY): `PUT/POST/DELETE /api/admin/...`.

## Privasi
Novel yang dipublikasikan **dapat dibaca siapa pun yang mengetahui URL Worker** (endpoint baca publik agar MiruTime bisa mengakses; tidak ada login di sisi pembaca). Hanya endpoint tulis yang dilindungi. Jangan publikasikan buku yang harus tetap privat. Anda bisa menambah Cloudflare Access di domain, tetapi itu akan memblokir MiruTime juga kecuali dibuat bypass untuk jalur baca.

## Status pengujian (jujur)
- Dijalankan: pemeriksaan sintaks semua JS; 25 tes Worker dengan R2 tiruan di Node (auth, upload, commit, update tanpa duplikat, unpublish, sanitasi, halaman HTML untuk Lua, limit ukuran).
- **Belum dijalankan**: seluruh frontend di browser, parsing EPUB nyata (Legado/standar), 6.852 chapter, deploy Cloudflare sungguhan, dan source Lua di aplikasi.

## Kompatibilitas MiruTime — yang perlu Anda ketahui
`worker/source.lua` hanya memakai fungsi dan library yang terlihat di `botaodz2.lua` (html_select, html_attr, http_get, require_lib "fetch/urls/catalog/content", dst.) dengan pola yang sama. Header file referensi itu menyebut runtime "NoveLA"; saya mengikuti file itu apa adanya. Hal yang tidak bisa saya pastikan: nilai `language = "id"`; `standardTransforms` dengan lang "id" (dibungkus `pcall`, jatuh ke teks biasa jika gagal); gambar di dalam chapter kemungkinan tidak tampil karena source mengembalikan teks; apakah MiruTime menerima URL remote atau hanya file .lua. Uji di aplikasi dan kirim pesan galat jika ada.

## Batas
Satu chapter maks 1,5 MB; gambar maks 8 MB; unggahan per request maks 3 MB. Link antar-chapter dan data: image dipertahankan seperlunya; ID dan class HTML dibuang saat publikasi.
