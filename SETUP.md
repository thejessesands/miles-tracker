# Automatic three-year Gmail scanner — deployment

This repository includes the complete code changes. **The scanner cannot run until the following configuration is completed.** No credentials are included in this ZIP.

1. In Supabase → SQL Editor, run `supabase/upgrade.sql`. This creates the encrypted-token scan state and message checkpoint tables, preserving your existing balances and discovered programs.
2. In Vercel → Project → Settings → Environment Variables, add these server-only variables:
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase Project Settings → API → service_role secret. Never prefix with `NEXT_PUBLIC_`.
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: the OAuth client configured for Google login in Supabase Authentication → Providers → Google (credentials originate in Google Cloud Console).
   - `GMAIL_TOKEN_ENCRYPTION_KEY`: 32 random bytes as 64 hexadecimal characters. Generate locally with `openssl rand -hex 32` (or Python `secrets.token_hex(32)`). **Keep this key permanently**; changing it invalidates stored encrypted tokens.
   - `SCAN_CRON_SECRET`: a separate long random secret (e.g. `openssl rand -hex 32`).
3. In GitHub → repository → Settings → Secrets and variables → Actions, create:
   - `SCAN_URL`: your production site origin, without trailing slash (for example `https://miles-tracker-sigma.vercel.app`).
   - `SCAN_CRON_SECRET`: the exact same value as in Vercel.
4. Commit/deploy the files to GitHub. Confirm the Vercel deployment is Ready.
5. Sign out of the dashboard, sign back in with Google and consent to offline Gmail access. Click **Enable automatic Gmail scan** once. Supabase must return a `provider_refresh_token`; otherwise the dashboard explains that reconnection is needed.
6. GitHub Actions → **Automatic Gmail scan** → **Run workflow** to test immediately, or wait for the 15-minute schedule. GitHub scheduled jobs may be delayed or disabled after prolonged repository inactivity. Vercel function duration and Google API quota limits still apply; the worker processes up to 25 messages per invocation, waits between requests, and saves its position.

## Behavior and limitations
- Historical search uses Gmail's `newer_than:3y` and saves its pagination token. Once complete, scans use a 48-hour overlap from the last successful checkpoint, deduplicating message IDs.
- Program discovery requires account-specific evidence, not mere brand mention. New programs await confirmation and appear alphabetically when confirmed.
- The email parser is heuristic: balances and membership numbers may be missing or ambiguous. The app does **not** connect to airline/hotel accounts or verify live balances.
- The worker uses Google OAuth refresh tokens encrypted at rest, and only the service-role server process can read them.
- The existing dashboard has manual balance editing only for the original built-in programs; discovered-program editing is not included in this version.
- The initial scan's 3-year query is not a guarantee that every historical membership is currently active; the dashboard keeps existing records rather than deleting them.
