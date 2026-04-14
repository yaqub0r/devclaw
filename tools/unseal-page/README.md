# unseal-page

Minimal one-time password prompt page for boot unseal.

Current behavior:
- shows a random emoticon challenge
- accepts a one-time token plus password POST
- writes submitted password to `state/unseal/boot-secret.txt`
- marks status as `submitted`

This is v1 plumbing only. It does not yet perform the actual LastPass or vault unlock.
