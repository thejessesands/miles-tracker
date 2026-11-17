# Miles & Points — online loyalty dashboard

A private, responsive Next.js app for 11 airline, credit card and hotel rewards programs. Supports manual balance entry, illustrative valuations, Google sign-in, and **on-demand** Gmail statement scanning.

## Deploy (Supabase + Vercel)

1. Create a Supabase project. In its SQL Editor run `supabase/schema.sql`.
2. In Supabase → Authentication → Providers → Google, enable Google. In Google Cloud Console create an OAuth consent screen and an OAuth web client. Add the Supabase callback URL shown in the Supabase Google provider settings as an **authorized redirect URI**.
3. Request Gmail API `gmail.readonly` scope in Google Cloud's OAuth consent configuration and enable Gmail API. During testing add your own Google account as a test user. Google may require verification/security review before broader production use of this sensitive scope.
4. In Supabase → Authentication → URL Configuration set Site URL to your deployment URL and add `https://YOUR_DOMAIN/auth/callback` and `http://localhost:3000/auth/callback` to Redirect URLs. Add your Google OAuth client ID and secret to Supabase Google provider settings.
5. Import this folder into a GitHub repository, then import it into Vercel. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL` as environment variables (see `.env.example`). Deploy.
6. Open your site, sign in with Google, enter balances manually or click **Sync from Gmail** to scan up to 100 matching messages from the last 180 days.

## Local development

Copy `.env.example` to `.env.local`, fill in Supabase values, then run `npm install && npm run dev`.

## Important limitations

- **Not yet deployed**: the project requires your own Supabase, Google Cloud and hosting configuration.
- Gmail scanning is **manual/on-demand**, not an unattended background sync. Supabase `provider_token` is generally short-lived and may not be present on later sessions. Production scheduled synchronization requires a separately secured offline Google token flow, encryption at rest, token refresh and revocation handling. Do not store refresh tokens in the browser or the public `balances` table.
- Email statements are not guaranteed to include current balances. Parsing is deliberately conservative and may miss some formats. Inspect the results and verify them with the actual loyalty program.
- The app only requests `gmail.readonly` (it cannot send, delete or modify email). Google may display sensitive-scope verification warnings during private testing.
- Value estimates are **illustrative**, not official or guaranteed redemption values. Edit `lib/programs.ts` to adjust them.
- The Hawaiian/Atmos program is grouped as a single entry; confirm the current program name and balance directly with the provider.
- Before broader use, add more robust source authentication, parser tests, per-user sync rate limits, audit logging, and tighter Gmail search queries to avoid confusing promotional messages with account statements.
Initial deployment of Miles & Points Tracker.
