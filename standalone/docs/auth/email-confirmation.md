# Email confirmation

Existing PKCE links remain supported. An exchange requires the original verifier cookie. The first reported callback had no Cookie header, and later callbacks contained otp_expired. This does not establish whether an email preview, a different browser context, or another client opened the first link. The old UI incorrectly prescribed the same-browser workaround for every failure.

The callback now distinguishes expired/used links, missing verifier context, and service errors. The account page includes resend-confirmation; it creates a fresh PKCE challenge using the pinned SDK. Account forms rendered inside an embedded forwarding page require a top-level account page before submitting. Remaining sign-in links also target the top-level page.

## Token-hash template activation

The new handler also accepts Supabase token-hash links. Configure the Confirm signup email template in Supabase to use this exact application URL, rather than ConfirmationURL:

```html
<h2>Confirm your Archindus email</h2>
<p><a href="https://archindus.stevenscadet.chatgpt.site/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">Confirm email</a></p>
<p>If you did not request an Archindus account, ignore this email.</p>
```

For Reset password, the same link uses type=recovery. No template activation is implied by deploying code; provider settings require separate dashboard access. Existing links continue using PKCE until the template changes.

GET stages the token in a Secure, HttpOnly, SameSite=Lax, host-only cookie, restricted to /api/auth/confirm for ten minutes, and redirects to a clean URL with no token. It does not exchange the token or mark an email confirmed. A visible confirmation button sends an empty, strictly validated same-origin JSON POST. Supabase verifies the token, and the server sets session cookies and clears the pending token. Allowed types are email/signup and recovery; redirects are fixed same-origin destinations. Guest account metadata never authorizes access.

No verification is bypassed. Tests use synthetic sessions and cover PKCE exchange, missing cookies, token-hash staging without exchange on GET, successful POST without a signup cookie, recovery destinations, invalid types, cross-origin denial, resend routing, expiry messages and no token output. A genuine end-to-end inbox confirmation still requires a fresh real email after the provider template is configured.
