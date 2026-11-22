const Library=(()=>{
const $=s=>document.querySelector(s);let books=[],sort='imported',qs='';const urls=[];
const fmt=n=>n.toLocaleString('id-ID');
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
async function refresh(){books=await DB.allBooks();render()}
function render(){urls.splice(0).forEach(u=>URL.revokeObjectURL(u));
 const f=qs.toLowerCase(),list=books.filter(b=>(b.title+' '+b.author).toLowerCase().includes(f));
 list.sort(sort==='title'?(a,b)=>a.title.localeCompare(b.title):sort==='author'?(a,b)=>a.author.localeCompare(b.author):(a,b)=>b.importedAt-a.importedAt);
 $('#stat').textContent=`${fmt(books.length)} buku · ${fmt(books.reduce((s,b)=>s+b.chapterCount,0))} chapter`;
 $('#empty').hidden=books.length>0;const fr=document.createDocumentFragment();
 for(const b of list){const c=el('div','card'),cv=el('div','cov');
  if(b.cover){const u=URL.createObjectURL(b.cover);urls.push(u);const i=new Image();i.src=u;i.alt='';cv.append(i)}else cv.textContent=(b.title[0]||'?').toUpperCase();
  cv.onclick=()=>Reader.open(b.id).catch(e=>App.toast('Gagal membuka buku: '+e.message));
  const pct=b.lastIndex>=0?Math.round((b.lastIndex+1)/b.chapterCount*100):0,m=el('div','meta');
  const pg=el('div','pg'),bar=el('i');bar.style.width=pct+'%';pg.append(bar);
  m.append(el('b',null,b.title),el('span','muted',b.author),el('div','muted',`${fmt(b.chapterCount)} chapter · ${pct}%`),pg);
  const ac=el('div','acts'),i=el('button',null,'Info'),d=el('button',null,'Hapus');
  i.onclick=()=>{$('#infoText').textContent=`${b.title}\nPenulis: ${b.author}\nChapter: ${fmt(b.chapterCount)}\nFile: ${b.fileName} (${(b.size/1048576).toFixed(2)} MB)\nDiimpor: ${new Date(b.importedAt).toLocaleString('id-ID')}\nProgres: ${pct}%`;$('#info').showModal()};
  d.onclick=async()=>{if(confirm(`Hapus “${b.title}” dari perpustakaan? Tindakan ini tidak bisa dibatalkan.`)){try{await DB.deleteBook(b.id);await refresh()}catch(e){App.toast('Gagal menghapus: '+e.message)}}};
  ac.append(i,d);c.append(cv,m,ac);fr.append(c)}
 $('#grid').replaceChildren(fr)}
return{refresh,setSearch:v=>{qs=v;render()},setSort:v=>{sort=v;render()}}})();
