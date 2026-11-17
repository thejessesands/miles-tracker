import {NextResponse} from 'next/server';
import { serverDb } from '../../../lib/supabase-server';
import {collectParts,extractBalances} from '../../../lib/parse';
export const maxDuration=60;
export async function POST(){
 const db=await serverDb();const {data:{user}}=await db.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 // Provider tokens are NOT assumed to persist in Supabase sessions. A fresh Google OAuth
 // authorization with offline access is required for reliable unattended sync.
 const {data:{session}}=await db.auth.getSession();const token=session?.provider_token;
 if(!token)return NextResponse.json({error:'Gmail authorization needs renewal. Sign out and reconnect Google, then sync again.'},{status:400});
 const q='newer_than:180d ("balance" OR "points" OR "miles" OR "Avios")';
 const listing=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q='+encodeURIComponent(q),{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(!listing.ok)return NextResponse.json({error:'Gmail access failed. Check that Gmail read-only permission was granted.'},{status:400});
 const ids:(string[])=(await listing.json()).messages?.map((m:{id:string})=>m.id)||[];
 const candidates=new Map<string,{balance:number,when:number,id:string}>();let scanned=0;
 for(const id of ids){const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+id+'?format=full',{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!r.ok)continue;const m=await r.json();scanned++;const subject=m.payload?.headers?.find((h:{name:string})=>h.name.toLowerCase()==='subject')?.value||'';const body=collectParts(m.payload)||m.snippet||'';const when=Number(m.internalDate||0);for(const found of extractBalances(subject,body)){const old=candidates.get(found.program_id);if(!old||when>old.when)candidates.set(found.program_id,{balance:found.balance,when,id});}}
 let updated=0;for(const [program_id,c] of candidates){const {data:existing}=await db.from('balances').select('verified_at,source').eq('user_id',user.id).eq('program_id',program_id).maybeSingle();if(existing?.verified_at&&new Date(existing.verified_at).getTime()>c.when)continue;const {error}=await db.from('balances').upsert({user_id:user.id,program_id,balance:c.balance,source:'gmail',verified_at:new Date(c.when).toISOString(),evidence:'Gmail message '+c.id},{onConflict:'user_id,program_id'});if(!error)updated++;}
 return NextResponse.json({updated,scanned,found:candidates.size,note:'Only unambiguous balance statements were accepted. Gmail updates are not live account balances.'});
}
