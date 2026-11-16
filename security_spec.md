# AegisQuant Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity Isolation**: Every user document `/users/{userId}` and subcollection document (`private`, `strategies`, `analyses`, `auditLogs`) can ONLY be read or written by the authenticated owner (`request.auth.uid == userId`) with verified email (`request.auth.token.email_verified == true`).
2. **PII & 2FA Vault Isolation**: Email addresses, encrypted TOTP secrets, and SHA-256 backup code hashes live exclusively inside `/users/{userId}/private/security` and are inaccessible to any other user or unverified session.
3. **Weekly Quota Integrity**: `weeklyQuota` must always equal `10` on free plans; `creditsRemaining` must stay within `0..100` and cannot be modified via shadow fields.
4. **PRO Daily Signal Cap**: `dailySignalLimit` on strategies is bounded strictly between `1` and `20`. Free accounts cannot set `dailySignalLimit > 1` on Firestore writes (enforced via parent document `get()` check on `/users/{userId}`).
5. **Immutable Audit Trail**: Documents in `auditLogs` and `analyses` cannot be modified after creation (`allow update: if false;`) to prevent tampering with security logs or historical signals.
6. **Temporal Integrity**: `createdAt` and `updatedAt` must strictly equal `request.time`; `createdAt` and `uid`/`userId` are immutable on updates.

## 2. "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: `GET /users/victim123` with `auth == null` -> DENIED.
2. **Cross-User PII Read**: `GET /users/victim123/private/security` with `auth.uid == "attacker456"` -> DENIED.
3. **Unverified Email Write**: `CREATE /users/user123` with `email_verified: false` -> DENIED.
4. **UID Spoofing**: `CREATE /users/user123` with payload `{ uid: "admin999", ... }` while `auth.uid == "user123"` -> DENIED.
5. **Shadow Ghost Field**: `UPDATE /users/user123` with `{ creditsRemaining: 9, isAdmin: true }` -> DENIED (`hasOnly()` blocks `isAdmin`).
6. **Negative / Infinite Credit Injection**: `UPDATE /users/user123` with `{ creditsRemaining: 999999 }` -> DENIED (`<= 100` bound).
7. **Free Plan Signal Limit Bypass**: `CREATE /users/freeUser/strategies/s1` with `{ dailySignalLimit: 20 }` while parent `users/freeUser.plan == "free"` -> DENIED.
8. **ID Poisoning**: `CREATE /users/user123/strategies/<2KB string>` -> DENIED (`isValidId` regex & 64/128 char cap).
9. **Audit Log Tampering**: `UPDATE /users/user123/auditLogs/log1` -> DENIED (`allow update: if false`).
10. **Client Timestamp Forgery**: `CREATE /users/user123/analyses/a1` with `createdAt: "2020-01-01T00:00:00Z"` -> DENIED (`createdAt == request.time`).
11. **Unbounded Array Exhaustion**: `UPDATE /users/user123/private/security` with 500 `backupCodeHashes` -> DENIED (`size() <= 8`).
12. **Blanket List Query Scraping**: `LIST /users` or `LIST /users/victim123/strategies` -> DENIED.
