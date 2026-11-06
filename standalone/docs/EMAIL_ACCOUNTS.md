# Independent Archindus email accounts

Supabase project: `tgezmnvwdatzgmwitwkm` (Archindus), organization Architect Industries, region US East.

The application provides `/auth` email/password signup, sign-in, password recovery, password update and sign-out. Guest chat remains public. Supabase handles password storage and email verification. All session tokens stay in HttpOnly, Secure (HTTPS), SameSite=Lax cookies; they are not returned in the application's JSON or stored in browser local storage. Identity-dependent API routes validate the user with Supabase `getUser()`, not a client-supplied user object or unverified JWT. Expired sessions refresh via the official SSR helper and write updated cookies to the response.

Existing profile, history, memory, personalities and provider credentials remain in the existing D1 database. Email account IDs are namespaced as `email:<project-ref>:<user-uuid>`; existing ChatGPT identities remain separate. Matching email addresses never automatically merge identities or expose old account data. Existing ChatGPT-linked accounts retain a secondary sign-in option. “Delete Archindus account data” deletes application data and does not delete the external sign-in identity.

## Production activation remaining

The Supabase project and Site runtime URL/publishable key are configured. Public email signup and recovery are deliberately off until the sender and redirect settings below are configured and verified. There is no unverified-email fallback.

1. In [Supabase Authentication URL configuration](https://supabase.com/dashboard/project/tgezmnvwdatzgmwitwkm/auth/url-configuration), set Site URL to `https://archindus.stevenscadet.chatgpt.site`. Allow `https://archindus.stevenscadet.chatgpt.site/auth/confirm` and `https://archindus.stevenscadet.chatgpt.site/auth/confirm?next=reset`. Add exact URLs for future custom domains only when those domains serve this application. Avoid broad production redirect wildcards.
2. In [SMTP settings](https://supabase.com/dashboard/project/tgezmnvwdatzgmwitwkm/auth/smtp), configure a transactional email sender with a verified sender address/domain. Supply SMTP host, port, username and password directly in Supabase, not chat, GitHub or client source. Supabase's default sender only serves project-team addresses and is unsuitable for public signup. Keep Confirm Email enabled and email/password authentication enabled. Keep the default confirmation/recovery templates compatible with the PKCE code callback; don't replace the callback with an implicit-token fragment flow.
3. Set an appropriate Supabase Auth password policy (the application requires at least 12 characters for new passwords) and production rate limits. Supabase Auth's server-side limits still apply. Add CAPTCHA protection when needed for public enrollment; do not disable verification to work around mail delivery problems.
4. Test actual signup, confirmation in the browser where signup started, sign-in, password reset, and sign-out with a mailbox you control. A code callback without its matching browser verifier must fail. Verification/reset links can fail if opened in another browser. Do not log passwords, tokens or email-link codes.
5. After those settings are ready, set Site runtime `ARCHINDUS_EMAIL_SIGNUP_ENABLED=true` and redeploy the saved version. The current form reads availability from `/api/auth/status`; there is no client-side toggle that bypasses the server flag. No new source changes are needed for activation.

Available Supabase connector tools do not expose Auth SMTP or URL configuration updates, and no SMTP credential is connected to this session. These two settings therefore require a Supabase Dashboard change by the operator. Connecting Supabase grants project/database access; it does not provide a transactional-email sender account.

## Validation

Automated tests cover origin/body validation, verification gating, secure cookie flags, no token disclosure in application JSON, server-side identity verification, guest access without Auth calls, failed-token rejection, callback redirect restrictions and sign-out. These controlled tests do not establish real inbox delivery. Production delivery is a separate activation check.
