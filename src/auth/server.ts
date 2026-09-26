import express, { type Request, type Response, type NextFunction } from 'express';
import Provider, { type Configuration } from 'oidc-provider';
import { z } from 'zod';
import type { RuntimeConfig } from '../shared/config.js';
import { createDatabase } from '../shared/database.js';
import { initializeAuthSchema } from './schema.js';
import { createOidcAdapter } from './adapter.js';
import { loadDevelopmentJwks } from './keys.js';
import { claimsForAccount, findAccount, createLocalAccount, authenticatePassword } from './accounts.js';
import { FederationBroker } from './federation.js';
import { issueCsrfToken, requireCsrf, requireSameOrigin, FixedWindowRateLimiter, pairwiseSubject, setEnrollmentSession, enrollmentAccount } from './security.js';
import { renderLogin, renderConsent, renderRegistration, renderRegistrationComplete, renderPasskeyEnrollment, renderError, sendHtml } from './pages.js';
import { registrationOptions, authenticationOptions, completeRegistration, completeAuthentication } from './passkeys.js';

export async function buildAuth(config: RuntimeConfig) {
  if (config.production) throw new Error('Local pilot only. Remote signing and production isolation are not implemented.');
  const db = await createDatabase('auth', config);
  await initializeAuthSchema(db);
  const settings: Configuration = {
    adapter: createOidcAdapter(db),
    jwks: await loadDevelopmentJwks(config),
    clients: [{
      client_id: 'aiid-dashboard', client_secret: config.oidcClientSecret,
      redirect_uris: [`${config.coreOrigin}/auth/callback`],
      post_logout_redirect_uris: [config.coreOrigin + '/'],
      response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'client_secret_post', subject_type: 'pairwise',
    }],
    cookies: {
      keys: [config.cookieSecret],
      names: { session: 'aiid_sso', interaction: 'aiid_interaction', resume: 'aiid_resume' },
      short: { httpOnly: true, sameSite: 'lax', secure: false, path: '/' },
      long: { httpOnly: true, sameSite: 'lax', secure: false },
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    features: {
      devInteractions: { enabled: false },
      introspection: { enabled: true, allowedPolicy: (_ctx, client, token) => client.clientId === 'aiid-dashboard' && token.clientId === client.clientId },
      revocation: { enabled: true, allowedPolicy: (_ctx, client, token) => client.clientId === 'aiid-dashboard' && token.clientId === client.clientId },
      rpInitiatedLogout: { enabled: true, logoutSource: (ctx, form) => {
        ctx.cookies.set('aiid_enrollment', null, { path: '/passkeys' });
        ctx.type = 'html';
        ctx.body = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Déconnexion AI ID</title><h1>Terminer la session AI ID</h1><p>La session de la console a été révoquée. Confirmez la fin de la session SSO.</p>${form}<button type="submit" form="op.logoutForm" value="yes" name="logout">Confirmer la déconnexion</button></html>`;
      } },
    },
    pkce: { required: () => true },
    subjectTypes: ['pairwise'],
    pairwiseIdentifier: (_ctx, accountId, client) => pairwiseSubject(config.cookieSecret, String(client.sectorIdentifier), accountId),
    claims: { openid: ['sub'], profile: ['name', 'domain_id', 'domain_name'], email: ['email', 'email_verified'] },
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    ttl: { AccessToken: 300, IdToken: 300, AuthorizationCode: 60, RefreshToken: 28800, Session: 28800, Interaction: 600, Grant: 28800 },
    rotateRefreshToken: true,
    async findAccount(_ctx, id) {
      const account = await findAccount(db, id);
      if (!account) return undefined;
      return { accountId: id, claims: async () => ({ ...claimsForAccount(account) }) };
    },
  };
  const provider = new Provider(config.issuer, settings);
  const broker = FederationBroker.fromEnvironment(db, config);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.get('host') !== new URL(config.issuer).host) { res.status(400).json({ error: 'invalid_host' }); return; }
    next();
  });
  // Do not parse provider protocol bodies: oidc-provider must own those streams.
  const parse = [express.urlencoded({ extended: false, limit: '32kb' }), express.json({ limit: '32kb' })];
  const limit = new FixedWindowRateLimiter(30).middleware('interactive-auth');
  const protect = [...parse, requireSameOrigin(config), requireCsrf(config), limit];
  const page = (res: Response, value: { html: string; nonce: string }, status = 200) => sendHtml(res, status, value.html, value.nonce, config.coreOrigin);
  const details = async (req: Request, res: Response, name?: string) => {
    const current = await provider.interactionDetails(req, res);
    const uid = req.params.uid ?? req.body?.uid;
    if (uid !== current.uid || (name && current.prompt.name !== name)) throw new Error('Invalid interaction');
    return current;
  };
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'auth', mode: 'local-pilot' }));
  app.get('/', (_req, res) => res.redirect(config.coreOrigin));
  app.get('/interaction/:uid', async (req, res) => {
    const current = await details(req, res);
    const csrf = issueCsrfToken(req, res, config);
    if (current.prompt.name === 'login') page(res, renderLogin(current.uid, csrf, broker.providers));
    else if (current.prompt.name === 'consent') page(res, renderConsent(current.uid, csrf));
    else throw new Error('Unsupported prompt');
  });
  app.post('/interaction/:uid/login', protect, async (req: Request, res: Response) => {
    const current = await details(req, res, 'login');
    const body = z.object({ domain_id: z.string(), email: z.string(), password: z.string().max(1024) }).parse(req.body);
    const account = await authenticatePassword(db, body.domain_id, body.email, body.password);
    if (!account) { page(res, renderLogin(current.uid, issueCsrfToken(req, res, config), broker.providers, 'Identifiants invalides.'), 401); return; }
    setEnrollmentSession(res, config, account.id);
    await provider.interactionFinished(req, res, { login: { accountId: account.id, amr: ['pwd'] } }, { mergeWithLastSubmission: false });
  });
  app.post('/interaction/:uid/confirm', protect, async (req: Request, res: Response) => {
    const current = await details(req, res, 'consent');
    if (current.params.client_id !== 'aiid-dashboard') throw new Error('Unknown client');
    const grant = current.grantId ? await provider.Grant.find(current.grantId) : new provider.Grant({ accountId: current.session!.accountId!, clientId: 'aiid-dashboard' });
    if (!grant) throw new Error('Grant not found');
    const missing = current.prompt.details.missingOIDCScope as string[] | undefined;
    if (missing?.length) grant.addOIDCScope(missing.join(' '));
    const claims = current.prompt.details.missingOIDCClaims as string[] | undefined;
    if (claims?.length) grant.addOIDCClaims(claims);
    const grantId = await grant.save();
    await provider.interactionFinished(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true });
  });
  app.post('/interaction/:uid/abort', protect, async (req: Request, res: Response) => {
    await details(req, res);
    await provider.interactionFinished(req, res, { error: 'access_denied', error_description: 'Consent refused' }, { mergeWithLastSubmission: false });
  });
  app.get('/register', (req, res) => page(res, renderRegistration(typeof req.query.uid === 'string' ? req.query.uid : undefined, issueCsrfToken(req, res, config))));
  app.post('/register', protect, async (req: Request, res: Response) => {
    const body = z.object({ domain_name: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(120), email: z.email(), password: z.string().min(12).max(1024), uid: z.string().optional() }).parse(req.body);
    if (body.uid) await details(req, res, 'login');
    const account = await createLocalAccount(db, { domainName: body.domain_name, name: body.name, email: body.email, password: body.password });
    setEnrollmentSession(res, config, account.id);
    if (body.uid) await provider.interactionFinished(req, res, { login: { accountId: account.id, amr: ['pwd'] } }, { mergeWithLastSubmission: false });
    else page(res, renderRegistrationComplete(account.domain_id), 201);
  });
  const enrolled = (req: Request) => {
    const account = enrollmentAccount(req, config);
    if (!account) throw new Error('A recent password authentication is required to enroll a passkey.');
    return account;
  };
  const rpId = new URL(config.issuer).hostname;
  app.get('/passkeys/enroll', (req, res) => { enrolled(req); page(res, renderPasskeyEnrollment(issueCsrfToken(req, res, config))); });
  app.post('/passkeys/registration/options', protect, async (req: Request, res: Response) => res.json(await registrationOptions(db, enrolled(req), rpId)));
  app.post('/passkeys/registration/verify', protect, async (req: Request, res: Response) => {
    await completeRegistration(db, { accountId: enrolled(req), challengeId: z.string().uuid().parse(req.body.challenge_id), response: req.body.credential, expectedOrigin: config.issuer, rpId });
    res.json({ verified: true });
  });
  app.post('/passkeys/authentication/options', protect, async (req: Request, res: Response) => {
    const current = await details(req, res, 'login');
    res.json(await authenticationOptions(db, current.uid, rpId));
  });
  app.post('/passkeys/authentication/verify', protect, async (req: Request, res: Response) => {
    const current = await details(req, res, 'login');
    const accountId = await completeAuthentication(db, { interactionUid: current.uid, challengeId: z.string().uuid().parse(req.body.challenge_id), response: JSON.parse(z.string().max(20000).parse(req.body.credential)), expectedOrigin: config.issuer, rpId });
    await provider.interactionFinished(req, res, { login: { accountId, amr: ['webauthn'] } }, { mergeWithLastSubmission: false });
  });
  app.get('/federation/:providerId/start', limit, (req, res) => broker.start(req, res, provider));
  app.get('/federation/:providerId/callback', limit, (req, res) => broker.callback(req, res, provider));
  app.use(provider.callback());
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Do not send library errors, claims, credentials, or tokens to the browser/logs.
    if (res.headersSent) { res.end(); return; }
    page(res, renderError(400, error instanceof z.ZodError ? 'Paramètres invalides.' : 'Demande invalide ou expirée. Recommencez la connexion.'), 400);
  });
  return { app, provider, db };
}
