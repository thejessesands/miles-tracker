import { adminDb } from './admin';
import { decrypt, encrypt } from './scan-crypto';
import { collectParts, extractBalances, extractMemberships, discoverPrograms, hasAccountActivity } from './parse';

const PAGE_SIZE = 25;
const SEARCH = 'newer_than:3y {balance points miles Avios membership "member number" "frequent flyer" "loyalty account" "welcome to"}';
type State = { user_id:string; refresh_token_encrypted:string; access_token_encrypted:string|null; access_expires_at:string|null; page_token:string|null; scanned_total:number; phase:string; last_scan_at:string|null; last_error:string|null; retry_after:string|null; started_at:string|null; };
const wait = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));

async function accessToken(state:State, db:ReturnType<typeof adminDb>) {
 if (state.access_token_encrypted && state.access_expires_at && Date.parse(state.access_expires_at) > Date.now()+120000) return decrypt(state.access_token_encrypted);
 const clientId=process.env.GOOGLE_CLIENT_ID, clientSecret=process.env.GOOGLE_CLIENT_SECRET;
 if (!clientId || !clientSecret) throw new Error('Google OAuth credentials are missing');
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:decrypt(state.refresh_token_encrypted),grant_type:'refresh_token'})});
 const result=await response.json(); if(!response.ok || !result.access_token) throw new Error('Google refresh failed; reconnect Google to renew access');
 const patch:Record<string,unknown>={access_token_encrypted:encrypt(result.access_token),access_expires_at:new Date(Date.now()+(result.expires_in||3600)*1000).toISOString()};
 if(result.refresh_token) patch.refresh_token_encrypted=encrypt(result.refresh_token);
 const {error}=await db.from('gmail_scan_state').update(patch).eq('user_id',state.user_id); if(error) throw error;
 return result.access_token as string;
}
async function gmail(url:string,token:string) {
 const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
 if(!r.ok){ const detail=await r.text(); const err=new Error(`Gmail ${r.status}: ${detail.slice(0,250)}`); (err as Error & {status?:number}).status=r.status; throw err; }
 return r.json();
}
export async function scanUser(userId:string) {
 const db=adminDb();
 const {data:state,error}=await db.from('gmail_scan_state').select('*').eq('user_id',userId).single(); if(error||!state) throw new Error('Scan not configured');
 const s=state as State;
 if(s.retry_after && Date.parse(s.retry_after)>Date.now()) return {status:'waiting',scanned:0};
 if(s.phase==='paused') return {status:'paused',scanned:0};
 const token=await accessToken(s,db);
 const incremental=s.phase==='current';
 // A small overlap makes incremental scans resilient to delayed messages and timestamp boundaries.
 const after= s.last_scan_at ? new Date(Date.parse(s.last_scan_at)-2*86400000) : new Date(Date.now()-3*365*86400000);
 const query=incremental ? `after:${Math.floor(after.getTime()/1000)} {balance points miles Avios membership "member number" "frequent flyer" "loyalty account" "welcome to"}` : SEARCH;
 const params=new URLSearchParams({q:query,maxResults:String(PAGE_SIZE)});
 if(s.page_token) params.set('pageToken',s.page_token);
 const listing=await gmail(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,token);
 const ids:(string)[]=(listing.messages||[]).map((m:{id:string})=>m.id);
 let processed=0,updated=0,discovered=0;
 // Save each message ID for idempotency and never advance a page on partial failure.
 for(const id of ids){
   const {data:seen}=await db.from('gmail_processed_messages').select('message_id').eq('user_id',userId).eq('message_id',id).maybeSingle();
   if(seen){processed++;continue;}
   const message=await gmail(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,token);
   const subject=(message.payload?.headers||[]).find((h:{name:string})=>h.name.toLowerCase()==='subject')?.value||'';
   const body=collectParts(message.payload)||message.snippet||'';
   const timestamp=Number(message.internalDate||0); const when=new Date(timestamp).toISOString();
   const active=hasAccountActivity(subject,body);
   if(active){
    const memberships=extractMemberships(subject,body);
    for(const m of memberships){
      const {data:existing}=await db.from('balances').select('membership_number').eq('user_id',userId).eq('program_id',m.program_id).maybeSingle();
      if(existing && !existing.membership_number) { const {error:e}=await db.from('balances').update({membership_number:m.membership_number}).eq('user_id',userId).eq('program_id',m.program_id);if(e)throw e; }
      else if(!existing) { const {error:e}=await db.from('balances').insert({user_id:userId,program_id:m.program_id,balance:0,source:'gmail',verified_at:null,evidence:null,membership_number:m.membership_number});if(e)throw e; }
    }
    for(const b of extractBalances(subject,body)){
      const {data:old}=await db.from('balances').select('verified_at,membership_number').eq('user_id',userId).eq('program_id',b.program_id).maybeSingle();
      if(old?.verified_at && Date.parse(old.verified_at)>timestamp)continue;
      const number=old?.membership_number||memberships.find(m=>m.program_id===b.program_id)?.membership_number||null;
      const {error:e}=await db.from('balances').upsert({user_id:userId,program_id:b.program_id,balance:b.balance,source:'gmail',verified_at:when,evidence:`Gmail message ${id}`,membership_number:number},{onConflict:'user_id,program_id'});if(e)throw e; updated++;
    }
    for(const d of discoverPrograms(subject,body)){
      const {data:old}=await db.from('discovered_programs').select('id,membership_number').eq('user_id',userId).eq('program_name',d.program_name).maybeSingle();
      if(!old){const {error:e}=await db.from('discovered_programs').insert({user_id:userId,program_name:d.program_name,category:d.category,membership_number:d.membership_number,evidence:`Gmail message ${id}`,confirmed:false});if(e)throw e;discovered++;}
      else if(!old.membership_number && d.membership_number){const {error:e}=await db.from('discovered_programs').update({membership_number:d.membership_number}).eq('id',old.id);if(e)throw e;}
    }
   }
   const {error:markError}=await db.from('gmail_processed_messages').upsert({user_id:userId,message_id:id,processed_at:new Date().toISOString()},{onConflict:'user_id,message_id'});if(markError)throw markError;
   processed++;
   await wait(250);
 }
 const finished=!listing.nextPageToken;
 const patch:Record<string,unknown>={scanned_total:s.scanned_total+processed,phase:incremental?'current':finished?'current':'historical',page_token:finished?null:listing.nextPageToken,last_error:null,retry_after:null,updated_at:new Date().toISOString()};
 if(finished) patch.last_scan_at=new Date().toISOString();
 const {error:saveError}=await db.from('gmail_scan_state').update(patch).eq('user_id',userId);if(saveError)throw saveError;
 return {status:incremental?'current':finished?'complete':'historical',scanned:processed,updated,discovered};
}
export async function runWorker() {
 const db=adminDb();const {data:states,error}=await db.from('gmail_scan_state').select('user_id,phase,retry_after').neq('phase','paused').limit(10);if(error)throw error;
 const results=[];
 for(const state of states||[]){if(state.retry_after && Date.parse(state.retry_after)>Date.now())continue;
 try {results.push({user_id:state.user_id,...await scanUser(state.user_id)});}
 catch(e){const err=e as Error & {status?:number};const delay=err.status===429||err.status===403?60:err.status===401?1440:30;
 await db.from('gmail_scan_state').update({last_error:err.message.slice(0,500),retry_after:new Date(Date.now()+delay*60000).toISOString(),updated_at:new Date().toISOString()}).eq('user_id',state.user_id);
 results.push({user_id:state.user_id,status:'retry',error:err.message.slice(0,120)});}
 }
 return results;
}
