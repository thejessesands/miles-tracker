import { NextResponse } from 'next/server';
import { serverDb } from '@/lib/supabase-server';
import { PROGRAMS } from '@/lib/programs';

export async function POST(req: Request) {
  const db = await serverDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { id?: string; action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({error:'Invalid request'}, {status:400}); }
  if (!body.id || !['approve','dismiss'].includes(body.action || '')) return NextResponse.json({error:'Invalid request'}, {status:400});
  const {data:suggestion,error:lookupError}=await db.from('balance_suggestions').select('*').eq('id',body.id).eq('user_id',user.id).eq('status','pending').maybeSingle();
  if(lookupError || !suggestion)return NextResponse.json({error:'Suggestion not found'}, {status:404});
  if(body.action==='approve') {
    if(!PROGRAMS.some(p=>p.id===suggestion.program_id)) {
      if(!suggestion.program_id.startsWith('discovered:'))return NextResponse.json({error:'Unknown program'}, {status:400});
      const id=suggestion.program_id.slice('discovered:'.length);
      const {data:discovery}=await db.from('discovered_programs').select('id').eq('id',id).eq('user_id',user.id).eq('confirmed',true).eq('dismissed',false).maybeSingle();
      if(!discovery)return NextResponse.json({error:'Program not confirmed'}, {status:400});
    }
    const {data:old,error:oldError}=await db.from('balances').select('membership_number,expires_at').eq('user_id',user.id).eq('program_id',suggestion.program_id).maybeSingle();
    if(oldError)return NextResponse.json({error:oldError.message}, {status:500});
    const {error:saveError}=await db.from('balances').upsert({user_id:user.id,program_id:suggestion.program_id,balance:suggestion.suggested_balance,source:'gmail',verified_at:suggestion.email_date||new Date().toISOString(),evidence:suggestion.evidence,membership_number:old?.membership_number||null,expires_at:old?.expires_at||null},{onConflict:'user_id,program_id'});
    if(saveError)return NextResponse.json({error:saveError.message}, {status:500});
  }
  const {error:updateError}=await db.from('balance_suggestions').update({status:body.action==='approve'?'approved':'dismissed'}).eq('id',body.id).eq('user_id',user.id).eq('status','pending');
  if(updateError)return NextResponse.json({error:updateError.message}, {status:500});
  return NextResponse.json({ok:true});
}
