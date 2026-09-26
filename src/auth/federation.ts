import type { Request, Response } from 'express';
import {
  ClientSecretBasic,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from 'openid-client';
import { z } from 'zod';
import type { RuntimeConfig } from '../shared/config.js';
import type { Database, Queryable } from '../shared/database.js';
import { createFederatedAccount, findFederatedAccount } from './accounts.js';

const providerSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/u),
  label: z.string().trim().min(1).max(80).optional(),
  issuer: z.url(),
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(4096),
  scopes: z.string().min(1).max(512).optional(),
}).strict();

export interface FederationProviderConfig {
  id: string;
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

interface StoredFederationFlow {
  state: string;
  provider_id: string;
  issuer: string;
  nonce: string;
  pkce_verifier: string;
  interaction_uid: string;
  expires_at: string | number;
}

export interface InteractionProvider {
  interactionDetails(req: Request, res: Response): Promise<{
    uid: string;
    prompt: { name: string };
  }>;
  interactionFinished(
    req: Request,
    res: Response,
    result: { login: { accountId: string; amr: string[] } },
    options: { mergeWithLastSubmission: boolean },
  ): Promise<void>;
}

const FLOW_TTL_SECONDS = 10 * 60;

function canonicalIssuer(value: string, production: boolean): string {
  const url = new URL(value);
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('A federated issuer must be an exact issuer URL.');
  }
  if (production && url.protocol !== 'https:') {
    throw new Error('Federated issuers must use HTTPS in production.');
  }
  if (!production && url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new Error('Development HTTP federation is restricted to localhost.');
  }
  return value; // Issuer comparisons are exact, including a trailing slash.
}

/**
 * The environment variable is an explicit allowlist, not dynamic discovery
 * driven by user input. Secrets never enter a browser URL or the database.
 */
export function loadFederationProviders(
  production: boolean,
  encoded = process.env.AIID_FEDERATED_OIDC_PROVIDERS,
): FederationProviderConfig[] {
  if (!encoded) return [];
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error('AIID_FEDERATED_OIDC_PROVIDERS must be valid JSON.');
  }
  if (!Array.isArray(value)) throw new Error('AIID_FEDERATED_OIDC_PROVIDERS must be an array.');
  const providers = value.map((entry) => {
    const parsed = providerSchema.parse(entry);
    const scopes = new Set((parsed.scopes ?? 'openid profile email').split(/\s+/u).filter(Boolean));
    if (!scopes.has('openid')) throw new Error(`Federation provider ${parsed.id} must request openid.`);
    return {
      ...parsed,
      label: parsed.label ?? parsed.id,
      issuer: canonicalIssuer(parsed.issuer, production),
      scopes: [...scopes].join(' '),
    };
  });
  if (new Set(providers.map(({ id }) => id)).size !== providers.length) {
    throw new Error('Federation provider ids must be unique.');
  }
  if (new Set(providers.map(({ issuer }) => issuer)).size !== providers.length) {
    throw new Error('Each federated issuer may appear only once.');
  }
  return providers;
}

function callbackUrl(config: RuntimeConfig, provider: FederationProviderConfig): string {
  return `${config.issuer}/federation/${encodeURIComponent(provider.id)}/callback`;
}

async function consumeFlow(database: Database, state: string): Promise<StoredFederationFlow | undefined> {
  return database.transaction(async (tx) => {
    const result = await tx.query<StoredFederationFlow>(
      `SELECT state, provider_id, issuer, nonce, pkce_verifier, interaction_uid, expires_at
         FROM auth_federation_flows
        WHERE state = $1
        FOR UPDATE`,
      [state],
    );
    const flow = result.rows[0];
    if (flow) await tx.query('DELETE FROM auth_federation_flows WHERE state = $1', [state]);
    return flow;
  });
}

