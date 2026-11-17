import { NextResponse } from 'next/server';
import { serverDb } from '../../../lib/supabase-server';
import { adminDb } from '../../../lib/admin';
export async function GET(){const db=await serverDb();const {data:{user}}=await db.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
const {data,error}=await adminDb().from('gmail_scan_state').select('phase,scanned_total,last_scan_at,last_error,retry_after,updated_at').eq('user_id',user.id).maybeSingle();
if(error)return NextResponse.json({error:'Unable to load status'},{status:500});return NextResponse.json({scan:data});}
