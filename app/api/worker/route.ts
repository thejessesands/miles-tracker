import { NextRequest,NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runWorker } from '../../../lib/scan-worker';
export const maxDuration=60;
export async function GET(req:NextRequest){
 const expected=process.env.SCAN_CRON_SECRET;
 const received=req.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!expected||!received||expected.length!==received.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(received)))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{return NextResponse.json({results:await runWorker()});}catch(e){return NextResponse.json({error:(e as Error).message},{status:500});}
}
