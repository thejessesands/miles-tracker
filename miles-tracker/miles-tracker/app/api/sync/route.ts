import { NextResponse } from 'next/server';
import { serverDb } from '../../../lib/supabase-server';
import {
  collectParts,
  extractBalances,
  extractMemberships,
  discoverPrograms
} from '../../../lib/parse';

export const maxDuration = 60;

type Candidate = {
  balance: number;
  when: number;
  id: string;
};

type MembershipCandidate = {
  number: string;
  when: number;
};

type Discovery = {
  program_name: string;
  category: string;
  membership_number: string | null;
  evidence: string;
  when: number;
};

export async function POST() {
  const db = await serverDb();

  const { data: { user } } = await db.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const { data: { session } } = await db.auth.getSession();
  const token = session?.provider_token;

  if (!token) {
    return NextResponse.json(
      { error: 'Gmail authorization needs renewal. Sign out and reconnect Google.' },
      { status: 400 }
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`
  };

  // Search up to five years of Gmail history.
  const query =
    'newer_than:5y {balance points miles Avios membership "member number" "frequent flyer" "loyalty account" "welcome to"}';

  const balances = new Map<string, Candidate>();
  const memberships = new Map<string, MembershipCandidate>();
  const discoveries = new Map<string, Discovery>();

  let scanned = 0;
  let pages = 0;
  let pageToken: string | undefined;

  // Limit work per request to reduce the risk of timeouts.
  // A complete five-year scan may require multiple runs.
  const maxPages = 5;
  const maxMessages = 150;
  const started = Date.now();

  while (
    pages < maxPages &&
    scanned < maxMessages &&
    Date.now() - started < 45000
  ) {
    const params = new URLSearchParams({
      maxResults: '100',
      q: query
    });

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const listing = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?' +
        params.toString(),
      {
        headers,
        cache: 'no-store'
      }
    );

    if (!listing.ok) {
      return NextResponse.json(
        { error: 'Gmail search failed.' },
        { status: 400 }
      );
    }

    const result = await listing.json();

    const ids: string[] =
      result.messages?.map((m: { id: string }) => m.id) || [];

    pages++;

    for (const id of ids) {
      if (
        scanned >= maxMessages ||
        Date.now() - started >= 45000
      ) {
        break;
      }

      const response = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/' +
          id +
          '?format=full',
        {
          headers,
          cache: 'no-store'
        }
      );

      if (!response.ok) continue;

      const message = await response.json();

      scanned++;

      const subject =
        message.payload?.headers?.find(
          (h: { name: string }) =>
            h.name.toLowerCase() === 'subject'
        )?.value || '';

      const body =
        collectParts(message.payload) ||
        message.snippet ||
        '';

      const when = Number(message.internalDate || 0);

      // Extract balances.
      for (const found of extractBalances(subject, body)) {
        const old = balances.get(found.program_id);

        if (!old || when > old.when) {
          balances.set(found.program_id, {
            balance: found.balance,
            when,
            id
          });
        }
      }

      // Extract membership numbers.
      for (const found of extractMemberships(subject, body)) {
        const old = memberships.get(found.program_id);

        if (!old || when > old.when) {
          memberships.set(found.program_id, {
            number: found.membership_number,
            when
          });
        }
      }

      // Discover additional programs.
      for (const found of discoverPrograms(subject, body)) {
        const old = discoveries.get(found.program_name);

        if (!old || when > old.when) {
          discoveries.set(found.program_name, {
            program_name: found.program_name,
            category: found.category,
            membership_number: found.membership_number,
            evidence: 'Gmail message ' + id,
            when
          });
        }
      }
    }

    pageToken = result.nextPageToken;

    if (!pageToken) break;
  }

  let updated = 0;
  let numbersFound = 0;
  let programsFound = 0;

  // Save balances without overwriting newer statements.
  for (const [program_id, candidate] of balances) {
    const { data: existing } = await db
      .from('balances')
      .select('verified_at,source,membership_number')
      .eq('user_id', user.id)
      .eq('program_id', program_id)
      .maybeSingle();

    if (
      existing?.verified_at &&
      new Date(existing.verified_at).getTime() > candidate.when
    ) {
      continue;
    }

    const { error } = await db.from('balances').upsert(
      {
        user_id: user.id,
        program_id,
        balance: candidate.balance,
        source: 'gmail',
        verified_at: new Date(candidate.when).toISOString(),
        evidence: 'Gmail message ' + candidate.id,
        membership_number:
          memberships.get(program_id)?.number ||
          existing?.membership_number ||
          null
      },
      {
        onConflict: 'user_id,program_id'
      }
    );

    if (!error) updated++;
  }

  // Save membership numbers even if no balance was found.
  // Existing balances must be preserved.
  for (const [program_id, candidate] of memberships) {
    const { data: existing } = await db
      .from('balances')
      .select('program_id,membership_number')
      .eq('user_id', user.id)
      .eq('program_id', program_id)
      .maybeSingle();

    if (!existing) continue;

    if (existing.membership_number) continue;

    const { error } = await db
      .from('balances')
      .update({
        membership_number: candidate.number
      })
      .eq('user_id', user.id)
      .eq('program_id', program_id);

    if (!error) numbersFound++;
  }

  // Save possible new programs for later confirmation.
  for (const discovery of discoveries.values()) {
    const { data: existing } = await db
      .from('discovered_programs')
      .select('id')
      .eq('user_id', user.id)
      .eq('program_name', discovery.program_name)
      .maybeSingle();

    if (existing) continue;

    const { error } = await db
      .from('discovered_programs')
      .insert({
        user_id: user.id,
        program_name: discovery.program_name,
        category: discovery.category,
        membership_number: discovery.membership_number,
        evidence: discovery.evidence,
        confirmed: false
      });

    if (!error) programsFound++;
  }

  return NextResponse.json({
    scanned,
    pages,
    updated,
    numbersFound,
    programsFound,
    note:
      'Historical Gmail scan completed for this batch. Additional scans may be needed.'
  });
}
