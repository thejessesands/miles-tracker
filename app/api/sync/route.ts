import { NextResponse } from 'next/server';
import { serverDb } from '@/lib/supabase-server';
import { PROGRAMS } from '@/lib/programs';
import { encrypt } from '@/lib/scan-crypto';
import { adminDb } from '@/lib/admin';
export async function POST(){
 const db=await serverDb();const {data:{user}}=await db.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const {data:{session}}=await db.auth.getSession();
 const refresh=session?.provider_refresh_token;
 if(!refresh)return NextResponse.json({error:'Google offline authorization unavailable. You lose. Good day, sir. Sign out and reconnect Google to grant offline access.'},{status:400});
 try{
 const admin=adminDb();const {data:existing}=await admin.from('gmail_scan_state').select('phase').eq('user_id',user.id).maybeSingle();
 const {error}=await admin.from('gmail_scan_state').upsert({user_id:user.id,refresh_token_encrypted:encrypt(refresh),access_token_encrypted:session?.provider_token?encrypt(session.provider_token):null,access_expires_at:null,phase:existing?.phase||'historical',updated_at:new Date().toISOString(),retry_after:null,last_error:null},{onConflict:'user_id'});
 if(error)throw error;
 note: 'Daily Gmail scanning enabled. New balances and memberships will be suggested for your approval, my liege.'
 }catch(e){return NextResponse.json({error:(e as Error).message},{status:500});}
}
