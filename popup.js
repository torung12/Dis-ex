const $=id=>document.getElementById(id);let rows=[],used={},running=false,stop=false;let currentGroup="",currentRecord="";
const status=s=>{ $('status').textContent=s; $('statusTop').textContent=s; };
const key=r=>`${r.group}\t${r.round}`;
const groups=()=>[...new Set(rows.map(r=>r.group))];
function parseCSV(text){let result=[],row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));result.push(row);row=[];field='';}else field+=c;}if(field||row.length){row.push(field.replace(/\r$/,''));result.push(row);}return result;}
const escapeCSV=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
async function save(){await chrome.storage.local.set({rows,used,selectedGroup:currentGroup,selectedRecord:currentRecord});}
async function saveSelection(){currentGroup=$('group').value;currentRecord=$('record').value;await chrome.storage.local.set({selectedGroup:currentGroup,selectedRecord:currentRecord});}
function advanceAfter(r){const ix=rows.findIndex(x=>x===r);const next=rows.map((x,i)=>({x,i})).filter(v=>v.x.group===r.group && !used[key(v.x)] && v.i!==ix).sort((a,b)=>(Number(a.x.round)||0)-(Number(b.x.round)||0))[0];render(r.group,next?next.i:ix);saveSelection();}
function selected(){return rows[Number($('record').value)]||null;}
function render(group=$('group').value,idx=null){const gs=groups();$('group').replaceChildren(...gs.map(g=>new Option(g,g)));if(!gs.length){$('group').add(new Option('ยังไม่มีข้อมูล',''));$('record').replaceChildren();$('counter').textContent='นำเข้า CSV หรือเพิ่มแถวเพื่อเริ่ม';$('edit').value='';return;}$('group').value=gs.includes(group)?group:gs[0];const current=$('group').value;$('record').replaceChildren(...rows.map((r,i)=>({r,i})).filter(x=>x.r.group===current).map(({r,i})=>new Option(`${used[key(r)]?'✓ ':'○ '}รอบ ${r.round}`,String(i))));if(idx!==null&&rows[idx]?.group===current)$('record').value=String(idx);else if(currentRecord&&rows[Number(currentRecord)]?.group===current)$('record').value=currentRecord;const total=rows.filter(r=>r.group===current);$('counter').textContent=`ทั้งหมด ${total.length} • เสร็จ ${total.filter(r=>used[key(r)]).length} • เหลือ ${total.filter(r=>!used[key(r)]).length}`;const r=selected();$('edit').value=r?[r.steam,...r.codes].join('\n'):'';}
function randomLink(s){if(!/^https?:\/\/(?:www\.)?facebook\.com\/groups\/[^/?#]+\/(?:permalink|pending_posts)\/\d+\/?(?:[?#].*)?$/i.test(s))throw Error('สุ่มได้เฉพาะลิงก์ Facebook /groups/.../permalink/ หรือ /pending_posts/ ที่มีตัวเลข');const digits=new Uint32Array(s.length);crypto.getRandomValues(digits);let i=0;let out=s.replace(/\d/g,()=>String(digits[i++]%10));if(out===s){const at=out.search(/\d/);if(at>=0)out=out.slice(0,at)+((Number(out[at])+1)%10)+out.slice(at+1);}return out;}
async function run(action,data={}){const result=await chrome.runtime.sendMessage({type:'run',action,data});if(!result?.ok)throw Error(result?.message||'ไม่สำเร็จ');status(result.message);return result;}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function progress(message,phase='running'){
 status(message);
 await chrome.storage.local.set({batchProgress:{message,phase,time:new Date().toLocaleString('th-TH')}});
}

async function executeRow(r,submit){await run('activity');await run('fill',{values:[r.steam,...r.codes]});if(!submit)return false;await run('submit');return true;}
$('group').onchange=async()=>{currentRecord='';render($('group').value);await saveSelection();};$('record').onchange=async()=>{render($('group').value,Number($('record').value));await saveSelection();};
$('activity').onclick=()=>run('activity').catch(e=>status(e.message));$('fill').onclick=()=>{const r=selected();if(!r)return status('กรุณาเลือกแถว');run('fill',{values:[r.steam,...r.codes]}).catch(e=>status(e.message));};$('submit').onclick=async()=>{const r=selected();if(!r)return status('กรุณาเลือกแถว');try{await run('submit');used[key(r)]=true;await save();advanceAfter(r);status(`บอตยืนยันแล้ว: กลุ่ม ${r.group} รอบ ${r.round} • เลือกรอบถัดไป`);}catch(e){status(e.message);}};$('next').onclick=()=>run('next').catch(e=>status(e.message));
$('mark').onclick=async()=>{const r=selected();if(!r)return;used[key(r)]=true;await save();advanceAfter(r);status('ทำเครื่องหมายเสร็จแล้ว • เลือกรอบถัดไป');};
$('reset').onclick=async()=>{const g=$('group').value;if(!confirm(`ล้างสถานะกลุ่ม ${g}?`))return;for(const r of rows)if(r.group===g)delete used[key(r)];await save();render(g);};
$('random').onclick=async()=>{try{const changes=rows.map(r=>({r,codes:r.codes.map(randomLink)}));if(!changes.length)throw Error('ยังไม่มีข้อมูล');if(!confirm(`สุ่มลิงก์ใหม่ ${changes.length*3} รายการในทุกกลุ่ม?`))return;for(const x of changes){x.r.codes=x.codes;delete used[key(x.r)];}currentGroup=rows[0].group;currentRecord=String(rows.findIndex(r=>r.group===currentGroup));await save();render(currentGroup,Number(currentRecord));status('สุ่มทุกกลุ่มแล้ว • กลับไปเลือกข้อมูลข้อแรก (ลิงก์จำลอง โปรดตรวจสอบก่อนส่ง)');}catch(e){status(e.message);}};
$('csv').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const parsed=parseCSV((await f.text()).replace(/^\uFEFF/,''));const imported=parsed.filter(c=>c.length>=6&&c[0].trim()&&!['กลุ่ม','group'].includes(c[0].trim().toLowerCase())).map(c=>({group:c[0].trim(),round:c[1].trim(),steam:c[2].trim(),codes:c.slice(3,6).map(x=>x.trim())}));if(!imported.length)throw Error('ไม่พบแถวข้อมูล CSV ที่ถูกต้อง');if(rows.length&&!confirm('แทนที่ข้อมูลปัจจุบันด้วยไฟล์ CSV?'))return;rows=imported;used={};await save();render(imported[0].group);await saveSelection();status(`นำเข้า ${rows.length} แถวแล้ว`);}catch(err){status(err.message);}};
$('export').onclick=()=>{const csv=[['กลุ่ม','รอบ','Steam ID','รหัส 1','รหัส 2','รหัส 3'],...rows.map(r=>[r.group,r.round,r.steam,...r.codes])].map(r=>r.map(escapeCSV).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='evidence_export.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('add').onclick=async()=>{const group=$('group').value||prompt('ชื่อกลุ่มใหม่','A');if(!group)return;const next=Math.max(0,...rows.filter(r=>r.group===group).map(r=>Number(r.round)||0))+1;rows.push({group,round:String(next),steam:'',codes:['','','']});await save();render(group,rows.length-1);status('เพิ่มแถวแล้ว กรุณากรอกข้อมูลและบันทึก');};
$('save').onclick=async()=>{const r=selected();if(!r)return;const lines=$('edit').value.split(/\r?\n/);if(lines.length!==4)return status('ต้องมี 4 บรรทัดพอดี');r.steam=lines[0].trim();r.codes=lines.slice(1).map(x=>x.trim());delete used[key(r)];await save();render(r.group,rows.indexOf(r));await saveSelection();status('บันทึกแถวแล้ว');};
$('stop').onclick=async()=>{const r=await chrome.runtime.sendMessage({type:'batch-stop'});status(r?.ok?'สั่งหยุดแล้ว กำลังรอขั้นตอนปัจจุบัน':'หยุดไม่ได้');};
$('cancelAll').onclick=async()=>{
 const r=await chrome.runtime.sendMessage({type:'batch-cancel-all'});
 status(r?.ok?'ยกเลิกงานต่อเนื่องทั้งหมดแล้ว • ตรวจสอบฟอร์มที่อาจกำลังส่งอยู่':r?.message||'ยกเลิกไม่สำเร็จ');
};
$('runAll').onclick=async()=>{
 if(!$('autoSubmit').checked)return status('กรุณาเปิดตัวเลือกส่งฟอร์มอัตโนมัติ');
 if(!confirm('ส่งต่อเนื่องจากแท็บ Discord ปัจจุบันไปยังแท็บถัดไปในหน้าต่าง Edge/Chrome เดียวกัน (ไม่ข้ามโปรไฟล์) และเลือกห้องปักหมุดแรกอัตโนมัติ?'))return;
 const r=await chrome.runtime.sendMessage({type:'batch-start',data:{group:$('group').value,startIndex:Number($('record').value),allTabs:true}});
 status(r?.message||'เริ่มงานไม่ได้');
};
$('run').onclick=async()=>{
 if(!$('autoSubmit').checked)return status('กรุณาเปิดตัวเลือกส่งฟอร์มอัตโนมัติ');
 const r=await chrome.runtime.sendMessage({type:'batch-start',data:{group:$('group').value,startIndex:Number($('record').value)}});
 status(r?.message||'เริ่มงานไม่ได้');
};
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area!=='local')return;
 if(changes.batchProgress){const p=changes.batchProgress.newValue||{};status((p.phase==='error'?'หยุด: ':p.phase==='running'?'กำลังทำงาน: ':'')+(p.message||''));}
 if(changes.used){used=changes.used.newValue||{};render(currentGroup);}
 if(changes.selectedGroup){currentGroup=changes.selectedGroup.newValue||'';render(currentGroup);}
 if(changes.selectedRecord){currentRecord=changes.selectedRecord.newValue||'';render(currentGroup,currentRecord!==''?Number(currentRecord):null);}
});
(async()=>{const state=await chrome.storage.local.get(['rows','used','selectedGroup','selectedRecord','batchProgress']);rows=Array.isArray(state.rows)?state.rows:[];used=state.used||{};currentGroup=state.selectedGroup||'';currentRecord=state.selectedRecord||'';render(currentGroup,currentRecord!==''?Number(currentRecord):null);if(state.batchProgress){const p=state.batchProgress;status((p.phase==='running'?'กำลังทำงานเบื้องหลัง: ':'สถานะล่าสุด: ')+p.message);}})();

