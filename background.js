const allowed = /^https:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/(?:\d+\/\d+|@me(?:\/|$))/i;
async function activeTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!allowed.test(tab.url||''))throw Error('กรุณาเปิดแท็บ Discord ใน Edge/Chrome ก่อนกดเริ่ม');return tab;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function page(tabId,action,data={}){const results=await chrome.scripting.executeScript({target:{tabId},func:pageAction,args:[action,data]});return results?.[0]?.result||{ok:false,message:'ไม่พบผลลัพธ์'};}
async function poll(tabId,action,timeout=9000){const end=Date.now()+timeout;while(Date.now()<end){const r=await page(tabId,action);if(r.ok)return r;await pause(250);}return {ok:false,message:action==='form-open'?'รอเปิดฟอร์มเกินเวลา กรุณาลองใหม่':'ฟอร์มยังไม่ปิดหรือยังมีข้อผิดพลาด โปรดตรวจสอบก่อนส่งซ้ำ'};}
async function execute(action,data={},fixedTabId=null){const id=fixedTabId ?? (await activeTab()).id;
 if(action==='activity'){
  // After navigation Discord can update the URL before the next channel's messages render.
  // Wait for the target channel's activity button rather than failing immediately.
  const deadline=Date.now()+18000;
  let last='กำลังรอปุ่มส่งหลักฐานกิจกรรมในห้องใหม่';
  while(Date.now()<deadline){
   const existing=await page(id,'form-open').catch(()=>({ok:false}));if(existing.ok)return {ok:true,message:'ฟอร์มเปิดอยู่แล้ว'};
   const ready=await page(id,'activity-ready').catch(e=>({ok:false,message:e.message}));
   if(!ready.ok){last=ready.message||last;await pause(250);continue;}
   const clicked=await page(id,'activity').catch(e=>({ok:false,message:e.message}));
   if(!clicked.ok){last=clicked.message||last;await pause(250);continue;}
   const opened=await poll(id,'form-open',3000).catch(e=>({ok:false,message:e.message}));
   if(opened.ok)return {ok:true,message:'เปิดฟอร์มสำเร็จ'};
   last='คลิกเปิดฟอร์มแล้ว แต่ฟอร์มยังไม่ปรากฏ';
   await pause(350);
  }
  return {ok:false,message:last+' (รอห้องใหม่สูงสุด 18 วินาที)'};
 }
 if(action==='submit'){
  // The click is not an acknowledgement. Do not block on the bot's thinking state.
  return page(id,'submit');
 }
 if(action==='close-confirmed-form'){
  // The Discord modal may stay visible even after its submission was dispatched.
  const r=await page(id,'close-confirmed-form');if(!r.ok)return r;
  const closed=await poll(id,'form-closed',4500);
  return closed.ok?{ok:true,message:'ปิดฟอร์มแล้ว'}:{ok:false,message:'ฟอร์มยังไม่ปิด กรุณาตรวจสอบด้วยตนเอง'};
 }
 if(action==='next'){
  const target=data.targetId?{ok:true,targetId:data.targetId,targetPath:data.targetPath}:await page(id,'next-target');
  if(!target.ok)return target;
  for(let attempt=0;attempt<3;attempt++){
   const current=await page(id,'location').catch(()=>({}));
   if(current.path===target.targetPath)return {ok:true,targetId:target.targetId,message:'ยืนยันห้องถัดไปแล้ว'};
   const click=await page(id,'go-target',{targetId:target.targetId}).catch(e=>({ok:false,message:e.message}));
   if(!click.ok)return click;
   const deadline=Date.now()+4500;
   while(Date.now()<deadline){
    const loc=await page(id,'location').catch(()=>({}));
    if(loc.path===target.targetPath)return {ok:true,targetId:target.targetId,message:'ยืนยันการเปลี่ยนห้องแล้ว'};
    await pause(250);
   }
  }
  return {ok:false,message:'ไม่สามารถยืนยันห้องถัดไปได้หลังลอง 3 ครั้ง (ไม่ได้กดส่งซ้ำ)'};
 }
 return page(id,action,data);
}
function pageAction(action,data){
 const norm=s=>(s||'').replace(/\s+/g,'').trim();
 const visible=e=>!!(e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
 const usable=e=>visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
 const buttons=()=>[...document.querySelectorAll('button,[role="button"]')].filter(usable);
 // Match acknowledgement inside individual Discord chat messages, not the whole chat container.
 const ackText='ส่งหลักฐานเข้าห้องตรวจสอบแล้ว';
 const ackMessages=()=>{
  // Discord renders chat message body and author in different descendants.
  // Only examine individual message rows, never the entire message list.
  const nodes=[...document.querySelectorAll('[id^="chat-messages-"],[data-list-item-id^="chat-messages-"]')];
  const candidates=nodes.filter(e=>visible(e)&&(e.innerText||'').includes(ackText));
  const innermost=candidates.filter(e=>!candidates.some(other=>other!==e&&e.contains(other)));
  return innermost.map(e=>({node:e,id:(e.closest('[data-list-item-id^="chat-messages-"]')?.getAttribute('data-list-item-id')||e.closest('[id^="chat-messages-"]')?.id||e.id||'').replace(/^(chat-messages-)/,''),text:e.innerText||''}));
 };
 const ackIds=()=>[...new Set(ackMessages().map(x=>x.id).filter(Boolean))];
 if(action==='submission-progress'){
  const roots=[...document.querySelectorAll('[role="dialog"],form')].filter(visible);
  const stillOpen=roots.some(root=>[...root.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]),textarea')].filter(usable).length>=4);
  if(!stillOpen)return {ok:true,message:'ฟอร์มปิดหลังส่งแล้ว'};
  const messageNodes=[...document.querySelectorAll('[id^="chat-messages-"],[data-list-item-id^="chat-messages-"]')].filter(visible);
  const thinking=messageNodes.some(el=>/กำลังคิด|ส่งหลักฐานเข้าห้องตรวจสอบแล้ว/i.test(el.innerText||''));
  return {ok:thinking,message:thinking?'บอตกำลังคิด':'ยังไม่เห็นสถานะการประมวลผล'};
 }
 if(action==='pinned-list'||action==='first-pinned-channel'||action==='next-target'||action==='go-target'){
  // Use visible channel links within the sidebar, independent of Discord's locale.
  const labels=['pinnedchannels','ช่องที่ปักหมุดแล้ว'];
  const isPinned=t=>labels.some(x=>norm(t).toLowerCase()===x);
  const channelRe=/^\/channels\/(\d+)\/(\d+)(?:[/?#]|$)/;
  const headings=[];
  for(const el of document.querySelectorAll('span,div,h2,h3,button,[role="heading"]')){
   if(!visible(el)||!isPinned(el.textContent))continue;
   if([...el.children].some(c=>isPinned(c.textContent)))continue;
   headings.push(el);
  }
  for(const heading of headings){
   // Find the smallest visible ancestor containing multiple channel links.
   let root=heading.parentElement;
   for(let depth=0;depth<9&&root;depth++,root=root.parentElement){
    const links=[...root.querySelectorAll('a[href*="/channels/"]')].filter(visible);
    if(links.length>=2)break;
   }
   if(!root)continue;
   const all=[...root.querySelectorAll('a[href*="/channels/"]')].filter(visible);
   const guild=(location.pathname.match(/^\/channels\/(\d+)\//)||[])[1];
   const found=[];const seen=new Set();
   for(const link of all){
    if(!(heading.compareDocumentPosition(link)&Node.DOCUMENT_POSITION_FOLLOWING))continue;
    const href=link.getAttribute('href')||'';const m=href.match(channelRe);
    if(!m||m[1]!==guild||seen.has(m[2]))continue;
    // Stop at the next visible category header (if present).
    const between=[...root.querySelectorAll('h2,h3,[role="heading"]')].filter(visible);
    if(between.some(h=>(heading.compareDocumentPosition(h)&Node.DOCUMENT_POSITION_FOLLOWING)&&
      (h.compareDocumentPosition(link)&Node.DOCUMENT_POSITION_FOLLOWING)&&!heading.contains(h)))break;
    seen.add(m[2]);found.push({id:m[2],href:href.split(/[?#]/)[0],link});
   }
   if(!found.length)continue;
   if(action==='pinned-list')return {ok:true,channels:found.map(x=>({id:x.id,href:x.href}))};
   if(action==='next-target'){
    const current=(location.pathname.match(/^\/channels\/\d+\/(\d+)/)||[])[1];
    const index=found.findIndex(x=>x.id===current);
    if(index<0)return {ok:false,message:'ห้องปัจจุบันไม่ได้อยู่ในรายการปักหมุด'};
    if(index===found.length-1)return {ok:false,message:'ห้องปัจจุบันเป็นห้องสุดท้ายในรายการปักหมุด'};
    return {ok:true,targetId:found[index+1].id,targetPath:found[index+1].href};
   }
   const target=action==='go-target'?found.find(x=>x.id===data.targetId):found[0];
   if(!target)return {ok:false,message:'ไม่พบห้องเป้าหมายในรายการปักหมุด'};
   if(location.pathname===target.href)return {ok:true,targetPath:target.href,targetId:target.id,message:'อยู่ในห้องเป้าหมายแล้ว'};
   target.link.click();return {ok:true,targetPath:target.href,targetId:target.id,message:'คลิกห้องเป้าหมายแล้ว'};
  }
  return {ok:false,message:headings.length?'พบหัวข้อปักหมุด แต่ไม่พบลิงก์ห้องที่ใช้ได้':'ไม่พบหัวข้อ Pinned Channels / ช่องที่ปักหมุดแล้ว'};
 }
 if(action==='location')return {ok:true,path:location.pathname};
 if(action==='ack-snapshot')return {ok:true,ids:ackIds(),count:ackMessages().length};
 if(action==='ack-new'){
  const prior=new Set(data.before||[]);
  const matches=ackMessages();
  const fresh=matches.some(e=>e.id&&!prior.has(e.id));
  return {ok:fresh,message:fresh?'พบข้อความยืนยันใหม่':'ยังไม่พบข้อความยืนยันใหม่',count:matches.length};
 }
 if(action==='form-open'||action==='form-closed'){const roots=[...document.querySelectorAll('[role="dialog"],form')].filter(visible);const form=roots.some(root=>[...root.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]),textarea')].filter(usable).length>=4);return {ok:action==='form-open'?form:!form,message:form?'ฟอร์มเปิดอยู่':'ไม่พบฟอร์ม'};}
 if(action==='close-confirmed-form'){
  const roots=[...document.querySelectorAll('[role="dialog"],form')].filter(visible);
  const root=roots.find(el=>[...el.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]),textarea')].filter(usable).length>=4);
  if(!root)return {ok:true,message:'ฟอร์มปิดอยู่แล้ว'};
  const dialog=root.matches('[role="dialog"]')?root:root.closest('[role="dialog"]')||root;
  const controls=[...dialog.querySelectorAll('button,[role="button"]')].filter(usable);
  const close=controls.find(el=>/^(ปิด|close|ปิดหน้าต่าง)$/i.test((el.getAttribute('aria-label')||el.getAttribute('title')||'').trim()))
   ||controls.find(el=>/^(×|✕|✖|x)$/i.test((el.innerText||el.textContent||'').trim()))
   ||controls.find(el=>el.querySelector('svg path[d^="M18 6L6 18"],svg[aria-label="Close"]'))
   ||controls.find(el=>/close|dismiss|ปิด/i.test([el.getAttribute('data-testid'),el.getAttribute('aria-label')].join(' ')))
   ||controls.find(el=>el.querySelector('svg')&&!((el.innerText||'').trim())&&el.getBoundingClientRect().top<dialog.getBoundingClientRect().top+90&&el.getBoundingClientRect().left>dialog.getBoundingClientRect().right-110);
  if(!close)return {ok:false,message:'หาปุ่ม X ของฟอร์มไม่พบ (ไม่กดส่งซ้ำ)'};
  close.click();return {ok:true,message:'กด X ปิดฟอร์มที่ค้างแล้ว'};
 }
 if(action==='activity-ready'){
  const targets=buttons().filter(e=>norm([e.innerText,e.textContent,e.getAttribute('aria-label')].join(' ')).includes('ส่งหลักฐานกิจกรรม'));
  return {ok:targets.length>0,message:targets.length?'พบปุ่มกิจกรรมแล้ว':'Discord ยังโหลดข้อความหรือปุ่มกิจกรรมไม่เสร็จ'};
 }
 if(action==='activity'){
  const targets=buttons().filter(e=>norm([e.innerText,e.textContent,e.getAttribute('aria-label')].join(' ')).includes('ส่งหลักฐานกิจกรรม'));
  if(!targets.length)return {ok:false,message:'ไม่พบปุ่มส่งหลักฐานกิจกรรมในห้องนี้'};
  targets.at(-1).click();return {ok:true,message:'กดปุ่มส่งหลักฐานกิจกรรมแล้ว'};
 }
 if(action==='next'){
  const m=location.pathname.match(/^\/channels\/(\d+)\/(\d+)/);if(!m)return {ok:false,message:'ไม่พบห้องปัจจุบัน'};
  const [_,guild,current]=m;const seen=new Set();const entries=[];
  for(const a of document.querySelectorAll('a[href]')){
   if(!visible(a))continue;const hit=(a.getAttribute('href')||'').match(/^\/channels\/(\d+)\/(\d+)(?:[/?#]|$)/);
   if(!hit||hit[1]!==guild||seen.has(hit[2]))continue;
   if(!a.closest('nav,[role="navigation"],[class*="sidebar"],[class*="channel"]'))continue;
   seen.add(hit[2]);entries.push({id:hit[2],a});
  }
  const idx=entries.findIndex(x=>x.id===current);
  if(idx<0)return {ok:false,message:'ไม่พบห้องปัจจุบันในแถบซ้าย โปรดเลื่อนให้เห็นห้องนั้น'};
  if(idx===entries.length-1)return {ok:false,message:'ไม่พบห้องถัดไปที่แสดงอยู่'};
  const target=entries[idx+1];target.a.click();return {ok:true,message:'เปลี่ยนห้อง: '+(target.a.innerText||target.id).trim(),targetId:target.id};
 }
 if(action==='fill'){
  const root=[...document.querySelectorAll('[role="dialog"],form')].filter(visible).at(-1);
  if(!root)return {ok:false,message:'ไม่พบฟอร์ม Discord กรุณากดเปิดฟอร์มก่อน'};
  const inputs=[...root.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]),textarea')].filter(usable);
  if(inputs.length<4)return {ok:false,message:`พบช่องกรอก ${inputs.length} ช่อง ต้องมีอย่างน้อย 4 ช่อง`};
  const values=data.values||[];if(values.length!==4)return {ok:false,message:'ข้อมูลไม่ครบ 4 ช่อง'};
  for(let i=0;i<4;i++){
   const el=inputs[i];const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
   const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(el,String(values[i]));else el.value=String(values[i]);
   el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  if(inputs.slice(0,4).some((el,i)=>el.value!==String(values[i])))return {ok:false,message:'ตรวจสอบค่าที่กรอกไม่ตรง กรุณาตรวจสอบฟอร์ม'};
  return {ok:true,message:'กรอกครบ 4 ช่องแล้ว โปรดตรวจสอบก่อนส่ง'};
 }
 if(action==='submit'){
  const root=[...document.querySelectorAll('[role="dialog"],form')].filter(visible).at(-1);
  if(!root)return {ok:false,message:'ไม่พบฟอร์ม'};
  const candidates=[...root.querySelectorAll('button,[role="button"]')].filter(usable);
  const target=candidates.find(e=>/^(ส่ง|submit|ยืนยัน|ส่งข้อมูล)$/i.test((e.innerText||e.textContent||'').trim()));
  if(!target)return {ok:false,message:'ไม่พบปุ่มส่งที่ระบุได้อย่างปลอดภัย โปรดกดส่งเอง'};
  target.click();return {ok:true,message:'คลิกส่งแล้ว (ยังไม่ยืนยันว่า Discord รับสำเร็จ)'};
 }
 return {ok:false,message:'คำสั่งไม่ถูกต้อง'};
}

// Background batch coordinator. State is persisted before each irreversible step.
const BATCH_KEY='backgroundBatch';
let batchBusy=false;
const rowKey=r=>`${r.group}\t${r.round}`;
async function batchRead(){return (await chrome.storage.local.get(BATCH_KEY))[BATCH_KEY]||null;}
async function batchWrite(patch){const old=await batchRead();if(!old)return null;const updated={...old,...patch,updatedAt:Date.now()};await chrome.storage.local.set({[BATCH_KEY]:updated,batchProgress:{message:updated.message,phase:updated.status,step:updated.step,round:updated.queue?.[updated.index]?.round,time:new Date().toLocaleString('th-TH')}});return updated;}
async function batchFail(message){const b=await batchRead();if(!b||b.status!=='running')return;await batchWrite({status:'error',message:'หยุดทำงาน: '+message,failedAt:Date.now()});await chrome.alarms.clear('evidence-batch-watch');}
async function startBatch(data){
 const old=await batchRead();if(old?.status==='running')return {ok:false,message:'มีงานต่อเนื่องกำลังทำอยู่แล้ว'};
 const tab=await activeTab();const {rows,used}=await chrome.storage.local.get(['rows','used']);
 const allTabs=!!data.allTabs;
 // Edge supports chrome.tabs; tabs from other Edge profiles are isolated.
 // Process the selected tab and all subsequent Discord tabs in this window.
 const windowTabs=allTabs?(await chrome.tabs.query({windowId:tab.windowId})).filter(t=>allowed.test(t.url||'')).sort((a,b)=>a.index-b.index):[tab];
 const startTabPosition=windowTabs.findIndex(t=>t.id===tab.id);
 const tabs=allTabs?[...windowTabs.slice(startTabPosition),...windowTabs.slice(0,startTabPosition)]:[tab];
 if(allTabs&&!tabs.length)return {ok:false,message:'ไม่พบแท็บ Discord ในหน้าต่าง Edge/Chrome นี้'};
 const list=Array.isArray(rows)?rows:[];const done=used||{};
 const group=String(data.group||'');const startIndex=Number(data.startIndex);
 const pending=list.map((r,i)=>({r,i})).filter(({r})=>r.group===group&&!done[rowKey(r)]).sort((a,b)=>(Number(a.r.round)||0)-(Number(b.r.round)||0));
 const startPos=pending.findIndex(x=>x.i===startIndex);
 if(startPos<0)return {ok:false,message:'รอบที่เลือกไม่ใช่รอบคงเหลือ กรุณาเลือกใหม่'};
 // Send only the selected group's remaining rounds. The next group is selection-only.
 const queue=pending.slice(startPos).map(({r})=>({
   group:r.group,round:r.round,steam:r.steam,codes:[...r.codes]
 }));
 if(!queue.length)return {ok:false,message:'ไม่มีข้อมูลให้ส่ง'};
 if(queue.some(r=>![r.steam,...r.codes].every(x=>String(x||'').trim())))return {ok:false,message:'มีแถวที่ข้อมูล 4 ช่องไม่ครบ'};
 await chrome.storage.local.set({[BATCH_KEY]:{status:'running',tabId:tab.id,group,queue,index:0,step:'open',allTabs,tabIds:tabs.map(t=>t.id),tabPosition:0,stopRequested:false,message:`เริ่มกลุ่ม ${group}: 0/${queue.length}`,updatedAt:Date.now()},batchProgress:{phase:'running',message:`เริ่มกลุ่ม ${group}: 0/${queue.length}`}});
 await chrome.alarms.create('evidence-batch-watch',{periodInMinutes:1});
 void driveBatch();return {ok:true,message:`เริ่มส่ง ${queue.length} รอบแล้ว • ตรวจสอบสถานะด้านบนได้`};
}
async function selectNextGroup(completedGroup){
 const state=await chrome.storage.local.get(['rows','used']);
 const all=Array.isArray(state.rows)?state.rows:[];
 const groups=[...new Set(all.map(r=>String(r.group||'')).filter(Boolean))];
 const pos=groups.indexOf(completedGroup);
 for(const g of groups.slice(pos+1)){
  const next=all.map((r,i)=>({r,i}))
   .filter(({r})=>r.group===g&&!(state.used||{})[rowKey(r)])
   .sort((a,b)=>(Number(a.r.round)||0)-(Number(b.r.round)||0))[0];
  if(next){
   await chrome.storage.local.set({selectedGroup:g,selectedRecord:String(next.i)});
   return `เลือกกลุ่ม ${g} รอบ ${next.r.round} ไว้แล้ว • รอการสลับแท็บและเลือกห้องแรกที่ปักหมุด แล้วกดเริ่มส่งต่อเนื่องเอง`;
  }
 }
 return 'ไม่มีกลุ่มถัดไปที่มีรอบค้างส่ง';
}
async function activateNextDiscordTab(finishedTabId){
 const current=await chrome.tabs.get(finishedTabId);
 const tabs=(await chrome.tabs.query({windowId:current.windowId})).sort((a,b)=>a.index-b.index);
 const eligible=tabs.filter(t=>/^https:\/\/(?:discord|ptb\.discord|canary\.discord)\.com\//i.test(t.url||''));
 const index=eligible.findIndex(t=>t.id===finishedTabId);
 if(index<0||eligible.length<2)return 'ไม่มีแท็บ Discord ถัดไปในหน้าต่าง Chrome นี้ • กรุณาเปลี่ยนแท็บเอง';
 const target=eligible[(index+1)%eligible.length];
 await chrome.tabs.update(target.id,{active:true});
 await chrome.windows.update(target.windowId,{focused:true});
 // Let the new tab's Discord sidebar render, then select the first pinned room.
 let last='ไม่พบหมวดช่องที่ปักหมุดแล้ว';
 for(let attempt=0;attempt<4;attempt++){
  await pause(300);
  try{
   const result=await page(target.id,'first-pinned-channel');
   if(result.ok){
    const until=Date.now()+2500;
    while(Date.now()<until){
     const loc=await page(target.id,'location');
     if(loc.path===result.targetPath)return 'สลับแท็บและเลือกห้องแรกที่ปักหมุดแล้ว • รอกดเริ่มเอง';
     await pause(350);
    }
    return 'สลับแท็บแล้ว แต่ยังยืนยันการเปิดห้องแรกไม่ได้ • รอกดเริ่มเอง';
   }
   last=result.message||last;
  }catch(e){last=e.message||last;}
 }
 return 'สลับแท็บแล้ว แต่'+last+' • กรุณาเลือกห้องเองก่อนกดเริ่ม';
}
async function finishCurrentGroup(b,completedCount){
 if(b.allTabs){
  const nextPosition=b.tabPosition+1;
  if(nextPosition>=b.tabIds.length){await batchWrite({index:completedCount,status:'done',message:'ส่งครบทุกแท็บ Discord ในโปรไฟล์ Edge นี้แล้ว • กรุณาเปลี่ยนโปรไฟล์เอง'});return;}
  const nextTabId=b.tabIds[nextPosition];
  const target=await chrome.tabs.get(nextTabId).catch(()=>null);
  if(!target||!allowed.test(target.url||''))throw Error('แท็บถัดไปไม่พร้อม กรุณาตรวจสอบก่อนเริ่มต่อ');
  const note=await selectNextGroup(b.group);
  const st=await chrome.storage.local.get(['selectedGroup','selectedRecord','rows','used']);
  const group=st.selectedGroup;
  if(!note.startsWith('เลือกกลุ่ม ')){await batchWrite({status:'done',message:'จบงาน: '+note});return;}
  const list=st.rows||[];
  const pending=list.map((r,i)=>({r,i})).filter(({r})=>r.group===group&&!(st.used||{})[rowKey(r)]).sort((a,b)=>(Number(a.r.round)||0)-(Number(b.r.round)||0));
  if(!pending.length){await batchWrite({status:'done',message:'ไม่มีกลุ่มถัดไปที่ยังไม่ส่ง • '+note});return;}
  if((await batchRead())?.status!=='running')return;
  await chrome.tabs.update(nextTabId,{active:true});
  await chrome.windows.update(target.windowId,{focused:true});
  // Bounded pinned-room selection: do not restart a long URL wait 50 times.
  let ready=false, lastPinnedError='ไม่พบห้องแรกที่ปักหมุด';
  for(let attempt=0;attempt<3&&!ready;attempt++){
   if((await batchRead())?.status!=='running')return;
   await batchWrite({message:`สลับแท็บแล้ว • กำลังเลือกห้องปักหมุด (ครั้งที่ ${attempt+1}/3)`});
   const found=await page(nextTabId,'first-pinned-channel').catch(e=>({ok:false,message:e.message}));
   if(!found.ok){lastPinnedError=found.message||lastPinnedError;await pause(450);continue;}
   const limit=Date.now()+3000;
   while(Date.now()<limit){
    if((await batchRead())?.status!=='running')return;
    const loc=await page(nextTabId,'location').catch(()=>({}));
    if(loc.path===found.targetPath){ready=true;break;}
    await pause(200);
   }
   if(!ready)lastPinnedError='คลิกห้องปักหมุดแล้ว แต่ URL ไม่เปลี่ยนตามที่คาด';
  }
  if(!ready)throw Error('สลับแท็บแล้ว แต่เลือกห้องปักหมุดไม่สำเร็จ: '+lastPinnedError+' • หยุดเพื่อป้องกันส่งผิดห้อง');
  const nextQueue=pending.map(({r})=>({group:r.group,round:r.round,steam:r.steam,codes:[...r.codes]}));
  if(nextQueue.some(r=>![r.steam,...r.codes].every(x=>String(x||'').trim())))throw Error('ข้อมูลกลุ่มถัดไปไม่ครบ 4 ช่อง');
  if((await batchRead())?.status!=='running')return;
  await batchWrite({tabId:nextTabId,group,queue:nextQueue,index:0,step:'open',tabPosition:nextPosition,message:`เริ่มกลุ่ม ${group} ในแท็บ ${nextPosition+1}/${b.tabIds.length}`});
  return;
 }

 const note=await selectNextGroup(b.group);
 // Stop automation before switching tabs; never start another group automatically.
 await batchWrite({index:completedCount,status:'done',message:`ส่งครบกลุ่ม ${b.group} ${b.queue.length} รอบ • ${note}`});
 let tabNote;
 try{tabNote=await activateNextDiscordTab(b.tabId);}catch(err){tabNote='สลับแท็บไม่สำเร็จ: '+err.message;}
 await batchWrite({message:`ส่งครบกลุ่ม ${b.group} • ${tabNote} • ${note}`});
}
async function driveBatch(){
 if(batchBusy)return;batchBusy=true;
 try{
  while(true){
   let b=await batchRead();if(!b||b.status!=='running')break;
   if(b.stopRequested){await batchWrite({status:'stopped',message:`หยุดตามคำสั่งหลังสำเร็จ ${b.index}/${b.queue.length} รอบ`});break;}
   const tab=await chrome.tabs.get(b.tabId).catch(()=>null);
   if(!tab||!allowed.test(tab.url||'')){await batchFail('ไม่พบแท็บ Discord เดิม หรือแท็บถูกปิด');break;}
   if(b.index>=b.queue.length){await finishCurrentGroup(b,b.index);if(b.allTabs&&(await batchRead())?.status==='running')continue;break;}
   const r=b.queue[b.index];const context=`กลุ่ม ${r.group} รอบ ${r.round}`;
   // Never automatically repeat a submission if the worker was interrupted while awaiting acknowledgement.
   if(b.step==='submit-pending'){await batchFail(`${context}: คำสั่งส่งอาจถูกดำเนินการแล้ว แต่การตรวจสอบถูกขัดจังหวะ โปรดตรวจสอบ Discord ด้วยตนเองก่อนทำต่อ`);break;}
   if(b.step==='open'){
    await batchWrite({message:`${context}: รอห้องใหม่พร้อม แล้วเปิดฟอร์ม (สูงสุด 25 วินาที)`});
    if((await batchRead())?.status!=='running')break;
    const res=await execute('activity',{},b.tabId);if(!res.ok)throw Error(`${context}: ${res.message}`);
    await batchWrite({step:'fill',message:`${context}: ฟอร์มเปิดแล้ว`});continue;
   }
   if(b.step==='fill'){
    await batchWrite({message:`${context}: กำลังกรอกข้อมูล`});
    if((await batchRead())?.status!=='running')break;
    const res=await execute('fill',{values:[r.steam,...r.codes]},b.tabId);if(!res.ok)throw Error(`${context}: ${res.message}`);
    await batchWrite({step:'submit'});continue;
   }
   if(b.step==='submit'){
    if((await batchRead())?.status!=='running')break;
    // Save ambiguous checkpoint BEFORE clicking submit; a suspended worker must not send twice.
    await batchWrite({step:'submit-pending',message:`${context}: กำลังคลิกส่ง (ไม่รอบอต และไม่กดซ้ำ)`});
    if((await batchRead())?.status!=='running')break;
    const res=await execute('submit',{},b.tabId);
    if(!res.ok)throw Error(`${context}: ${res.message}`);
    const stored=await chrome.storage.local.get(['used','rows']);const newUsed=stored.used||{};newUsed[rowKey(r)]=true;
    // Mark as dispatched, not bot-confirmed; used is the legacy progress flag.
    await chrome.storage.local.set({used:newUsed,selectedGroup:b.queue[b.index+1]?.group||r.group,selectedRecord:String((stored.rows||[]).findIndex(x=>x.group===b.queue[b.index+1]?.group&&x.round===b.queue[b.index+1]?.round))});
    await batchWrite({step:'close',message:`${context}: กดส่งแล้ว • กำลังปิดฟอร์มที่ค้าง (${b.index+1}/${b.queue.length})`});continue;
   }
   if(b.step==='close'){
    await batchWrite({message:`${context}: กดส่งแล้ว • รอประมวลผลก่อนปิดฟอร์ม`});
    await pause(2500);
    let progress={ok:false};
    for(let attempt=0;attempt<12;attempt++){
      progress=await page(b.tabId,'submission-progress');
      if(progress.ok)break;
      await pause(250);
    }
    if(!progress.ok)throw Error(`${context}: ยังไม่พบสถานะกำลังคิดและฟอร์มยังเปิดอยู่ จึงไม่ปิดฟอร์มก่อนเวลา`);
    const res=await execute('close-confirmed-form',{},b.tabId);
    if(!res.ok)throw Error(`${context}: ${res.message}`);
    await batchWrite({step:'next',message:`${context}: ปิดฟอร์มแล้ว • เตรียมเปลี่ยนห้อง`});continue;
   }
   if(b.step==='next'){
    if(b.index+1===b.queue.length){await finishCurrentGroup(b,b.index+1);if(b.allTabs&&(await batchRead())?.status==='running')continue;break;}
    await batchWrite({message:`${context}: กำลังเปลี่ยนห้อง`});
    if((await batchRead())?.status!=='running')break;
    const target=await page(b.tabId,'next-target');
    if(!target.ok)throw Error(`${context}: ${target.message}`);
    await batchWrite({step:'next-pending',nextTargetId:target.targetId,nextTargetPath:target.targetPath,message:`${context}: กำลังเปลี่ยนห้อง • บันทึกเป้าหมายไว้แล้ว`});continue;
   }
   if(b.step==='next-pending'){
    if((await batchRead())?.status!=='running')break;
    const res=await execute('next',{targetId:b.nextTargetId,targetPath:b.nextTargetPath},b.tabId);
    if(!res.ok)throw Error(`${context}: ${res.message}`);
    await batchWrite({index:b.index+1,step:'open',nextTargetId:null,nextTargetPath:null,message:`${context}: ยืนยันเปลี่ยนห้องแล้ว • ต่อรอบ ${b.queue[b.index+1].round}`});
    await pause(350);continue;
   }
   throw Error('สถานะงานไม่ถูกต้อง: '+b.step);
  }
 }catch(e){await batchFail(e.message||String(e));}
 finally{batchBusy=false;const b=await batchRead();if(b?.status!=='running')await chrome.alarms.clear('evidence-batch-watch');}
}
chrome.alarms.onAlarm.addListener(async alarm=>{
 if(alarm.name!=='evidence-batch-watch')return;
 const b=await batchRead();if(!b||b.status!=='running')return;
 // Worker may have been terminated during submission. Never retry that action blindly.
 if(b.step==='submit-pending'){await batchFail('งานถูกขัดจังหวะระหว่างรอผลการส่ง กรุณาตรวจสอบข้อความบอตก่อนเริ่มใหม่');return;}
 void driveBatch();
});
chrome.runtime.onStartup.addListener(async()=>{const b=await batchRead();if(b?.status==='running')await batchFail('Chrome เริ่มใหม่ระหว่างทำงาน กรุณาตรวจสอบรอบล่าสุดก่อนเริ่มใหม่');});
chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{if(msg?.type==='batch-start'){startBatch(msg.data||{}).then(reply).catch(e=>reply({ok:false,message:e.message}));return true;}if(msg?.type==='batch-stop'){batchWrite({stopRequested:true,message:'ได้รับคำสั่งหยุด จะหยุดหลังขั้นตอนปัจจุบัน'}).then(()=>reply({ok:true}));return true;}if(msg?.type==='batch-cancel-all'){batchRead().then(async b=>{if(b?.status==='running')await batchWrite({status:'cancelled',stopRequested:true,message:'ยกเลิกคำสั่งทั้งหมดแล้ว • หากอยู่ระหว่างคลิกส่ง กรุณาตรวจสอบรอบล่าสุด'});await chrome.alarms.clear('evidence-batch-watch');reply({ok:true});}).catch(e=>reply({ok:false,message:e.message}));return true;}if(msg?.type!=='run')return;execute(msg.action,msg.data).then(reply).catch(e=>reply({ok:false,message:e.message}));return true;});
chrome.commands.onCommand.addListener(async command=>{try{if(command==='click-activity')await execute('activity');if(command==='next-channel')await execute('next');}catch(e){console.warn(e.message);}});
