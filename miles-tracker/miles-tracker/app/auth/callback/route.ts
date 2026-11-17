import { NextRequest,NextResponse } from 'next/server';
import { serverDb } from '../../../lib/supabase';
export async function GET(req:NextRequest){const code=req.nextUrl.searchParams.get('code');const origin=req.nextUrl.origin;if(code){const db=await serverDb();const {error}=await db.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(origin+'/');}return NextResponse.redirect(origin+'/?auth_error=1');}