// Database view shares the same in-memory rows and chrome.storage.local as the Lite workflow.
function showTab(which){const db=which==='db';$('actionView').classList.toggle('hidden',db);$('dbView').classList.toggle('hidden',!db);$('tabAction').classList.toggle('active',!db);$('tabDB').classList.toggle('active',db);if(db)renderDatabase();}
$('tabAction').onclick=()=>showTab('action');
$('tabDB').onclick=()=>showTab('db');
$('dbSearch').oninput=()=>renderDatabase();
$('openDB').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('database.html')});
function compactPopupValue(value){return String(value??'').replace(/^https?:\/\/(?:www\.)?facebook\.com\/groups\//i,'').replace(/^https?:\/\/(?:www\.)?steamcommunity\.com\//i,'');}
function renderDatabase(){
 const q=$('dbSearch').value.trim().toLocaleLowerCase();
 const visible=rows.map((r,i)=>({r,i})).filter(({r})=>[r.group,r.round,r.steam,...r.codes].some(v=>String(v||'').toLocaleLowerCase().includes(q)));
 $('dbSummary').textContent=`ทั้งหมด ${rows.length} แถว • เสร็จ ${rows.filter(r=>used[key(r)]).length} • คงเหลือ ${rows.filter(r=>!used[key(r)]).length} • พบ ${visible.length} แถว`;
 const body=$('dbBody');body.replaceChildren();
 for(const {r,i} of visible){const tr=document.createElement('tr');tr.className='pick';for(const value of [r.group,r.round,r.steam,...r.codes,used[key(r)]?'เสร็จ':'รอ']){const td=document.createElement('td');td.textContent=compactPopupValue(value);td.title=String(value??'');tr.appendChild(td);}tr.onclick=()=>{render(r.group,i);saveSelection();showTab('action');status(`เลือกกลุ่ม ${r.group} รอบ ${r.round} แล้ว`);};body.appendChild(tr);}
}
