const Publisher=(()=>{
const $=s=>document.querySelector(s),tick=()=>new Promise(r=>setTimeout(r));
const nid=b=>'n'+b.id.replace(/-/g,'').slice(0,14);
async function api(path,opt={}){const key=localStorage.getItem('epl-admin');
 if(!key)throw new Error('Admin API key belum diisi (tombol ⚙ di dashboard).');
 let r;try{r=await fetch('/api'+path,{...opt,headers:{...(opt.headers||{}),authorization:'Bearer '+key}})}catch{throw new Error('Tidak bisa menghubungi server. Pastikan Worker sudah di-deploy dan Anda online.')}
 if(!r.ok){let m=r.statusText;try{m=(await r.json()).error||m}catch{}throw new Error(r.status===401?'Admin API key salah.':`${r.status} ${m}`)}return r}
async function listPublished(){try{const r=await fetch('/api/novels?size=1000');return r.ok?(await r.json()).items||[]:[]}catch{return[]}}
async function publish(book,onP){
 const id=nid(book);onP('Memvalidasi EPUB & metadata…');
 const[blob,chs]=await Promise.all([DB.getFile(book.id),DB.getChapters(book.id)]);
 if(!blob||!chs||!chs.length)throw new Error('Data EPUB lokal tidak lengkap.');
 if(!book.title||!book.title.trim())throw new Error('Judul novel kosong.');
 const zip=await JSZip.loadAsync(blob),bad=chs.filter(c=>!EpubParser.findFile(zip,c.href));
 if(bad.length)throw new Error(`${bad.length} chapter tidak ditemukan di EPUB (mis. ${bad[0].href}).`);
 await api('/admin/ping');
 const imgs=new Map();let batch=[],size=0;
 const flush=async()=>{if(!batch.length)return;await api(`/admin/novel/${id}/chapters`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chapters:batch})});batch=[];size=0};
 for(let i=0;i<chs.length;i++){
  const html=await AssetResolver.exportChapter(zip,chs[i].href,`/asset/${id}/`,imgs);
  batch.push({n:i+1,html});size+=html.length;
  if(size>1.2e6||batch.length>=40)await flush();
  if(i%20===0){onP(`Mengunggah chapter ${i+1}/${chs.length}…`);await tick()}}
 await flush();
 let k=0;for(const[name,path]of imgs){k++;onP(`Mengunggah gambar ${k}/${imgs.size}…`);
  const f=EpubParser.findFile(zip,path);if(!f)continue;
  const ext=name.split('.').pop(),type={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml'}[ext];
  if(!type)continue;try{await api(`/admin/novel/${id}/asset/${name}`,{method:'PUT',headers:{'content-type':type},body:new Blob([await f.async('arraybuffer')],{type})})}catch(e){if(/413/.test(e.message))continue;throw e}}
 let hasCover=false;
 if(book.cover&&/^image\/(jpeg|png|gif|webp)$/.test(book.cover.type)){onP('Mengunggah cover…');await api(`/admin/novel/${id}/asset/cover`,{method:'PUT',headers:{'content-type':book.cover.type},body:book.cover});hasCover=true}
 onP('Menyimpan metadata…');
 await api(`/admin/novel/${id}/commit`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:book.title,author:book.author,description:book.description||'',hasCover,chapters:chs.map(c=>({title:c.title}))})})}
const unpublish=b=>api(`/admin/novel/${nid(b)}`,{method:'DELETE'});
function bindSettings(){const d=$('#cfg');
 $('#setBtn').onclick=()=>{$('#cKey').value=localStorage.getItem('epl-admin')||'';$('#cUrl').value=location.origin+'/source.lua';$('#cMsg').textContent='';d.showModal()};
 $('#cClose').onclick=()=>d.close();
 $('#cSave').onclick=async()=>{const k=$('#cKey').value.trim();if(!k){localStorage.removeItem('epl-admin');$('#cMsg').textContent='Key dihapus dari browser ini.';return}
  localStorage.setItem('epl-admin',k);$('#cMsg').textContent='Menguji…';try{await api('/admin/ping');$('#cMsg').textContent='Key valid ✓'}catch(e){$('#cMsg').textContent='Gagal: '+e.message}};
 $('#cCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('#cUrl').value);$('#cMsg').textContent='URL disalin.'}catch{$('#cUrl').select();$('#cMsg').textContent='Salin manual dari kolom di atas.'}}}
return{nid,publish,unpublish,listPublished,bindSettings}})();
