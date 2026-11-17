import { adminDb } from './admin';
import { decrypt, encrypt } from './scan-crypto';
import { collectParts, extractBalances, discoverPrograms, hasAccountActivity } from './parse';
import { PROGRAMS } from './programs';

const PAGE_SIZE = 50;
const SEARCH_TERMS = '{balance points miles Avios membership "member number" "frequent flyer" "loyalty account" "welcome to"}';
type State = { user_id:string; refresh_token_encrypted:string; access_token_encrypted:string|null; access_expires_at:string|null; page_token:string|null; scanned_total:number; phase:string; last_scan_at:string|null; last_error:string|null; retry_after:string|null; };
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
 // The first daily scan checks the last two days only. Subsequent scans overlap
 // the prior completion by two days; message IDs prevent duplicate processing.
 const start = s.last_scan_at ? Date.parse(s.last_scan_at)-2*86400000 : Date.now()-2*86400000;
 const after = Math.floor((Number.isFinite(start) ? start : Date.now()-2*86400000)/1000);
 const query=`after:${after} ${SEARCH_TERMS}`;
 const params=new URLSearchParams({q:query,maxResults:String(PAGE_SIZE)});
 // Discard a cursor from the retired historical scan.
 if(s.phase==='current' && s.page_token) params.set('pageToken',s.page_token);
 const listing=await gmail(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,token);
 const ids:string[]=(listing.messages||[]).map((m:{id:string})=>m.id);
 const {data:customPrograms,error:customError}=await db.from('discovered_programs').select('id,program_name,confirmed,dismissed').eq('user_id',userId);
 if(customError)throw customError;
 const custom=customPrograms||[];
 let processed=0,updated=0,discovered=0;
 for(const id of ids){
   const {data:seen,error:seenError}=await db.from('gmail_processed_messages').select('message_id').eq('user_id',userId).eq('message_id',id).maybeSingle();
   if(seenError)throw seenError;
   if(seen){processed++;continue;}
   const message=await gmail(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,token);
   const subject=(message.payload?.headers||[]).find((h:{name:string})=>h.name.toLowerCase()==='subject')?.value||'';
   const body=collectParts(message.payload)||message.snippet||'';
   const timestamp=Number(message.internalDate||0);
   const when=Number.isFinite(timestamp)&&timestamp>0?new Date(timestamp).toISOString():new Date().toISOString();
   if(hasAccountActivity(subject,body) || /welcome to|thank you for joining|thank you for enrolling|membership confirmed/i.test(subject)){
     for(const b of extractBalances(subject,body,custom.filter(p=>p.confirmed&&!p.dismissed))){
       const {data:old,error:balanceError}=await db.from('balances').select('balance,verified_at').eq('user_id',userId).eq('program_id',b.program_id).maybeSingle();
       if(balanceError)throw balanceError;
       if(old?.balance===b.balance)continue;
       if(old?.verified_at && Date.parse(old.verified_at)>Date.parse(when))continue;
       const {error:insertError}=await db.from('balance_suggestions').insert({user_id:userId,program_id:b.program_id,suggested_balance:b.balance,email_date:when,evidence:`Gmail message ${id}`,message_id:id,status:'pending'});
       if(insertError && insertError.code!=='23505')throw insertError;
       if(!insertError)updated++;
     }
     // Only propose a program when enrollment evidence is present, and never
     // re-propose a program that is already tracked or previously dismissed.
     for(const d of discoverPrograms(subject,body)){
       if(custom.some(p=>p.program_name.toLowerCase()===d.program_name.toLowerCase()))continue;
       if(PROGRAMS.some(p=>p.name.toLowerCase()===d.program_name.toLowerCase()))continue;
       const {error:insertError}=await db.from('discovered_programs').insert({user_id:userId,program_name:d.program_name,category:d.category,membership_number:d.membership_number,evidence:`Gmail message ${id}`,confirmed:false,dismissed:false});
       if(insertError)throw insertError;
       custom.push({id:'',program_name:d.program_name,confirmed:false,dismissed:false});
       discovered++;
     }
   }
   const {error:markError}=await db.from('gmail_processed_messages').upsert({user_id:userId,message_id:id,processed_at:new Date().toISOString()},{onConflict:'user_id,message_id'});if(markError)throw markError;
   processed++;
   await wait(100);
 }
 const finished=!listing.nextPageToken;
 const patch:Record<string,unknown>={scanned_total:s.scanned_total+processed,phase:'current',page_token:finished?null:listing.nextPageToken,last_error:null,retry_after:null,updated_at:new Date().toISOString()};
 if(finished)patch.last_scan_at=new Date().toISOString();
 const {error:saveError}=await db.from('gmail_scan_state').update(patch).eq('user_id',userId);if(saveError)throw saveError;
 return {status:'current',scanned:processed,updated,discovered};
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