async function storeFlow(
  tx: Queryable,
  provider: FederationProviderConfig,
  input: { state: string; nonce: string; verifier: string; interactionUid: string },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await tx.query('DELETE FROM auth_federation_flows WHERE expires_at <= $1', [now]);
  await tx.query(
    `INSERT INTO auth_federation_flows
       (state, provider_id, issuer, nonce, pkce_verifier, interaction_uid, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.state,
      provider.id,
      provider.issuer,
      input.nonce,
      input.verifier,
      input.interactionUid,
      now + FLOW_TTL_SECONDS,
    ],
  );
}

export class FederationBroker {
  private readonly byId: Map<string, FederationProviderConfig>;
  private readonly discovered = new Map<string, Promise<Configuration>>();

  public constructor(
    private readonly database: Database,
    private readonly config: RuntimeConfig,
    public readonly providers: FederationProviderConfig[],
  ) {
    this.byId = new Map(providers.map((provider) => [provider.id, provider]));
  }

  public static fromEnvironment(database: Database, config: RuntimeConfig): FederationBroker {
    return new FederationBroker(database, config, loadFederationProviders(config.production));
  }

  private configuration(provider: FederationProviderConfig): Promise<Configuration> {
    let pending = this.discovered.get(provider.id);
    if (!pending) {
      pending = discovery(
        new URL(provider.issuer),
        provider.clientId,
        {
          client_secret: provider.clientSecret,
          redirect_uris: [callbackUrl(this.config, provider)],
          token_endpoint_auth_method: 'client_secret_basic',
        },
        ClientSecretBasic(provider.clientSecret),
        { timeout: 5, ...(provider.issuer.startsWith('http://localhost') ? { execute: [allowInsecureRequests] } : {}) },
      );
      this.discovered.set(provider.id, pending);
      pending.catch(() => this.discovered.delete(provider.id));
    }
    return pending;
  }

  public async start(req: Request, res: Response, oidc: InteractionProvider): Promise<void> {
    const provider = this.byId.get(String(req.params.providerId ?? ''));
    if (!provider) {
      res.status(404).json({ error: 'unknown_federation_provider' });
      return;
    }
    const uid = typeof req.query.uid === 'string' ? req.query.uid : '';
    const interaction = await oidc.interactionDetails(req, res);
    if (!uid || interaction.uid !== uid || interaction.prompt.name !== 'login') {
      res.status(400).json({ error: 'invalid_interaction' });
      return;
    }
    const upstream = await this.configuration(provider);
    const state = randomState();
    const nonce = randomNonce();
    const verifier = randomPKCECodeVerifier();
    const challenge = await calculatePKCECodeChallenge(verifier);
    await this.database.transaction((tx) => storeFlow(tx, provider, {
      state,
      nonce,
      verifier,
      interactionUid: uid,
    }));
    const authorization = buildAuthorizationUrl(upstream, {
      redirect_uri: callbackUrl(this.config, provider),
      scope: provider.scopes,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    res.redirect(303, authorization.href);
  }

  public async callback(req: Request, res: Response, oidc: InteractionProvider): Promise<void> {
    const provider = this.byId.get(String(req.params.providerId ?? ''));
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!provider || !state) {
      res.status(400).json({ error: 'invalid_federation_callback' });
      return;
    }
    const flow = await consumeFlow(this.database, state);
    if (
      !flow
      || flow.provider_id !== provider.id
      || flow.issuer !== provider.issuer
      || Number(flow.expires_at) <= Math.floor(Date.now() / 1000)
    ) {
      res.status(400).json({ error: 'invalid_or_expired_federation_state' });
      return;
    }
    const interaction = await oidc.interactionDetails(req, res);
    if (interaction.uid !== flow.interaction_uid || interaction.prompt.name !== 'login') {
      res.status(400).json({ error: 'invalid_interaction' });
      return;
    }
    const upstream = await this.configuration(provider);
    const tokens = await authorizationCodeGrant(
      upstream,
      new URL(req.originalUrl, this.config.issuer),
      {
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        pkceCodeVerifier: flow.pkce_verifier,
      },
    );
    const claims = tokens.claims();
    if (!claims || typeof claims.sub !== 'string' || claims.iss !== provider.issuer) {
      throw new Error('Federated ID token has no valid issuer/subject binding.');
    }

    // Only the issuer/subject tuple can resolve an account. Email is metadata,
    // never an account key. It is retained only when the upstream asserted it
    // as verified, preventing us from upgrading an unverified address.
    let account = await findFederatedAccount(this.database, provider.issuer, claims.sub);
    if (!account) {
      account = await createFederatedAccount(this.database, {
        providerId: provider.id,
        issuer: provider.issuer,
        subject: claims.sub,
        ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
        ...(claims.email_verified === true && typeof claims.email === 'string'
          ? { email: claims.email }
          : {}),
      });
    }
    await oidc.interactionFinished(
      req,
      res,
      { login: { accountId: account.id, amr: ['federated'] } },
      { mergeWithLastSubmission: false },
    );
  }
}
