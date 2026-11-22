# Personal EPUB Library

Website perpustakaan EPUB pribadi. Versi 1 memproses file langsung di browser dan menyimpan koleksi di IndexedDB.

## Fitur
- Upload satu atau beberapa file EPUB
- Membaca metadata OPF: judul, penulis, deskripsi, bahasa, penerbit, subjek, cover
- Membaca EPUB 3 Navigation atau EPUB 2 NCX, dengan fallback ke spine
- Daftar chapter dan pembaca chapter terpisah
- Mode EPUB asli (dokumen chapter dalam tampilan bergaya buku) dan mode teks
- Ekspor seluruh chapter menjadi TXT
- Penyimpanan lokal menggunakan IndexedDB

## Jalankan lokal
Buka folder ini menggunakan server statis lokal, atau deploy ke Cloudflare Pages. Untuk pengujian lokal, ekstensi Live Server di VS Code bisa digunakan.

## Deploy ke GitHub + Cloudflare Pages
1. Buat repository GitHub baru, misalnya `personal-epub-library`.
2. Upload `index.html`, `style.css`, `app.js`, dan `README.md` ke root repository.
3. Di Cloudflare Dashboard, buka Workers & Pages → Create → Pages → Connect to Git.
4. Pilih repository.
5. Framework preset: `None`.
6. Build command: kosongkan.
7. Build output directory: `/` atau `.` sesuai pilihan dashboard.
8. Deploy.

## Privasi dan penyimpanan
- EPUB tidak dikirim ke server. File dibaca lokal oleh JavaScript di browser.
- Data buku disimpan di IndexedDB pada browser dan perangkat yang sama.
- Menghapus data situs/browser dapat menghapus koleksi lokal. Buat cadangan file EPUB asli.
- GitHub repository sebaiknya public hanya jika kamu nyaman membagikan kode website. Jangan pernah mengunggah EPUB pribadi ke repository.
- Untuk benar-benar membatasi akses ke situs, aktifkan Cloudflare Access. Menyembunyikan URL saja bukan proteksi.

## Catatan teknis
- JSZip dan epub.js dimuat dari CDN. Jadi pemrosesan EPUB memerlukan koneksi internet saat halaman pertama kali dibuka.
- Mode "EPUB asli" pada versi ini menampilkan konten XHTML chapter dalam frame terisolasi dengan gaya baca dasar. Ini belum merupakan renderer EPUB penuh: stylesheet asli, font tersemat, gambar relatif, dan layout kompleks belum seluruhnya dipertahankan.
- TOC EPUB yang bertingkat akan diratakan menjadi daftar chapter. Beberapa EPUB memakai struktur yang tidak standar; hasil ekstraksi dapat berbeda.
