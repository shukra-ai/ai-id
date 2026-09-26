import { randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { Database, Queryable } from '../shared/database.js';
import { findAccount } from './accounts.js';

type RegistrationResponse = Parameters<typeof verifyRegistrationResponse>[0]['response'];
type AuthenticationResponse = Parameters<typeof verifyAuthenticationResponse>[0]['response'];

interface StoredPasskey {
  credential_id: string;
  account_id: string;
  public_key: string;
  counter: string | number;
  transports: string;
  device_type: string;
  backed_up: boolean;
}

interface StoredChallenge {
  id: string;
  challenge: string;
  account_id: string | null;
  interaction_uid: string | null;
  expires_at: string | number;
}

const CHALLENGE_TTL_SECONDS = 5 * 60;

async function removeExpiredChallenges(database: Database): Promise<void> {
  await database.query(
    'DELETE FROM auth_webauthn_challenges WHERE expires_at <= $1',
    [Math.floor(Date.now() / 1000)],
  );
}

async function storeChallenge(
  database: Database,
  input: {
    kind: 'registration' | 'authentication';
    challenge: string;
    accountId?: string;
    interactionUid?: string;
  },
): Promise<string> {
  await removeExpiredChallenges(database);
  const id = randomUUID();
  await database.query(
    `INSERT INTO auth_webauthn_challenges
       (id, kind, challenge, account_id, interaction_uid, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      input.kind,
      input.challenge,
      input.accountId ?? null,
      input.interactionUid ?? null,
      Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
    ],
  );
  return id;
}

export async function registrationOptions(
  database: Database,
  accountId: string,
  rpId: string,
): Promise<{ challengeId: string; options: Awaited<ReturnType<typeof generateRegistrationOptions>> }> {
  const account = await findAccount(database, accountId);
  if (!account) throw new Error('Compte inconnu.');
  const existing = await database.query<Pick<StoredPasskey, 'credential_id' | 'transports'>>(
    'SELECT credential_id, transports FROM auth_passkeys WHERE account_id = $1',
    [accountId],
  );
  const options = await generateRegistrationOptions({
    rpName: 'AI ID',
    rpID: rpId,
    userID: Buffer.from(account.id, 'utf8'),
    userName: account.email ?? account.id,
    userDisplayName: account.name,
    attestationType: 'none',
    excludeCredentials: existing.rows.map((credential) => ({
      id: credential.credential_id,
      transports: JSON.parse(credential.transports) as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    supportedAlgorithmIDs: [-7, -257],
  });
  return {
    challengeId: await storeChallenge(database, {
      kind: 'registration',
      challenge: options.challenge,
      accountId,
    }),
    options,
  };
}

export async function completeRegistration(
  database: Database,
  input: {
    accountId: string;
    challengeId: string;
    response: RegistrationResponse;
    expectedOrigin: string;
    rpId: string;
  },
): Promise<void> {
  await database.transaction(async (tx) => {
    const challengeResult = await tx.query<StoredChallenge>(
      `SELECT id, challenge, account_id, interaction_uid, expires_at
         FROM auth_webauthn_challenges
        WHERE id = $1 AND kind = 'registration'
        FOR UPDATE`,
      [input.challengeId],
    );
    const stored = challengeResult.rows[0];
    if (!stored || stored.account_id !== input.accountId || Number(stored.expires_at) <= Math.floor(Date.now() / 1000)) {
      throw new Error('Challenge WebAuthn invalide ou expiré.');
    }
    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: stored.challenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.rpId,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('La passkey n’a pas pu être vérifiée.');
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await tx.query(
      `INSERT INTO auth_passkeys
         (credential_id, account_id, public_key, counter, transports, device_type, backed_up)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        credential.id,
        input.accountId,
        Buffer.from(credential.publicKey).toString('base64url'),
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        credentialDeviceType,
        credentialBackedUp,
      ],
    );
    await tx.query('DELETE FROM auth_webauthn_challenges WHERE id = $1', [stored.id]);
  });
}

export async function authenticationOptions(
  database: Database,
  interactionUid: string,
  rpId: string,
): Promise<{ challengeId: string; options: Awaited<ReturnType<typeof generateAuthenticationOptions>> }> {
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: 'required',
    allowCredentials: [],
  });
  return {
    challengeId: await storeChallenge(database, {
      kind: 'authentication',
      challenge: options.challenge,
      interactionUid,
    }),
    options,
  };
}

async function lockedPasskey(tx: Queryable, credentialId: string): Promise<StoredPasskey | undefined> {
  const result = await tx.query<StoredPasskey>(
    `SELECT credential_id, account_id, public_key, counter, transports, device_type, backed_up
       FROM auth_passkeys
      WHERE credential_id = $1
      FOR UPDATE`,
    [credentialId],
  );
  return result.rows[0];
}

export async function completeAuthentication(
  database: Database,
  input: {
    interactionUid: string;
    challengeId: string;
    response: AuthenticationResponse;
    expectedOrigin: string;
    rpId: string;
  },
): Promise<string> {
  return database.transaction(async (tx) => {
    const challengeResult = await tx.query<StoredChallenge>(
      `SELECT id, challenge, account_id, interaction_uid, expires_at
         FROM auth_webauthn_challenges
        WHERE id = $1 AND kind = 'authentication'
        FOR UPDATE`,
      [input.challengeId],
    );
    const challenge = challengeResult.rows[0];
    if (!challenge || challenge.interaction_uid !== input.interactionUid || Number(challenge.expires_at) <= Math.floor(Date.now() / 1000)) {
      throw new Error('Challenge WebAuthn invalide ou expiré.');
    }
    const passkey = await lockedPasskey(tx, input.response.id);
    if (!passkey) throw new Error('Passkey inconnue.');
    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.rpId,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, 'base64url'),
        counter: Number(passkey.counter),
        transports: JSON.parse(passkey.transports) as AuthenticatorTransport[],
      },
      requireUserVerification: true,
    });
    if (!verification.verified) throw new Error('La passkey n’a pas pu être vérifiée.');
    await tx.query(
      'UPDATE auth_passkeys SET counter = $2 WHERE credential_id = $1',
      [passkey.credential_id, verification.authenticationInfo.newCounter],
    );
    await tx.query('DELETE FROM auth_webauthn_challenges WHERE id = $1', [challenge.id]);
    return passkey.account_id;
  });
}
