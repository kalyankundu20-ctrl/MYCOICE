# KK Agency Multi-Role Security Specification (Phase 0)

## 1. Data Invariants
1. **Master Gate & Instant Revocation**: A party member (Client or Master) can only read the agency's winning numbers or read/write their own sheet if BOTH `/agencies/{agencyId}/members/{uid}.active == true` AND `/agencies/{agencyId}/parties/{partyId}.active == true`. Revoking a party immediately cuts off all read/write access.
2. **Strict Role Isolation**:
   - **Client** (`role == 'client'`) can ONLY read/write their own `/agencies/{agencyId}/sheets/{partyId}` and read their own `/agencies/{agencyId}/parties/{partyId}` (read-only financial fields `rate`, `due`, `joma`) plus `/agencies/{agencyId}` (winning numbers & date).
   - **Client** can NEVER modify `rate`, `due`, `joma`, `role`, `active`, `winning1PM`, `winning6PM`, or `winning8PM`.
   - **Master** (`role == 'master'`) can ONLY read/manage sub-clients where `parentMasterUid == request.auth.uid`, create `client` invites under themselves, and edit their own and their sub-clients' sheets. Master can NEVER edit official winning numbers or view unrelated parties.
   - **Admin** (`ownerUid`, `kalyankundu20@gmail.com` verified bootstrap admin, or active `admin` member) has full agency visibility across all parties, sheets, winning numbers, and archives.
3. **Atomic Invite Claiming**: A user cannot self-assign `role: 'admin'` or hijack another party. Creating `/agencies/{agencyId}/members/{uid}` MUST match an active `/partyInvites/{accessKey}` document and atomically claim `/agencies/{agencyId}/parties/{partyId}` in the same write batch (`getAfter`).
4. **PII Isolation**: Phone numbers (`whatsappNumber`, `mobile`) and `assignedEmail` live exclusively in `/agencies/{agencyId}/private/{configId}` and `/agencies/{agencyId}/partyPrivate/{partyId}`, strictly blocked from Clients and unrelated users.
5. **Verified Users & Server Timestamps**: Every operation requires `request.auth != null && request.auth.token.email_verified == true`. All `createdAt`/`updatedAt` timestamps must strictly equal `request.time`.
6. **Zero-Trust List Queries**: Every `allow list` rule evaluates `resource.data` directly (`ownerUid`, `adminUids`, `assignedUid`, `parentMasterUid`) with zero `get()`/`exists()` lookups inside `allow list`. `/partyInvites` forbids `list` completely.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)

1. **Unverified Admin Email Spoof**: Request with `email: 'kalyankundu20@gmail.com'` and `email_verified: false` reading `/agencies/ag1`.
2. **Self-Assigned Admin Escalation**: Client creates `/agencies/ag1/members/clientUid` with `{ role: 'admin', active: true }` without a matching valid admin invite.
3. **Party Hijack**: Attacker attempts to claim `/agencies/ag1/parties/sonu` when `assignedUid` is already bound to another user.
4. **Client Rate/Due Tampering**: Client updates `/agencies/ag1/parties/sonu` with `{ due: 0, joma: 500000 }`.
5. **Client Winning Number Forgery**: Client updates `/agencies/ag1` with `{ winning1PM: '12345' }`.
6. **Cross-Party Sheet Theft**: Client A attempts `get` or `update` on Client B's `/agencies/ag1/sheets/partyB`.
7. **Invite Enumeration Scraping**: Authenticated user runs `list` on `/partyInvites` to scrape secret invite keys.
8. **PII Blanket Read**: Client attempts `get` on `/agencies/ag1/partyPrivate/partyB` or `/agencies/ag1/private/adminConfig`.
9. **Shadow Field Injection**: Client updates `/agencies/ag1/sheets/sonu` including an extra ghost field `{ isVerified: true }` or `{ ownerUid: 'attacker' }`.
10. **ID Poisoning / Oversized Payload**: User creates `/agencies/ag1/sheets/../../../bad!id` or passes a 500-char `partyName` or >500 entries array.
11. **Timestamp Forgery**: User creates or updates a sheet with a client-forged `updatedAt` timestamp instead of `request.time`.
12. **Revoked Party Write**: A party whose `active` was set to `false` attempts to update `/agencies/ag1/sheets/sonu` or read `/agencies/ag1`.
