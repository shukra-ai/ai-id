import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { escapeHtml } from './security.js';

export interface FederationLink {
  id: string;
  label: string;
}

function shell(title: string, body: string, nonce?: string, script = ''): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · AI ID</title>
  <style${nonce ? ` nonce="${nonce}"` : ''}>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101114; color: #f4f4f5; }
    main { width: min(31rem, calc(100% - 2rem)); padding: 2rem; border: 1px solid #34363c; border-radius: 1rem; background: #181a1f; box-sizing: border-box; }
    h1 { margin-top: 0; font-size: 1.55rem; } p { color: #b9bdc7; line-height: 1.5; }
    label { display: grid; gap: .4rem; margin: 1rem 0; font-weight: 600; }
    input, button, .button { box-sizing: border-box; width: 100%; padding: .75rem .85rem; border-radius: .55rem; border: 1px solid #484b55; font: inherit; }
    input { background: #111216; color: #fff; } button, .button { display: block; background: #f4f4f5; color: #111; font-weight: 700; cursor: pointer; text-align: center; text-decoration: none; }
    .secondary { margin-top: .75rem; background: transparent; color: #f4f4f5; }
    .provider { margin-top: .6rem; } hr { border: 0; border-top: 1px solid #34363c; margin: 1.5rem 0; }
    code { overflow-wrap: anywhere; } .error { color: #ffb4ab; }
  </style>
</head>
<body><main>${body}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body>
</html>`;
}

export function sendHtml(res: Response, status: number, html: string, nonce?: string, callbackOrigin?: string): void {
  res.status(status);
  res.setHeader('Cache-Control', 'no-store');
  // no-referrer makes HTML form POST Origin opaque (null) in browsers.
  // same-origin retains our strict Origin check without leaking URLs upstream.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' ${callbackOrigin ?? ''}; style-src 'nonce-${nonce ?? 'unused'}'; script-src 'nonce-${nonce ?? 'unused'}'; connect-src 'self'`,
  );
  res.type('html').send(html);
}

export function renderLogin(
  uid: string,
  csrf: string,
  federation: FederationLink[],
  message?: string,
): { html: string; nonce: string } {
  const nonce = randomBytes(18).toString('base64url');
  const providerLinks = federation.map((provider) =>
    `<a class="button secondary provider" href="/federation/${encodeURIComponent(provider.id)}/start?uid=${encodeURIComponent(uid)}">Continuer avec ${escapeHtml(provider.label)}</a>`,
  ).join('');
  const script = `
const fromB64 = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
};
const toB64 = (value) => {
  let binary = ''; for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
};
document.querySelector('#passkey')?.addEventListener('click', async () => {
  const status = document.querySelector('#passkey-status');
  try {
    status.textContent = 'Demande de la passkey…';
    const optionsResponse = await fetch('/passkeys/authentication/options', {
      method: 'POST', credentials: 'same-origin',
      headers: {'content-type': 'application/json', 'x-csrf-token': ${JSON.stringify(csrf)}},
      body: JSON.stringify({uid: ${JSON.stringify(uid)}}),
    });
    if (!optionsResponse.ok) throw new Error('options');
    const data = await optionsResponse.json();
    data.options.challenge = fromB64(data.options.challenge);
    data.options.allowCredentials = (data.options.allowCredentials || []).map(c => ({...c, id: fromB64(c.id)}));
    const credential = await navigator.credentials.get({publicKey: data.options});
    const response = {
      id: credential.id, rawId: toB64(credential.rawId), type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        authenticatorData: toB64(credential.response.authenticatorData),
        clientDataJSON: toB64(credential.response.clientDataJSON),
        signature: toB64(credential.response.signature),
        userHandle: credential.response.userHandle ? toB64(credential.response.userHandle) : null,
      },
    };
    const form = document.createElement('form'); form.method = 'post'; form.action = '/passkeys/authentication/verify';
    for (const [name, value] of Object.entries({
      _csrf: ${JSON.stringify(csrf)}, uid: ${JSON.stringify(uid)}, challenge_id: data.challengeId,
      credential: JSON.stringify(response),
    })) { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input); }
    document.body.append(form); form.submit();
  } catch (error) { status.textContent = 'Passkey indisponible ou refusée.'; }
});`;
  return {
    nonce,
    html: shell('Connexion', `
      <h1>Connexion à AI ID</h1>
      <p>Une identité est toujours recherchée dans son domaine de confiance. L’email seul ne déclenche jamais de fusion.</p>
      ${message ? `<p class="error">${escapeHtml(message)}</p>` : ''}
      <form method="post" action="/interaction/${encodeURIComponent(uid)}/login">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
        <label>Domaine de confiance <input name="domain_id" autocomplete="organization" required></label>
        <label>Email <input type="email" name="email" autocomplete="username" required></label>
        <label>Mot de passe <input type="password" name="password" autocomplete="current-password" required></label>
        <button type="submit">Se connecter</button>
      </form>
      <button id="passkey" class="secondary" type="button">Utiliser une passkey</button>
      <p id="passkey-status" aria-live="polite"></p>
      ${providerLinks ? `<hr><p>Fédération autorisée</p>${providerLinks}` : ''}
      <hr><a class="button secondary" href="/register?uid=${encodeURIComponent(uid)}">Créer un nouveau domaine</a>
    `, nonce, script),
  };
}

export function renderRegistration(uid: string | undefined, csrf: string, message?: string): { html: string; nonce: string } {
  const nonce = randomBytes(18).toString('base64url');
  return {
    nonce,
    html: shell('Créer un domaine', `
      <h1>Nouveau domaine de confiance</h1>
      <p>Chaque inscription crée un domaine isolé et son premier administrateur. Un email existant n’est jamais rejoint automatiquement.</p>
      ${message ? `<p class="error">${escapeHtml(message)}</p>` : ''}
      <form method="post" action="/register">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
        ${uid ? `<input type="hidden" name="uid" value="${escapeHtml(uid)}">` : ''}
        <label>Nom du domaine <input name="domain_name" maxlength="120" required></label>
        <label>Votre nom <input name="name" autocomplete="name" maxlength="120" required></label>
        <label>Email <input type="email" name="email" autocomplete="username" required></label>
        <label>Mot de passe (12 caractères minimum) <input type="password" name="password" minlength="12" maxlength="1024" autocomplete="new-password" required></label>
        <button type="submit">Créer le domaine</button>
      </form>
    `, nonce),
  };
}

export function renderRegistrationComplete(domainId: string): { html: string; nonce: string } {
  const nonce = randomBytes(18).toString('base64url');
  return {
    nonce,
    html: shell('Domaine créé', `
      <h1>Domaine créé</h1>
      <p>Conservez cet identifiant de domaine ; il est requis avec le fallback mot de passe.</p>
      <p><code>${escapeHtml(domainId)}</code></p>
      <a class="button" href="/passkeys/enroll">Enregistrer une passkey</a>
    `, nonce),
  };
}

export function renderPasskeyEnrollment(csrf: string): { html: string; nonce: string } {
  const nonce = randomBytes(18).toString('base64url');
  const script = `
const fromB64 = (value) => { const n=value.replace(/-/g,'+').replace(/_/g,'/'); const p=n+'='.repeat((4-n.length%4)%4); return Uint8Array.from(atob(p),c=>c.charCodeAt(0)); };
const toB64 = (value) => { let b=''; for(const x of new Uint8Array(value)) b+=String.fromCharCode(x); return btoa(b).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/g,''); };
document.querySelector('#enroll').addEventListener('click', async () => {
  const status = document.querySelector('#status');
  try {
    const optionResponse = await fetch('/passkeys/registration/options', {method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':${JSON.stringify(csrf)}},body:'{}'});
    if (!optionResponse.ok) throw new Error('options');
    const data = await optionResponse.json(); const options = data.options;
    options.challenge=fromB64(options.challenge); options.user.id=fromB64(options.user.id);
    options.excludeCredentials=(options.excludeCredentials||[]).map(c=>({...c,id:fromB64(c.id)}));
    const credential = await navigator.credentials.create({publicKey:options});
    const response={id:credential.id,rawId:toB64(credential.rawId),type:credential.type,authenticatorAttachment:credential.authenticatorAttachment,clientExtensionResults:credential.getClientExtensionResults(),response:{clientDataJSON:toB64(credential.response.clientDataJSON),attestationObject:toB64(credential.response.attestationObject),transports:credential.response.getTransports?credential.response.getTransports():[]}};
    const verified = await fetch('/passkeys/registration/verify',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':${JSON.stringify(csrf)}},body:JSON.stringify({challenge_id:data.challengeId,credential:response})});
    if(!verified.ok) throw new Error('verify'); status.textContent='Passkey enregistrée.'; document.querySelector('#enroll').disabled=true;
  } catch(error) { status.textContent='Enregistrement annulé ou invalide.'; }
});`;
  return {
    nonce,
    html: shell('Enregistrer une passkey', `
      <h1>Enregistrer une passkey</h1>
      <p>La passkey sera liée à ce compte et à ce RP ID. Son authentification ne sera comptée AAL2 que si une politique future vérifie réellement les propriétés nécessaires.</p>
      <button id="enroll" type="button">Créer la passkey</button>
      <p id="status" aria-live="polite"></p>
      <a class="button secondary" href="/">Retour à la console</a>
    `, nonce, script),
  };
}

export function renderConsent(uid: string, csrf: string): { html: string; nonce: string } {
  const nonce = randomBytes(18).toString('base64url');
  return { nonce, html: shell('Autoriser la console', `
    <h1>Autoriser la console AI ID</h1>
    <p>La console recevra votre nom, votre domaine et votre email non vérifié. Elle conservera une session locale pendant 8 heures au maximum.</p>
    <form method="post" action="/interaction/${encodeURIComponent(uid)}/confirm">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
      <button type="submit">Autoriser</button>
    </form>
    <form method="post" action="/interaction/${encodeURIComponent(uid)}/abort">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
      <button class="secondary" type="submit">Refuser</button>
    </form>`, nonce) };
}

export function renderError(status: number, message: string): { status: number; html: string; nonce: string } {
  const nonce = randomBytes(18).toString('base64url');
  return {
    status,
    nonce,
    html: shell('Erreur', `<h1>La requête a échoué</h1><p class="error">${escapeHtml(message)}</p>`, nonce),
  };
}
