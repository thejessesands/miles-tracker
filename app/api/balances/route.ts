import { NextResponse } from 'next/server';
import { serverDb } from '@/lib/supabase-server';
import { PROGRAMS } from '@/lib/programs';

export async function POST(req: Request) {
  const db = await serverDb();

  const { data: { user } } = await db.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const body = await req.json();
  const programId = body.program_id;
  const balance = body.balance;

  if (
    typeof programId !== 'string' ||
    !Number.isSafeInteger(balance) ||
    balance < 0
  ) {
    return NextResponse.json(
      { error: 'Invalid balance' },
      { status: 400 }
    );
  }

  // Accept original programs and confirmed discovered programs.
  if (!PROGRAMS.some(p => p.id === programId)) {
    if (!programId.startsWith('discovered:')) {
      return NextResponse.json(
        { error: 'Unknown loyalty program' },
        { status: 400 }
      );
    }

    const discoveryId = programId.slice('discovered:'.length);

    const { data: discovery, error: lookupError } = await db
      .from('discovered_programs')
      .select('id, confirmed, dismissed')
      .eq('id', discoveryId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (
      lookupError ||
      !discovery ||
      !discovery.confirmed ||
      discovery.dismissed
    ) {
      return NextResponse.json(
        { error: 'Loyalty program not found or not confirmed' },
        { status: 400 }
      );
    }
  }

  const { error } = await db.from('balances').upsert(
    {
      user_id: user.id,
      program_id: programId,
      balance,
      source: 'manual',
      verified_at: new Date().toISOString(),
      evidence: null,
    },
    { onConflict: 'user_id,program_id' }
  );

  return NextResponse.json(
    error ? { error: error.message } : { ok: true },
    { status: error ? 500 : 200 }
  );
}
