/**
 * Phase 0: Security Rules Verification Spec ("Dirty Dozen" Payloads)
 * Intended for execution with @firebase/rules-unit-testing against Firestore Emulator.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  actor: { uid: string; email: string; email_verified: boolean };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unverified Bootstrap Admin Email Spoof',
    actor: { uid: 'spoof-uid', email: 'kalyankundu20@gmail.com', email_verified: false },
    operation: 'get',
    path: '/agencies/agency_main',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self-Assigned Admin Escalation',
    actor: { uid: 'client-1', email: 'client1@example.com', email_verified: true },
    operation: 'create',
    path: '/agencies/agency_main/members/client-1',
    payload: {
      agencyId: 'agency_main',
      uid: 'client-1',
      partyId: 'party_admin_fake',
      role: 'admin',
      parentMasterId: '',
      ownerUid: 'admin-uid',
      accessKey: 'forged_key_1234567890',
      active: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Claim Already-Assigned Party Hijack',
    actor: { uid: 'attacker-uid', email: 'attacker@example.com', email_verified: true },
    operation: 'update',
    path: '/agencies/agency_main/parties/party_sonu',
    payload: { assignedUid: 'attacker-uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Client Rate/Due/Joma Tampering',
    actor: { uid: 'sonu-uid', email: 'sonu@example.com', email_verified: true },
    operation: 'update',
    path: '/agencies/agency_main/parties/party_sonu',
    payload: { due: 0, joma: 999999 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Client Winning Number Forgery',
    actor: { uid: 'sonu-uid', email: 'sonu@example.com', email_verified: true },
    operation: 'update',
    path: '/agencies/agency_main',
    payload: { winning1PM: '1st 12345' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Cross-Party Sheet Theft',
    actor: { uid: 'sonu-uid', email: 'sonu@example.com', email_verified: true },
    operation: 'get',
    path: '/agencies/agency_main/sheets/party_sudeb',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Invite Collection Scraping (list)',
    actor: { uid: 'sonu-uid', email: 'sonu@example.com', email_verified: true },
    operation: 'list',
    path: '/partyInvites',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'PII Blanket Read on PartyPrivate & AdminConfig',
    actor: { uid: 'sonu-uid', email: 'sonu@example.com', email_verified: true },
    operation: 'get',
    path: '/agencies/agency_main/partyPrivate/party_sudeb',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Shadow Field Injection on Sheet Update',
    actor: { uid: 'sonu-uid', email: 'sonu@example.com', email_verified: true },
    operation: 'update',
    path: '/agencies/agency_main/sheets/party_sonu',
    payload: { entries1PM: [], isVerified: true, ownerUid: 'sonu-uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'ID Poisoning & Oversized String Payload',
    actor: { uid: 'sonu-uid', email: 'sonu@example.com', email_verified: true },
    operation: 'create',
    path: '/agencies/agency_main/sheets/bad$id!invalid',
    payload: { partyName: 'X'.repeat(500) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Client-Forged Timestamp Bypass',
    actor: { uid: 'sonu-uid', email: 'sonu@example.com', email_verified: true },
    operation: 'update',
    path: '/agencies/agency_main/sheets/party_sonu',
    payload: { updatedAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Revoked Party Sheet Write',
    actor: { uid: 'revoked-uid', email: 'revoked@example.com', email_verified: true },
    operation: 'update',
    path: '/agencies/agency_main/sheets/party_revoked',
    payload: { entries1PM: [] },
    expected: 'PERMISSION_DENIED',
  },
];
