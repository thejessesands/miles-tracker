import { NextResponse } from 'next/server';
import { serverDb } from '../../../lib/supabase-server';
import {
  collectParts,
  extractBalances,
  extractMemberships,
  discoverPrograms
} from '../../../lib/parse';

export const maxDuration = 60;

const QUERY =
  'newer_than:5y {balance points miles Avios membership "member number" "frequent flyer" "loyalty account" "welcome to"}';

const MAX_PAGES = 2;
const MAX_TIME_MS = 40000;

type BalanceCandidate = {
  balance: number;
  when: number;
  id: string;
};

type MembershipCandidate = {
  number: string;
  when: number;
};

type DiscoveryCandidate = {
  program_name: string;
  category: string;
  membership_number: string | null;
  evidence: string;
  when: number;
};

export async function POST() {
  const db = await serverDb();

  const {
    data: { user }
  } = await db.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const {
    data: { session }
  } = await db.auth.getSession();

  const token = session?.provider_token;

  if (!token) {
    return NextResponse.json(
      {
        error:
          'Gmail authorization needs renewal. Sign out and reconnect Google.'
      },
      { status: 400 }
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`
  };

  const {
    data: progress,
    error: progressError
  } = await db
    .from('gmail_scan_progress')
    .select('page_token,scanned_total')
    .eq('user_id', user.id)
    .maybeSingle();

  if (progressError) {
    return NextResponse.json(
      { error: 'Unable to load Gmail scan progress.' },
      { status: 500 }
    );
  }

  let pageToken: string | undefined =
    progress?.page_token || undefined;

  let scannedTotal = progress?.scanned_total || 0;

  // A completed scan is marked with a null page token.
  if (progress && !progress.page_token && scannedTotal > 0) {
    return NextResponse.json({
      scanned: 0,
      scannedTotal,
      updated: 0,
      numbersFound: 0,
      programsFound: 0,
      complete: true,
      note: 'Five-year Gmail scan is already complete.'
    });
  }

  const started = Date.now();

  let scanned = 0;
  let pages = 0;
  let updated = 0;
  let numbersFound = 0;
  let programsFound = 0;
  let complete = false;

  while (
    pages < MAX_PAGES &&
    Date.now() - started < MAX_TIME_MS
  ) {
    const params = new URLSearchParams({
      maxResults: '50',
      q: QUERY
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
      const details = await listing.text();

      console.error(
        'Gmail API error:',
        listing.status,
        details
      );

      return NextResponse.json(
        {
          error:
            `Gmail search failed (Google status ${listing.status}).`
        },
        { status: 400 }
      );
    }

    const result = await listing.json();

    const ids: string[] =
      result.messages?.map(
        (m: { id: string }) => m.id
      ) || [];

    const balances = new Map<string, BalanceCandidate>();

    const memberships =
      new Map<string, MembershipCandidate>();

    const discoveries =
      new Map<string, DiscoveryCandidate>();

    // Process every message on this page before
    // advancing the saved pagination token.
    for (const id of ids) {
      const response = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/' +
          id +
          '?format=full',
        {
          headers,
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        console.error(
          'Unable to retrieve Gmail message:',
          response.status
        );

        // Do not advance past an incomplete page.
        return NextResponse.json(
          {
            error:
              'A Gmail message could not be retrieved. Retry the scan.'
          },
          { status: 502 }
        );
      }

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

      for (const found of extractMemberships(subject, body)) {
        const old = memberships.get(found.program_id);

        if (!old || when > old.when) {
          memberships.set(found.program_id, {
            number: found.membership_number,
            when
          });
        }
      }

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

    // Save balances and membership numbers for this page.
    for (const [program_id, candidate] of balances) {
      const { data: existing, error: readError } = await db
        .from('balances')
        .select(
          'balance,verified_at,source,membership_number'
        )
        .eq('user_id', user.id)
        .eq('program_id', program_id)
        .maybeSingle();

      if (readError) {
        return NextResponse.json(
          { error: 'Unable to read existing balances.' },
          { status: 500 }
        );
      }

      if (
        existing?.verified_at &&
        new Date(existing.verified_at).getTime() >
          candidate.when
      ) {
        continue;
      }

      const { error } = await db.from('balances').upsert(
        {
          user_id: user.id,
          program_id,
          balance: candidate.balance,
          source: 'gmail',
          verified_at: new Date(
            candidate.when
          ).toISOString(),
          evidence: 'Gmail message ' + candidate.id,
          membership_number:
            existing?.membership_number ||
            memberships.get(program_id)?.number ||
            null
        },
        {
          onConflict: 'user_id,program_id'
        }
      );

      if (error) {
        console.error('Balance save error:', error.message);

        return NextResponse.json(
          { error: 'Unable to save a Gmail balance.' },
          { status: 500 }
        );
      }

      updated++;
    }

    // Save membership numbers without overwriting balances.
    for (const [program_id, candidate] of memberships) {
      const { data: existing, error: readError } = await db
        .from('balances')
        .select('program_id,membership_number')
        .eq('user_id', user.id)
        .eq('program_id', program_id)
        .maybeSingle();

      if (readError) {
        return NextResponse.json(
          { error: 'Unable to read membership records.' },
          { status: 500 }
        );
      }

      if (!existing || existing.membership_number) {
        continue;
      }

      const { error } = await db
        .from('balances')
        .update({
          membership_number: candidate.number
        })
        .eq('user_id', user.id)
        .eq('program_id', program_id);

      if (error) {
        return NextResponse.json(
          { error: 'Unable to save a membership number.' },
          { status: 500 }
        );
      }

      numbersFound++;
    }

    // Save possible additional programs.
    for (const discovery of discoveries.values()) {
      const { data: existing, error: readError } = await db
        .from('discovered_programs')
        .select('id')
        .eq('user_id', user.id)
        .eq('program_name', discovery.program_name)
        .maybeSingle();

      if (readError) {
        return NextResponse.json(
          { error: 'Unable to read discovered programs.' },
          { status: 500 }
        );
      }

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

      if (error) {
        return NextResponse.json(
          { error: 'Unable to save a discovered program.' },
          { status: 500 }
        );
      }

      programsFound++;
    }

    pages++;
    scannedTotal += ids.length;

    const nextToken: string | undefined =
      result.nextPageToken;

    complete = !nextToken;

    // Save progress only after the entire page
    // has been processed and saved successfully.
    const { error: saveProgressError } = await db
      .from('gmail_scan_progress')
      .upsert(
        {
          user_id: user.id,
          page_token: nextToken || null,
          scanned_total: scannedTotal,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'user_id'
        }
      );

    if (saveProgressError) {
      return NextResponse.json(
        { error: 'Unable to save Gmail scan progress.' },
        { status: 500 }
      );
    }

    pageToken = nextToken;

    if (complete) break;
  }

  return NextResponse.json({
    scanned,
    scannedTotal,
    pages,
    updated,
    numbersFound,
    programsFound,
    complete,
    note: complete
      ? 'Five-year Gmail scan completed.'
      : 'Batch completed. Click Sync from Gmail again to continue scanning older emails.'
  });
}
