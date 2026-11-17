```
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
  const [discoveries, setDiscoveries] = useState<{id:string;program_name:string;category:string;membership_number:string|null;confirmed:boolean;dismissed:boolean;expires_at:string|null}[]>([]);
  const [scanStatus, setScanStatus] = useState<{phase:string;scanned_total:number;last_scan_at:string|null;last_error:string|null;retry_after:string|null}|null>(null);
  const [balanceSuggestions, setBalanceSuggestions] = useState<{id:string;program_id:string;suggested_balance:number;email_date:string|null}[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [entry, setEntry] = useState('');
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [editField, setEditField] = useState<'balance'|'membership'|'expiry'>('balance');
  const [addingProgram, setAddingProgram] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Airlines');
  const [newNumber, setNewNumber] = useState('');

  const db = useMemo(() => browserDb(), []);

  const reload = useCallback(async () => {
    const { data: { user: u } } = await db.auth.getUser();

    setUser(u);
    setReady(true);

    if (u) {
      const { data } = await db.from('balances').select('*');
      setRows((data || []) as Balance[]);
      const {data:found}=await db.from('discovered_programs').select('id,program_name,category,membership_number,confirmed,dismissed,expires_at');
      setDiscoveries(found || []);
      const {data:pending}=await db.from('balance_suggestions').select('id,program_id,suggested_balance,email_date').eq('status','pending');
      setBalanceSuggestions(pending || []);
      const status=await fetch('/api/scan-status').then(r=>r.ok?r.json():null).catch(()=>null);
      setScanStatus(status?.scan || null);
    } else {
      setRows([]);
      setDiscoveries([]);
      setBalanceSuggestions([]);
      setScanStatus(null);
    }
  }, [db]);

  useEffect(() => {
    reload();

    const { data: { subscription } } = db.auth.onAuthStateChange(() => {
      setTimeout(reload, 0);
    });

    return () => subscription.unsubscribe();
  }, [db, reload]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => { void reload(); }, 60000);
    return () => clearInterval(timer);
  }, [user, reload]);

  async function reviewBalance(id:string,action:'approve'|'dismiss') {
    const res=await fetch('/api/balance-suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action})});
    const json=await res.json();
    if(!res.ok){setMessage(json.error||'Unable to review suggestion.');return;}
    setMessage(action==='approve'?'Balance updated.':'Suggestion dismissed.');
    await reload();
  }

  async function confirmDiscovery(id:string,confirmed:boolean){
    const {error}=await db.from('discovered_programs').update({confirmed}).eq('id',id);
    if(error)setMessage(error.message);else await reload();
  }

  async function dismissDiscovery(id:string) {
    const {error}=await db.from('discovered_programs').update({dismissed:true,confirmed:false}).eq('id',id);
    if(error)setMessage(error.message);else await reload();
  }

  async function addProgram() {
    if (!user || !newName.trim()) { setMessage('Enter a program name.'); return; }
    const match = discoveries.find(d => d.program_name.toLowerCase() === newName.trim().toLowerCase());
    if (match) {
      const {error} = await db.from('discovered_programs').update({confirmed:true,dismissed:false,category:newCategory,membership_number:newNumber.trim()||null}).eq('id',match.id);
      if(error){setMessage(error.message);return;}
    } else {
      const {error}=await db.from('discovered_programs').insert({user_id:user.id,program_name:newName.trim(),category:newCategory,membership_number:newNumber.trim()||null,confirmed:true,dismissed:false});
      if(error){setMessage(error.message);return;}
    }
    setAddingProgram(false);setNewName('');setNewNumber('');setMessage('Program added.');await reload();
  }

  async function saveField(id:string,field:'balance'|'membership'|'expiry',value:string) {
    if (!user) return;
    const discovered = id.startsWith('discovered:');
    const cleanId = id.replace(/^discovered:/,'');
    if (field === 'balance') {
      const balance=Number(value.replace(/,/g,''));
      if (!Number.isSafeInteger(balance)||balance<0) {setMessage('Enter a valid nonnegative whole number.');return;}
      const res=await fetch('/api/balances',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({program_id:id,balance})});
      const json=await res.json();if(!res.ok){setMessage(json.error||'Unable to save balance.');return;}
    } else if (discovered) {
      const patch=field==='membership'?{membership_number:value.trim()||null}:{expires_at:value||null};
      const {error}=await db.from('discovered_programs').update(patch).eq('id',cleanId);
      if(error){setMessage(error.message);return;}
    } else {
      const record=rows.find(r=>r.program_id===id);
      const patch=field==='membership'?{membership_number:value.trim()||null}:{expires_at:value||null};
      const {error}=record
        ? await db.from('balances').update(patch).eq('program_id',id).eq('user_id',user.id)
        : await db.from('balances').insert({user_id:user.id,program_id:id,balance:0,source:'manual',...patch});
      if(error){setMessage(error.message);return;}
    }
    setEditing(null);setMessage('Saved.');await reload();
  }

  function beginEdit(id:string,field:'balance'|'membership'|'expiry',value:string){
    setEditing(id);setEditField(field);setEntry(value);
  }

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
          ? j.note
          : j.error
      );

      if (res.ok) await reload();
    } catch {
      setMessage('Could not connect to sync service.');
    } finally {
      setSyncing(false);
    }
  }

  const all = [
    ...PROGRAMS.map(p => ({...p,record:rows.find(r => r.program_id === p.id), discoveredNumber:null as string|null, expiresAt:(rows.find(r => r.program_id === p.id) as (Balance & {expires_at?:string|null})|undefined)?.expires_at || null})),
    ...discoveries.filter(d => d.confirmed && !d.dismissed).map(d => ({
  id: 'discovered:' + d.id,
  name: d.program_name,
  category: d.category,
  unit: 'points',
  color: '#64748b',
  record: rows.find(r => r.program_id === 'discovered:' + d.id),
  discoveredNumber: d.membership_number,
  expiresAt: d.expires_at
}))
  ].sort((a,b)=>a.name.localeCompare(b.name));

  const tracked = all.filter(p => !!p.record || p.id.startsWith('discovered:'));
  const expiring = all.filter(p => p.expiresAt && new Date(p.expiresAt).getTime() >= Date.now() && new Date(p.expiresAt).getTime() <= Date.now()+90*86400000).sort((a,b)=>new Date(a.expiresAt!).getTime()-new Date(b.expiresAt!).getTime());

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
              <b> / {all.length}</b>
            </strong>

            <small>
              {all.length - tracked.length} balances to add
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

              {syncing ? 'Enabling…' : 'Enable automatic Gmail scan'}
            </button>
          </div>

          {scanStatus && <div className="notice">
            <RefreshCw size={16}/>
            {scanStatus.phase === 'historical'
              ? `Daily scan initializing: ${fmt(scanStatus.scanned_total)} emails processed.`
              : `Automatic scanning active. ${fmt(scanStatus.scanned_total)} emails processed.`}
            {scanStatus.last_scan_at && ` Last completed: ${new Date(scanStatus.last_scan_at).toLocaleString()}.`}
            {scanStatus.last_error && ` Retrying after error: ${scanStatus.last_error}`}
          </div>}
          {balanceSuggestions.length>0 && <div className="notice" style={{display:'block'}}>
            <strong>Suggested balance updates — review before applying:</strong>
            {balanceSuggestions.map(s=>{
              const program=all.find(p=>p.id===s.program_id);
              return <div key={s.id} style={{marginTop:10,display:'flex',gap:12,alignItems:'center',justifyContent:'space-between'}}>
                <span>{program?.name||s.program_id}: {program?.record ? fmt(program.record.balance) : '—'} → {fmt(s.suggested_balance)}{s.email_date?` · Email ${new Date(s.email_date).toLocaleDateString()}`:''}</span>
                <div style={{display:'flex',gap:8}}><button className="edit" onClick={()=>void reviewBalance(s.id,'approve')}>Approve</button><button className="edit" onClick={()=>void reviewBalance(s.id,'dismiss')}>Dismiss</button></div>
              </div>;
            })}
          </div>}
          {discoveries.some(d=>!d.confirmed && !d.dismissed) && <div className="notice" style={{display:'block'}}>
            <strong>Possible memberships — confirm the programs you actually use:</strong>
            {discoveries.filter(d=>!d.confirmed && !d.dismissed).sort((a,b)=>a.program_name.localeCompare(b.program_name)).map(d=>(
              <div key={d.id} style={{marginTop:10,display:'flex',gap:12,alignItems:'center',justifyContent:'space-between'}}>
                <span>{d.program_name}{d.membership_number?` · Member ${d.membership_number}`:''}</span>
                <div style={{display:"flex",gap:8}}><button className="edit" onClick={()=>confirmDiscovery(d.id,true)}>Add program</button><button className="edit" onClick={()=>dismissDiscovery(d.id)}>Dismiss</button></div>
              </div>
            ))}
          </div>}
          <div className="notice" style={{display:'block'}}>
            <strong>Miles expiring soon (next 90 days)</strong>
            {expiring.length ? expiring.map(p => {
              const days=Math.ceil((new Date(p.expiresAt!).getTime()-Date.now())/86400000);
              return <div key={p.id} style={{marginTop:8}}>{p.name}: {new Date(p.expiresAt!).toLocaleDateString()} — {days} days remaining{days<=30?' · Urgent':days<=60?' · Within 60 days':' · Within 90 days'}</div>;
            }) : <div style={{marginTop:8}}>No recorded expiration dates within 90 days. Use “Set expiration” on an account to add one.</div>}
          </div>
          <div style={{margin:'16px 0'}}>
            <button className="sync" onClick={()=>setAddingProgram(!addingProgram)}>{addingProgram?'Cancel':'Add a loyalty program manually'}</button>
            {addingProgram && <div className="notice" style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
              <input aria-label="Program name" placeholder="Program name" value={newName} onChange={e=>setNewName(e.target.value)}/>
              <select aria-label="Category" value={newCategory} onChange={e=>setNewCategory(e.target.value)}>{['Airlines','Hotels','Credit Cards'].map(c=><option key={c}>{c}</option>)}</select>
              <input aria-label="Membership number" placeholder="Membership number (optional)" value={newNumber} onChange={e=>setNewNumber(e.target.value)}/>
              <button className="edit" onClick={addProgram}>Save program</button>
            </div>}
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
                      {editing===p.id && editField==='membership' ? <input className="balance-input" aria-label="Membership number" autoFocus value={entry} onChange={e=>setEntry(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void saveField(p.id,'membership',entry);if(e.key==='Escape')setEditing(null);}}/> : <span className="membership">{p.record?.membership_number || p.discoveredNumber || 'Not entered'}</span>}
                      <div><button className="edit" onClick={()=>editing===p.id&&editField==='membership'?void saveField(p.id,'membership',entry):beginEdit(p.id,'membership',p.record?.membership_number||p.discoveredNumber||'')}>{editing===p.id&&editField==='membership'?'Save':'Edit number'}</button></div>
                    </td>

                    <td>
                      {editing === p.id && editField === 'balance' ? (
                        <input
                          className="balance-input"
                          type="text"
                          inputMode="numeric"
                          autoFocus
                          value={entry}
                          onChange={e => setEntry(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void saveField(p.id,'balance',entry);
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
                          if (editing === p.id && editField === 'balance') {
                            void saveField(p.id,'balance',entry);
                          } else {
                            beginEdit(p.id,'balance',String(p.record?.balance ?? ''));
                          }
                        }}
                      >
                        {editing === p.id
                          ? 'Save'
                          : p.record
                            ? 'Edit'
                            : 'Add balance'}
                      </button>
                      <div style={{marginTop:6}}>
                        {editing===p.id && editField==='expiry' ? <input aria-label="Expiration date" type="date" value={entry} onChange={e=>setEntry(e.target.value)}/> : <small>{p.expiresAt?'Expires '+new Date(p.expiresAt).toLocaleDateString():'Expiration unknown'}</small>}
                      </div>
                      <button className="edit" onClick={()=>editing===p.id&&editField==='expiry'?void saveField(p.id,'expiry',entry):beginEdit(p.id,'expiry',p.expiresAt?.slice(0,10)||'')}>{editing===p.id&&editField==='expiry'?'Save date':'Set expiration'}</button>
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
          MADE FOR THE JOURNEYS AHEAD <span>✦</span> MILES & POINTS
        </footer>
      </main>
    </div>
  );
}
