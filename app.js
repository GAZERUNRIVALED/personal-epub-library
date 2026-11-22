/* Personal EPUB Library v1.0
   EPUB parsing happens locally in the browser. No EPUB file is uploaded to the host. */
const DB_NAME = "personal-epub-library";
const DB_VERSION = 1;
let db, books = [], activeBook = null, activeChapter = 0, activeMode = "original", rendition = null, epubBook = null, fontSize = 18;
const $ = id => document.getElementById(id);

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore("books", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function dbGetAll() { return new Promise((res, rej) => { const r=db.transaction("books").objectStore("books").getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function dbPut(value) { return new Promise((res, rej) => { const r=db.transaction("books","readwrite").objectStore("books").put(value); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
function dbDelete(id) { return new Promise((res, rej) => { const r=db.transaction("books","readwrite").objectStore("books").delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
function showToast(message) { const t=$("toast"); t.textContent=message; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2600); }
function busy(show, text="Memproses EPUB...") { $("busyText").textContent=text; $("busy").classList.toggle("hidden",!show); }
function escapeHTML(s="") { return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function textOf(el) { return (el?.textContent || "").trim(); }
function cleanPath(path) { const stack=[]; for(const p of path.replace(/\\/g,"/").split("/")){if(!p||p===".")continue;if(p==="..")stack.pop();else stack.push(p);} return stack.join("/"); }
function resolvePath(base, href) { if(!href)return base; if(/^(https?:|data:|blob:|#)/i.test(href))return href; return cleanPath(base.slice(0,base.lastIndexOf("/")+1)+href.split("#")[0].split("?")[0]); }
function xmlDoc(s) { return new DOMParser().parseFromString(s,"application/xml"); }
function firstText(doc, selectors) { for(const s of selectors){const n=doc.querySelector(s);if(n&&textOf(n))return textOf(n);} return ""; }

async function parseEpub(file) {
  if(!window.JSZip) throw new Error("Pustaka ZIP belum termuat. Periksa koneksi internet lalu muat ulang.");
  const zip = await JSZip.loadAsync(file);
  const containerFile = zip.file("META-INF/container.xml");
  if(!containerFile) throw new Error("File ini tidak memiliki META-INF/container.xml. EPUB mungkin tidak valid.");
  const container = xmlDoc(await containerFile.async("text"));
  const rootfile = container.querySelector("rootfile");
  const opfPath = rootfile?.getAttribute("full-path");
  if(!opfPath || !zip.file(opfPath)) throw new Error("File OPF tidak ditemukan.");
  const opf = xmlDoc(await zip.file(opfPath).async("text"));
  const opfDir = opfPath.includes("/") ? opfPath.slice(0,opfPath.lastIndexOf("/")+1) : "";
  const meta = opf.querySelector("metadata");
  const title = firstText(meta,["title","dc\\:title"]) || file.name.replace(/\.epub$/i,"");
  const author = firstText(meta,["creator","dc\\:creator"]) || "Penulis tidak diketahui";
  const description = firstText(meta,["description","dc\\:description"]) || "Tidak ada deskripsi di metadata EPUB.";
  const language = firstText(meta,["language","dc\\:language"]) || "Tidak diketahui";
  const publisher = firstText(meta,["publisher","dc\\:publisher"]);
  const subjects = [...(meta?.querySelectorAll("subject, dc\\:subject")||[])].map(textOf).filter(Boolean);
  const manifest = new Map();
  opf.querySelectorAll("manifest item").forEach(item => {
    manifest.set(item.getAttribute("id"), {href:item.getAttribute("href"), type:item.getAttribute("media-type"), props:item.getAttribute("properties")||""});
  });
  let coverHref = "";
  const coverMeta = [...(meta?.querySelectorAll("meta")||[])].find(m=>m.getAttribute("name")==="cover");
  if(coverMeta) coverHref = manifest.get(coverMeta.getAttribute("content"))?.href || "";
  if(!coverHref) {
    const coverItem = [...manifest.values()].find(m=>m.props.split(/\s+/).includes("cover-image"));
    coverHref = coverItem?.href || "";
  }
  let coverData = "";
  if(coverHref) {
    const coverPath=resolvePath(opfDir,coverHref), coverFile=zip.file(coverPath);
    if(coverFile) coverData=await coverFile.async("base64").then(b=>`data:${manifest.get([...manifest].find(([,v])=>resolvePath(opfDir,v.href)===coverPath)?.[0])?.type||"image/jpeg"};base64,${b}`).catch(()=> "");
  }
  // EPUB 3 navigation document
  let navItem = [...manifest.values()].find(m=>m.props.split(/\s+/).includes("nav"));
  let toc = [];
  if(navItem) {
    const navPath=resolvePath(opfDir,navItem.href), navFile=zip.file(navPath);
    if(navFile) {
      const nav=xmlDoc(await navFile.async("text"));
      const navEl=[...nav.querySelectorAll("nav")].find(n=>(n.getAttribute("epub:type")||n.getAttribute("type")||"").includes("toc")) || nav.querySelector("nav");
      if(navEl) toc=[...navEl.querySelectorAll("a[href]")].map(a=>({label:textOf(a),href:resolvePath(navPath,a.getAttribute("href"))})).filter(x=>x.label);
    }
  }
  // EPUB 2 NCX fallback
  if(!toc.length) {
    const ncxItem=[...manifest.values()].find(m=>m.type==="application/x-dtbncx+xml");
    if(ncxItem) {
      const ncxPath=resolvePath(opfDir,ncxItem.href), ncx=xmlDoc(await zip.file(ncxPath).async("text"));
      toc=[...ncx.querySelectorAll("navPoint")].map(n=>({label:textOf(n.querySelector("navLabel text")),href:resolvePath(ncxPath,n.querySelector("content")?.getAttribute("src")||"")})).filter(x=>x.label&&x.href);
    }
  }
  // Spine fallback if no TOC
  const spineIds=[...opf.querySelectorAll("spine itemref")].map(x=>x.getAttribute("idref"));
  let chapterItems=toc.map(t=>({title:t.label,path:t.href.split("#")[0],fragment:t.href.includes("#")?t.href.split("#")[1]:""}));
  if(!chapterItems.length) chapterItems=spineIds.map(id=>{const m=manifest.get(id);return m?{title:m.href.split("/").pop().replace(/\.(xhtml|html|htm)$/i,""),path:resolvePath(opfDir,m.href),fragment:""}:null;}).filter(Boolean);
  const seen=new Set();
  chapterItems=chapterItems.filter(c=>{if(seen.has(c.path+"#"+c.fragment))return false;seen.add(c.path+"#"+c.fragment);return true;});
  if(!chapterItems.length) throw new Error("Tidak menemukan dokumen chapter di EPUB ini.");
  const chapters=[];
  for(let i=0;i<chapterItems.length;i++){
    const item=chapterItems[i], entry=zip.file(item.path);
    if(!entry) continue;
    const source=await entry.async("text");
    const doc=new DOMParser().parseFromString(source,"text/html");
    const body=doc.body || doc.documentElement;
    const content=body.innerHTML || "";
    const plain=(body.textContent||"").replace(/\s+/g," ").trim();
    chapters.push({title:item.title||`Chapter ${i+1}`,path:item.path,fragment:item.fragment,content,plain});
  }
  if(!chapters.length) throw new Error("Dokumen chapter tidak dapat dibaca.");
  return {id:crypto.randomUUID(),fileName:file.name,title,author,description,language,publisher,subjects,coverData,chapters,createdAt:Date.now(),epubBlob:file};
}

function renderLibrary() {
  const q=$("searchInput").value.trim().toLowerCase();
  const filtered=books.filter(b=>(b.title+" "+b.author).toLowerCase().includes(q));
  $("bookCount").textContent=`${books.length} novel`;
  $("emptyState").classList.toggle("hidden",books.length>0);
  $("bookGrid").innerHTML="";
  filtered.forEach(book=>{
    const card=document.createElement("article"); card.className="book-card";
    const cover=document.createElement("div");cover.className="cover";
    if(book.coverData){const img=document.createElement("img");img.src=book.coverData;img.alt="Cover "+book.title;cover.append(img);}
    else {const f=document.createElement("div");f.className="cover-fallback";f.textContent=book.title;cover.append(f);}
    const h=document.createElement("h3");h.textContent=book.title;
    const p=document.createElement("p");p.textContent=book.author;
    card.append(cover,h,p);card.addEventListener("click",()=>openDetail(book.id));$("bookGrid").append(card);
  });
  if(books.length && !filtered.length) $("bookGrid").innerHTML='<p class="muted">Tidak ada novel yang cocok.</p>';
}
async function importFiles(files) {
  if(!files.length)return;
  for(const file of files) {
    if(!file.name.toLowerCase().endsWith(".epub")){showToast(`${file.name}: bukan file EPUB.`);continue;}
    try {
      busy(true,`Membaca ${file.name}...`);
      const book=await parseEpub(file);
      await dbPut(book); books.unshift(book);
      showToast(`Berhasil menambahkan: ${book.title}`);
    } catch(e) { console.error(e); showToast(`${file.name}: ${e.message||"Gagal diproses."}`); }
    finally { busy(false); }
  }
  renderLibrary();
}
function showView(name) { ["libraryView","detailView","readerView"].forEach(id=>$(id).classList.toggle("hidden",id!==name)); window.scrollTo(0,0); }
function openDetail(id) {
  activeBook=books.find(b=>b.id===id); if(!activeBook)return;
  $("detailTitle").textContent=activeBook.title;$("detailAuthor").textContent=activeBook.author;
  $("detailDescription").textContent=activeBook.description;
  $("detailCover").innerHTML="";
  if(activeBook.coverData){const img=document.createElement("img");img.src=activeBook.coverData;img.alt="Cover "+activeBook.title;$("detailCover").append(img);}
  else $("detailCover").textContent=activeBook.title;
  $("detailTags").innerHTML="";
  [activeBook.language,activeBook.publisher,...(activeBook.subjects||[])].filter(Boolean).slice(0,8).forEach(t=>{const s=document.createElement("span");s.className="tag";s.textContent=t;$("detailTags").append(s);});
  $("chapterCount").textContent=`${activeBook.chapters.length} chapter`;
  $("chapterList").innerHTML="";
  activeBook.chapters.forEach((c,i)=>{const row=document.createElement("div");row.className="chapter-item";const n=document.createElement("span");n.className="chapter-num";n.textContent=String(i+1).padStart(3,"0");const t=document.createElement("span");t.className="chapter-name";t.textContent=c.title;row.append(n,t);row.addEventListener("click",()=>openReader(i));$("chapterList").append(row);});
  showView("detailView");
}
function openReader(index=0) {
  if(!activeBook)return;
  activeChapter=Math.max(0,Math.min(index,activeBook.chapters.length-1));
  $("readerBookTitle").textContent=activeBook.title;
  $("readerChapterCount").textContent=activeBook.chapters.length;
  $("readerChapterList").innerHTML="";
  activeBook.chapters.forEach((c,i)=>{const b=document.createElement("button");b.className="reader-chapter"+(i===activeChapter?" active":"");b.textContent=`${i+1}. ${c.title}`;b.addEventListener("click",()=>loadChapter(i));$("readerChapterList").append(b);});
  showView("readerView");loadChapter(activeChapter);
}
function safeChapterHTML(raw) {
  const doc=new DOMParser().parseFromString(raw,"text/html");
  doc.querySelectorAll("script,iframe,object,embed,form,link,meta,base").forEach(n=>n.remove());
  doc.querySelectorAll("*").forEach(el=>[...el.attributes].forEach(a=>{if(/^on/i.test(a.name)||((a.name==="href"||a.name==="src")&&/^\s*javascript:/i.test(a.value)))el.removeAttribute(a.name);}));
  return doc.body.innerHTML;
}
function loadChapter(index) {
  if(!activeBook)return;
  activeChapter=Math.max(0,Math.min(index,activeBook.chapters.length-1));
  const chapter=activeBook.chapters[activeChapter];
  $("readerChapterList").querySelectorAll(".reader-chapter").forEach((b,i)=>b.classList.toggle("active",i===activeChapter));
  $("readerContent").innerHTML="";
  if(activeMode==="text") {
    const wrap=document.createElement("div");wrap.className="text-chapter";
    const title=document.createElement("h2");title.textContent=chapter.title;wrap.append(title);
    const body=document.createElement("div");body.innerHTML=safeChapterHTML(chapter.content);wrap.append(body);
    $("readerContent").append(wrap);
  } else {
    // Render chapter XHTML inside a sandboxed frame to preserve the EPUB document's own layout.
    const frame=document.createElement("iframe");frame.setAttribute("sandbox","");frame.title=chapter.title;
    const safe=safeChapterHTML(chapter.content);
    frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;line-height:1.85;color:#292929;background:#fff;max-width:760px;margin:0 auto;padding:34px 24px;font-size:${fontSize}px}img{max-width:100%;height:auto}p{margin:0 0 1.2em}h1,h2,h3{text-align:center;line-height:1.4}a{color:#555}</style></head><body>${safe}</body></html>`;
    $("readerContent").append(frame);
  }
  $("prevChapter").disabled=activeChapter===0;$("nextChapter").disabled=activeChapter===activeBook.chapters.length-1;
  $("readerContent").scrollTop=0;
}
function setMode(mode) { activeMode=mode;document.querySelectorAll(".mode-button").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));loadChapter(activeChapter); }
function exportTxt() {
  if(!activeBook)return;
  const content=activeBook.chapters.map((c,i)=>`${c.title}\n\n${c.plain}\n\n${"=".repeat(35)}\n`).join("\n");
  const blob=new Blob([`\uFEFF${activeBook.title}\n${activeBook.author}\n\n${content}`],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=(activeBook.title||"novel").replace(/[\\/:*?"<>|]/g,"_")+".txt";a.click();URL.revokeObjectURL(url);
}
async function deleteActive() {
  if(!activeBook||!confirm(`Hapus "${activeBook.title}" dari perpustakaan browser ini?`))return;
  await dbDelete(activeBook.id);books=books.filter(b=>b.id!==activeBook.id);activeBook=null;renderLibrary();showView("libraryView");showToast("Novel dihapus dari rak.");
}

$("fileInput").addEventListener("change",e=>{importFiles([...e.target.files]);e.target.value="";});
$("emptyFileInput").addEventListener("change",e=>{importFiles([...e.target.files]);e.target.value="";});
$("addTopBtn").addEventListener("click",()=>$("fileInput").click());
$("searchInput").addEventListener("input",renderLibrary);
$("homeLink").addEventListener("click",e=>{e.preventDefault();showView("libraryView");});
$("backBtn").addEventListener("click",()=>showView("libraryView"));
$("readerBackBtn").addEventListener("click",()=>showView("detailView"));
$("readFirstBtn").addEventListener("click",()=>openReader(0));
$("exportBtn").addEventListener("click",exportTxt);
$("deleteBtn").addEventListener("click",deleteActive);
$("prevChapter").addEventListener("click",()=>loadChapter(activeChapter-1));
$("nextChapter").addEventListener("click",()=>loadChapter(activeChapter+1));
document.querySelectorAll(".mode-button").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
$("fontUp").addEventListener("click",()=>{fontSize=Math.min(26,fontSize+1);loadChapter(activeChapter);});
$("fontDown").addEventListener("click",()=>{fontSize=Math.max(13,fontSize-1);loadChapter(activeChapter);});

(async function init(){
  try { db=await openDB();books=await dbGetAll();books.sort((a,b)=>b.createdAt-a.createdAt);renderLibrary(); }
  catch(e){console.error(e);showToast("Browser tidak mengizinkan IndexedDB. Coba browser lain atau mode normal.");}
})();
