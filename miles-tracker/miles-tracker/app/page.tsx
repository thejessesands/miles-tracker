'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { browserDb } from '../lib/supabase';
import { PROGRAMS, type Balance } from '../lib/programs';
import type { User } from '@supabase/supabase-js';
import {
  ArrowUpRight,
  RefreshCw,
  LogOut,
  Wallet,
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Balance[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [entry, setEntry] = useState('');
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  const db = useMemo(() => browserDb(), []);

  const reload = useCallback(async () => {
    const { data: { user: u } } = await db.auth.getUser();

    setUser(u);
    setReady(true);

    if (u) {
      const { data } = await db.from('balances').select('*');
      setRows((data || []) as Balance[]);
    } else {
      setRows([]);
    }
  }, [db]);

  useEffect(() => {
    reload();

    const { data: { subscription } } = db.auth.onAuthStateChange(() => {
      setTimeout(reload, 0);
    });

    return () => subscription.unsubscribe();
  }, [db, reload]);

  async function signIn() {
    setMessage('');

    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });

    if (error) setMessage(error.message);
  }

  async function save(id: string) {
    const balance = Number(entry.replace(/,/g, ''));

    if (!Number.isSafeInteger(balance) || balance < 0) {
      setMessage('Enter a valid nonnegative whole number.');
      return;
    }

    const res = await fetch('/api/balances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_id: id,
        balance
      })
    });

    const json = await res.json();

    if (!res.ok) {
      setMessage(json.error || 'Unable to save');
      return;
    }

    setEditing(null);
    setMessage('Balance saved.');
    await reload();
  }

  async function sync() {
    setSyncing(true);
    setMessage('');

    try {
      const res = await fetch('/api/sync', {
        method: 'POST'
      });

      const j = await res.json();

      setMessage(
        res.ok
          ? `Checked ${j.scanned} emails; updated ${j.updated} balances. ${j.note}`
          : j.error
      );

      if (res.ok) await reload();
    } catch {
      setMessage('Could not connect to sync service.');
    } finally {
      setSyncing(false);
    }
  }

  const all = PROGRAMS.map(p => ({
    ...p,
    record: rows.find(r => r.program_id === p.id)
  }));

  const tracked = all.filter(p => !!p.record);

  const stale = tracked.filter(
    p =>
      !p.record?.verified_at ||
      Date.now() - new Date(p.record.verified_at).getTime() > 30 * 86400000
  ).length;

  const shown = all.filter(
    p =>
      (filter === 'All' || p.category === filter) &&
      p.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!ready) {
    return <main className="loading">Loading your dashboard…</main>;
  }

  if (!user) {
    return (
      <main className="login">
        <div className="login-card">
          <div className="mark">
            M<span>✦</span>
          </div>

          <div className="eyebrow">YOUR REWARDS, ONE PLACE</div>

          <h1>
            Every mile.
            <br />
            <em>All together.</em>
          </h1>

          <p>
            Keep tabs on airline miles, credit card rewards, and hotel
            points across your loyalty programs. Private, simple, and
            built for your next trip.
          </p>

          <button className="primary" onClick={signIn}>
            Continue with Google
            <ArrowUpRight size={18} />
          </button>

          <div className="login-note">
            <ShieldCheck size={16} />
            Gmail access is read-only. You control when to sync.
          </div>

          {message && <div className="notice">{message}</div>}
        </div>

        <div className="login-art">
          <div className="art-circle">
            {PROGRAMS.length}
            <small>
              programs
              <br />
              one view
            </small>
          </div>

          <div className="art-label">
            MILES & POINTS
            <br />
            DASHBOARD — 2026
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            M<span>✦</span>
          </span>

          <span>
            Miles<span className="brand-muted"> & Points</span>
          </span>
        </div>

        <div className="side-label">WORKSPACE</div>

        <div className="nav-active">
          <Wallet size={18} />
          Overview
        </div>

        <div className="sidebar-bottom">
          <div className="signed">
            SIGNED IN AS
            <br />
            <strong>{user.email}</strong>
          </div>

          <button
            className="signout"
            onClick={() => db.auth.signOut()}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <span>
            Overview <span className="slash">/</span> Dashboard
          </span>

          <span className="secure">
            <ShieldCheck size={15} />
            Private dashboard
          </span>
        </header>

        <section className="hero">
          <div>
            <div className="eyebrow">YOUR LOYALTY PORTFOLIO</div>

            <h1>
              All your rewards.
              <br />
              <em>One clear picture.</em>
            </h1>

            <p>
              Your miles, points, and membership accounts—organized
              in one place.
            </p>
          </div>

          <div className="hero-deco">✳</div>
        </section>

        <section className="stats">
          <div className="stat">
            <span>LOYALTY PROGRAMS</span>
            <strong>{tracked.length}</strong>
            <small>Programs with recorded balances</small>
          </div>

          <div className="stat">
            <span>PROGRAMS TRACKED</span>

            <strong>
              {tracked.length}
              <b> / {PROGRAMS.length}</b>
            </strong>

            <small>
              {PROGRAMS.length - tracked.length} balances to add
            </small>
          </div>

          <div className="stat">
            <span>NEEDS ATTENTION</span>
            <strong>{stale}</strong>
            <small>Balances older than 30 days</small>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <div>
              <div className="eyebrow">YOUR ACCOUNTS</div>
              <h2>Loyalty balances</h2>
            </div>

            <button
              className="sync"
              onClick={sync}
              disabled={syncing}
            >
              <RefreshCw
                size={17}
                className={syncing ? 'spin' : ''}
              />

              {syncing ? 'Checking Gmail…' : 'Sync from Gmail'}
            </button>
          </div>

          <div className="toolbar">
            <div className="filters">
              {['All', 'Airlines', 'Hotels', 'Credit Cards'].map(f => (
                <button
                  key={f}
                  className={filter === f ? 'selected' : ''}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>

            <label className="search">
              <Search size={17} />

              <input
                placeholder="Find a program"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </label>
          </div>

          {message && (
            <div className="notice">
              <AlertCircle size={17} />
              {message}

              <button onClick={() => setMessage('')}>
                ×
              </button>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PROGRAM</th>
                  <th>MEMBERSHIP NUMBER</th>
                  <th>BALANCE</th>
                  <th>LAST VERIFIED</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {shown.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="program">
                        <span
                          className="program-icon"
                          style={{ background: p.color }}
                        >
                          {p.name.slice(0, 1)}
                        </span>

                        <div>
                          <strong>{p.name}</strong>

                          <small>
                            {p.category} · {p.unit}
                          </small>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className="membership">
                        {p.record?.membership_number || 'Not found'}
                      </span>
                    </td>

                    <td>
                      {editing === p.id ? (
                        <input
                          className="balance-input"
                          type="text"
                          inputMode="numeric"
                          autoFocus
                          value={entry}
                          onChange={e => setEntry(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') save(p.id);
                            if (e.key === 'Escape') setEditing(null);
                          }}
                        />
                      ) : (
                        <strong className="balance">
                          {p.record ? fmt(p.record.balance) : '—'}
                        </strong>
                      )}
                    </td>

                    <td>
                      {p.record?.verified_at ? (
                        <div className="date">
                          <CheckCircle2 size={15} />

                          <span>
                            {new Date(
                              p.record.verified_at
                            ).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}

                            <small>
                              {p.record.source === 'gmail'
                                ? 'Gmail statement'
                                : 'Manual entry'}
                            </small>
                          </span>
                        </div>
                      ) : (
                        <span className="missing">Not added</span>
                      )}
                    </td>

                    <td>
                      <button
                        className="edit"
                        onClick={() => {
                          if (editing === p.id) {
                            save(p.id);
                          } else {
                            setEditing(p.id);
                            setEntry(String(p.record?.balance ?? ''));
                          }
                        }}
                      >
                        {editing === p.id
                          ? 'Save'
                          : p.record
                            ? 'Edit'
                            : 'Add balance'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {shown.length === 0 && (
              <div className="empty">
                No programs match your search.
              </div>
            )}
          </div>

          <p className="footnote">
            Balances and membership numbers are obtained from Gmail
            statements when available. Gmail synchronization does not
            query live loyalty accounts.
          </p>
        </section>

        <footer>
          MADE FOR THE JOURNEY AHEAD <span>✦</span> MILES & POINTS
        </footer>
      </main>
    </div>
  );
}
