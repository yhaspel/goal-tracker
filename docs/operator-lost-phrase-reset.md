# Operator runbook — rescuing someone who lost their recovery phrase

This is the only way back into an account when both the password and the recovery phrase are
gone. It requires access to the Cloudflare account, because the rescue token is inserted
directly into SQL through [Durable Object Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/).
Being the owner inside the app is not enough, and there is deliberately no email reset.

The procedure never reveals or restores an old password or phrase. It issues a one-time,
15-minute token that lets the person set a **new** password and receive a **new** phrase.

If you lose both the phrase and Cloudflare access, there is no fallback. Restore operator
access first.

## 1. Verify the person offline

An email address proves nothing here: the application never verifies mailbox ownership. Confirm
the person through a channel you already trust — in person, a known phone number, or a video
call where you recognise them. Write down which channel you used; you will record it as the
audit reason in step 3.

Never accept a reset request that arrives only as a message from the address being reset.

## 2. Find the account

Open Data Studio for the **correct environment's** Durable Object. `family-board-test`,
`family-board-production`, and `family-board-restore` have separate namespaces; check the
Worker name before typing anything.

The join against `allowed_emails` matters: an address the owner has removed is not eligible for
recovery, and issuing a token for one would waste the person's time.

```sql
SELECT u.id, u.email_norm, u.status, u.credential_epoch
FROM users u
JOIN allowed_emails a ON a.email_norm = u.email_norm
WHERE u.email_norm = 'person@example.test';
```

Expect exactly one row with `status = 'active'`. Record `id` and `credential_epoch`.

- **No row:** either the address is unknown or the owner has removed it from the allowed list.
  Ask the owner to re-add the address first, then start again.
- **`status = 'inactive'`:** the account was deactivated and cannot be recovered. Deactivation
  is irreversible in this release; the owner invites a new account instead.

## 3. Generate the token

Run this on a trusted local machine from a checkout of this repository. It needs the
environment's `RECOVERY_DIGEST_KEY`, which lives in your separate secret escrow — the same
value Cloudflare holds as a Worker secret. Pipe it in so it never lands in a command line or a
shell history entry; the script never prints it.

```sh
umask 077
node scripts/create-operator-reset-token.ts \
  --user-id <id from step 2> \
  --epoch <credential_epoch from step 2> \
  --operator "<who you are>" \
  --reason "<how you verified them, no secrets>" \
  < /path/to/recovery-digest-key
```

The script prints the raw token once and then the exact `INSERT` to run. Only the token's
HMAC digest appears in that statement. `--operator` and `--reason` are stored as plain audit
text, so keep them short and put nothing sensitive in them.

Pinning `expected_credential_epoch` is what makes the token single-purpose: if the person
recovers another way, or the owner rotates anything first, the epoch moves and this token stops
working instead of silently reversing that change.

## 4. Insert and confirm the row

Paste the generated `INSERT` into Data Studio, then run the generated `SELECT` to confirm
**exactly one** row exists with the id the script printed. If the insert reports more than one
row affected, or the select returns anything other than one row, stop and revoke (step 6)
before continuing.

Any value you type by hand must be wrapped in single quotes, with any internal single quote
doubled (`O'Brien` becomes `'O''Brien'`). Prefer the generated statement over retyping.

## 5. Hand over the token and let them redeem it

Send the raw token through the **same offline channel** you verified in step 1. Never paste it
into a shared document, a ticket, or a chat log that others can read.

In the app, the person opens the manual recovery screen and supplies their email address, the
token, and a new password. The application then shows a new 12-word phrase once and asks them
to re-enter it. Only that confirmation commits the change: it consumes the token, sets the new
password and phrase, advances the credential epoch, and revokes every session. They sign in
afterwards with the new password.

If they close the screen before re-entering the phrase, nothing has changed and the token is
still unconsumed. They can restart while it is valid.

The token expires 15 minutes after step 3. If it lapses, repeat steps 2 to 5 to generate a
fresh one; re-read `credential_epoch`, because a completed recovery will have advanced it.

## 6. Revoke a token you no longer want honoured

Revocation removes an unredeemed token. Redeemed rows are left alone so their `consumed_at`
stays available for audit.

```sql
DELETE FROM operator_reset_tokens
WHERE id = '<id the script printed>' AND consumed_at IS NULL;
```

The owner removing that address from the allowed list has the same effect and also ends the
person's sessions and any rotation in flight.

## 7. Record the outcome

After the person confirms, check the audit trail and note the result alongside your own records.

```sql
SELECT id, user_id, expected_credential_epoch, created_at, expires_at, consumed_at, issued_by, reason
FROM operator_reset_tokens
WHERE user_id = '<id from step 2>'
ORDER BY created_at DESC;
```

Record the token row id, who you verified and how, the date, and whether `consumed_at` is set.
Do **not** record the token itself, the new password, or the new phrase — you never see the
last two, and you should not keep the first.

## What this procedure cannot do

- It cannot reveal an old password or phrase. Neither is stored in a recoverable form.
- It cannot revive a deactivated account or an address the owner has removed.
- It cannot be performed from inside the application by the owner role alone.
- It sends no email at any point.
