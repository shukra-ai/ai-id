"use strict";

const state = {
  config: null,
  me: null,
  entities: [],
  principals: [],
  relationships: [],
  delegations: [],
  evidence: [],
  currentView: "overview",
  secretTimer: null,
};

class DashboardError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.name = "DashboardError";
    this.status = status;
    this.requestId = requestId;
  }
}

const byId = (id) => document.getElementById(id);

function createElement(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    }
  }
  if (options.children) node.append(...options.children.filter(Boolean));
  return node;
}

function replaceContent(target, ...nodes) {
  target.replaceChildren(...nodes.filter(Boolean));
}

function recordsOf(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.data) ? payload.data : [];
}

function requestIdFrom(response, problem) {
  return (
    response.headers.get("x-request-id") ||
    problem?.request_id ||
    problem?.requestId ||
    undefined
  );
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (method !== "GET" && method !== "HEAD") {
    if (state.me?.csrf_token) headers.set("X-CSRF-Token", state.me.csrf_token);
    headers.set("Idempotency-Key", crypto.randomUUID());
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new DashboardError("Le service AI ID est momentanément inaccessible.", 0);
  }

  const contentType = response.headers.get("content-type") || "";
  let payload = null;
  if (response.status !== 204) {
    if (contentType.includes("json")) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    } else {
      try {
        payload = await response.text();
      } catch {
        payload = null;
      }
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && (payload.detail || payload.title || payload.error_description || payload.error)) ||
      (typeof payload === "string" && payload.trim()) ||
      `La requête a échoué (${response.status}).`;
    throw new DashboardError(String(message), response.status, requestIdFrom(response, payload));
  }

  return payload;
}

function errorMessage(error) {
  if (!(error instanceof Error)) return "Une erreur inattendue est survenue.";
  const suffix = error.requestId ? ` Référence : ${error.requestId}.` : "";
  return `${error.message}${suffix}`;
}

function showToast(message, isError = false) {
  const toast = createElement("div", {
    className: `toast${isError ? " is-error" : ""}`,
    text: message,
  });
  byId("toast-region").append(toast);
  window.setTimeout(() => toast.remove(), 5200);
}

function setMessage(id, message = "", isError = false) {
  const target = byId(id);
  target.textContent = message;
  target.classList.toggle("form-message-error", isError);
}

function setPending(control, pending, pendingText) {
  const button = control instanceof HTMLFormElement
    ? control.querySelector('button[type="submit"]')
    : control;
  if (!button) return;
  if (pending) {
    button.dataset.previousText = button.textContent;
    button.disabled = true;
    if (pendingText) button.textContent = pendingText;
  } else {
    button.disabled = false;
    if (button.dataset.previousText) {
      button.textContent = button.dataset.previousText;
      delete button.dataset.previousText;
    }
  }
}

function renderLoading(target, label = "Chargement…") {
  replaceContent(target, createElement("div", { className: "loading-state", text: label }));
}

function renderEmpty(target, message) {
  replaceContent(target, createElement("div", { className: "empty-state", text: message }));
}

function renderError(target, error) {
  replaceContent(target, createElement("div", { className: "error-state", text: errorMessage(error) }));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function shortId(value) {
  if (!value) return "—";
  const text = String(value);
  return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

function kindLabel(kind) {
  const labels = {
    human: "Humain",
    agent: "Agent IA",
    service: "Service",
    organization: "Organisation",
  };
  return labels[kind] || kind || "Entité";
}

function statusClass(status) {
  if (["active", "success", "valid", "allowed", "permit"].includes(String(status).toLowerCase())) return "badge-green";
  if (["revoked", "failed", "failure", "denied", "invalid"].includes(String(status).toLowerCase())) return "badge-red";
  if (["pending", "suspended", "expired"].includes(String(status).toLowerCase())) return "badge-amber";
  return "";
}

function statusBadge(value, fallback = "—") {
  const text = value || fallback;
  return createElement("span", { className: `badge ${statusClass(text)}`, text });
}

function table(headers, rows) {
  const tableNode = createElement("table", { className: "data-table" });
  const headRow = createElement("tr");
  for (const header of headers) {
    headRow.append(createElement("th", { text: header, attrs: { scope: "col" } }));
  }
  const thead = createElement("thead", { children: [headRow] });
  const tbody = createElement("tbody");
  for (const cells of rows) {
    const row = createElement("tr");
    for (const cell of cells) {
      const td = createElement("td");
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell === undefined || cell === null ? "—" : String(cell);
      row.append(td);
    }
    tbody.append(row);
  }
  tableNode.append(thead, tbody);
  return createElement("div", { className: "data-table-wrap", children: [tableNode] });
}

function compactList(items, mapper) {
  const list = createElement("div", { className: "compact-list" });
  for (const item of items) {
    const view = mapper(item);
    const icon = createElement("span", {
      className: `compact-icon${view.event ? " event" : ""}`,
      text: view.icon || "ID",
      attrs: { "aria-hidden": "true" },
    });
    const body = createElement("div", { className: "compact-body" });
    body.append(
      createElement("strong", { text: view.title }),
      createElement("span", { text: view.subtitle }),
    );
    list.append(
      createElement("div", {
        className: "compact-row",
        children: [icon, body, createElement("span", { className: "compact-meta", text: view.meta || "" })],
      }),
    );
  }
  return list;
}

function initials(name) {
  return String(name || "AI")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("") || "AI";
}

function setAuthenticatedChrome() {
  byId("sidebar-domain").textContent = state.me.domain_name || state.me.domain_id;
  byId("domain-id").textContent = state.me.domain_id;
  byId("user-name").textContent = state.me.display_name || "Session AI ID";
  byId("user-principal").textContent = shortId(state.me.principal_id);
  byId("user-avatar").textContent = initials(state.me.display_name);
  const scope = Array.isArray(state.me.scope) ? state.me.scope.join(" · ") : state.me.scope;
  byId("scope-summary").textContent = scope || "";
  byId("overview-welcome").textContent = `Bienvenue ${state.me.display_name || ""} — ${state.me.domain_name || state.me.domain_id}`.trim();
}

function safeOrigin(value, fallback) {
  try {
    return new URL(value, fallback).origin;
  } catch {
    return fallback;
  }
}

function configurePublicLinks() {
  const coreOrigin = safeOrigin(state.config?.coreOrigin, window.location.origin);
  const issuerOrigin = safeOrigin(state.config?.issuer, coreOrigin);
  byId("login-link").href = new URL("/auth/login", coreOrigin).toString();
  byId("register-link").href = new URL("/auth/login", coreOrigin).toString();
  byId("passkey-link").href = new URL("/passkeys/enroll", issuerOrigin).toString();
  byId("docs-base-url").textContent = coreOrigin;

  byId("client-code").textContent = [
    'import { createAIIDClient } from "./src/sdk/index.js"; // SDK local non publié',
    "",
    "const aiid = createAIIDClient({",
    `  baseUrl: "${coreOrigin}",`,
    "  token: process.env.AI_ID_TOKEN,",
    "});",
  ].join("\n");

  byId("authorize-code").textContent = [
    "const result = await aiid.authorize({",
    '  subject: { type: "principal", id: principalId },',
    '  resource: { type: "tool", id: "demo" },',
    '  action: { name: "execute" },',
    "}, { idempotencyKey: crypto.randomUUID() });",
    "",
    "if (!result.decision) {",
    "  throw new Error(result.context.reason);",
    "}",
  ].join("\n");
}

function showLogin(error) {
  byId("boot-screen").hidden = true;
  byId("app-shell").hidden = true;
  byId("login-screen").hidden = false;
  const target = byId("login-error");
  target.hidden = !error;
  target.textContent = error ? errorMessage(error) : "";
}

function showApp() {
  byId("boot-screen").hidden = true;
  byId("login-screen").hidden = true;
  byId("app-shell").hidden = false;
  setAuthenticatedChrome();
  configurePublicLinks();
  navigate("overview");
}

async function bootstrap() {
  try {
    state.config = await api("/api/config");
  } catch {
    state.config = {
      coreOrigin: window.location.origin,
      issuer: window.location.origin,
      mode: "unknown",
    };
  }
  configurePublicLinks();

  try {
    state.me = await api("/api/me");
    showApp();
  } catch (error) {
    if (error instanceof DashboardError && error.status === 401) showLogin();
    else showLogin(error);
  }
}

async function navigate(view) {
  state.currentView = view;
  for (const nav of document.querySelectorAll("[data-view]")) {
    const active = nav.dataset.view === view;
    nav.classList.toggle("is-active", active);
    if (active) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }
  for (const panel of document.querySelectorAll("[data-view-panel]")) {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  }
  byId("main-content").focus({ preventScroll: true });
  byId("mobile-nav-toggle").setAttribute("aria-expanded", "false");
  document.querySelector(".sidebar").classList.remove("is-open");

  if (view !== "access") clearSecret();

  const loaders = {
    overview: loadOverview,
    identities: loadIdentities,
    access: loadAccess,
    trust: loadTrust,
    activity: loadActivity,
    docs: async () => configurePublicLinks(),
  };
  try {
    await loaders[view]?.();
  } catch (error) {
    showToast(errorMessage(error), true);
  }
}

async function fetchCollection(path) {
  const payload = await api(path);
  return { records: recordsOf(payload), nextCursor: payload?.next_cursor || null };
}

function metric(label, payload, note, green = false) {
  const value = payload.nextCursor ? `${payload.records.length}+` : String(payload.records.length);
  return createElement("article", {
    className: `metric-card${green ? " metric-green" : ""}`,
    children: [
      createElement("span", { className: "metric-label", text: label }),
      createElement("strong", { className: "metric-value", text: value }),
      createElement("span", { className: "metric-note", text: payload.nextCursor ? `${note} · page courante` : note }),
    ],
  });
}

async function loadOverview() {
  const metricsTarget = byId("overview-metrics");
  const entitiesTarget = byId("overview-entities");
  const eventsTarget = byId("overview-events");
  renderLoading(metricsTarget);
  renderLoading(entitiesTarget);
  renderLoading(eventsTarget);

  const [entitiesResult, principalsResult, delegationsResult, evidenceResult, eventsResult] = await Promise.allSettled([
    fetchCollection("/v1/entities"),
    fetchCollection("/v1/principals"),
    fetchCollection("/v1/delegations"),
    fetchCollection("/v1/evidence"),
    fetchCollection("/v1/events"),
  ]);

  const metricNodes = [];
  const definitions = [
    ["Identités", entitiesResult, "entités persistantes", false],
    ["Principaux", principalsResult, "acteurs authentifiables", false],
    ["Délégations", delegationsResult, "autorités enregistrées", true],
    ["Preuves", evidenceResult, "observations attribuées", true],
  ];
  for (const [label, result, note, green] of definitions) {
    if (result.status === "fulfilled") metricNodes.push(metric(label, result.value, note, green));
    else {
      metricNodes.push(createElement("article", {
        className: "metric-card",
        children: [
          createElement("span", { className: "metric-label", text: label }),
          createElement("strong", { className: "metric-value", text: "—" }),
          createElement("span", { className: "metric-note", text: "Indisponible" }),
        ],
      }));
    }
  }
  replaceContent(metricsTarget, ...metricNodes);

  if (entitiesResult.status === "fulfilled") {
    const items = entitiesResult.value.records.slice(0, 5);
    if (!items.length) renderEmpty(entitiesTarget, "Aucune identité créée dans ce domaine.");
    else {
      replaceContent(entitiesTarget, compactList(items, (entity) => ({
        icon: String(entity.kind || "id").slice(0, 2),
        title: entity.display_name || shortId(entity.id),
        subtitle: `${kindLabel(entity.kind)} · ${entity.status || "statut non indiqué"}`,
        meta: formatDate(entity.created_at),
      })));
    }
  } else renderError(entitiesTarget, entitiesResult.reason);

  if (eventsResult.status === "fulfilled") {
    const items = eventsResult.value.records.slice(0, 5);
    if (!items.length) renderEmpty(eventsTarget, "Aucun événement n’a encore été enregistré.");
    else {
      replaceContent(eventsTarget, compactList(items, (event) => ({
        icon: "↗",
        event: true,
        title: event.type || event.event_type || event.action || "Événement",
        subtitle: shortId(event.entity_id || event.aggregate_id || event.subject_id),
        meta: formatDate(event.occurred_at || event.created_at),
      })));
    }
  } else renderError(eventsTarget, eventsResult.reason);
}

async function refreshEntitiesAndPrincipals() {
  const [entitiesPayload, principalsPayload] = await Promise.all([
    api("/v1/entities"),
    api("/v1/principals"),
  ]);
  state.entities = recordsOf(entitiesPayload);
  state.principals = recordsOf(principalsPayload);
  renderEntityTable();
  renderPrincipalTable();
  updateEntitySelects();
  updatePrincipalSelects();
}

async function loadIdentities() {
  renderLoading(byId("entity-list"));
  renderLoading(byId("principal-list"));
  try {
    await refreshEntitiesAndPrincipals();
  } catch (error) {
    renderError(byId("entity-list"), error);
    renderError(byId("principal-list"), error);
  }
}

function renderEntityTable() {
  const target = byId("entity-list");
  if (!state.entities.length) {
    renderEmpty(target, "Aucune identité. Créez la première entité de votre domaine.");
    return;
  }
  const rows = state.entities.map((entity) => {
    const name = createElement("div", {
      children: [
        createElement("strong", { text: entity.display_name || shortId(entity.id) }),
        createElement("div", { className: "mono", text: entity.id, attrs: { title: entity.id || "" } }),
      ],
    });
    const actions = createElement("div", { className: "row-actions" });
    if (["agent", "service", "organization"].includes(entity.kind)) {
      const button = createElement("button", {
        className: "button button-secondary button-small",
        text: "Créer un principal",
        attrs: { type: "button", "data-entity-id": entity.id },
      });
      button.addEventListener("click", () => createWorkloadPrincipal(entity.id, button));
      actions.append(button);
    } else actions.append(createElement("span", { className: "compact-meta", text: "—" }));
    return [
      name,
      kindLabel(entity.kind),
      statusBadge(entity.status, "actif"),
      formatDate(entity.created_at),
      actions,
    ];
  });
  replaceContent(target, table(["Identité", "Type", "Statut", "Création", ""], rows));
}

function renderPrincipalTable() {
  const target = byId("principal-list");
  if (!state.principals.length) {
    renderEmpty(target, "Aucun principal n’est visible pour le moment.");
    return;
  }
  const rows = state.principals.map((principal) => [
    createElement("span", { className: "mono", text: principal.id, attrs: { title: principal.id || "" } }),
    createElement("span", { className: "mono", text: principal.entity_id, attrs: { title: principal.entity_id || "" } }),
    principal.custody || principal.kind || "—",
    statusBadge(principal.status, "actif"),
    formatDate(principal.created_at),
  ]);
  replaceContent(target, table(["Principal", "Entité", "Garde", "Statut", "Création"], rows));
}

async function createWorkloadPrincipal(entityId, button) {
  setPending(button, true, "Création…");
  try {
    await api(`/v1/entities/${encodeURIComponent(entityId)}/principals`, {
      method: "POST",
      body: { custody: "workload-custodial" },
    });
    showToast("Principal workload créé.");
    await refreshEntitiesAndPrincipals();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    setPending(button, false);
  }
}

function updatePrincipalSelects() {
  for (const select of document.querySelectorAll("[data-principal-select]")) {
    const previous = select.value;
    select.replaceChildren();
    if (!state.principals.length) {
      select.append(createElement("option", { text: "Aucun principal disponible", attrs: { value: "" } }));
      select.disabled = true;
      continue;
    }
    select.disabled = false;
    for (const principal of state.principals) {
      const entity = state.entities.find((candidate) => candidate.id === principal.entity_id);
      const label = entity?.display_name
        ? `${entity.display_name} — ${shortId(principal.id)}`
        : shortId(principal.id);
      select.append(createElement("option", { text: label, attrs: { value: principal.id } }));
    }
    if (state.principals.some((principal) => principal.id === previous)) select.value = previous;
  }
}

function updateEntitySelects() {
  for (const select of document.querySelectorAll("[data-entity-select]")) {
    const previous = select.value;
    select.replaceChildren();
    if (!state.entities.length) {
      select.append(createElement("option", { text: "Aucune entité disponible", attrs: { value: "" } }));
      select.disabled = true;
      continue;
    }
    select.disabled = false;
    for (const entity of state.entities) {
      select.append(createElement("option", {
        text: `${entity.display_name || shortId(entity.id)} — ${kindLabel(entity.kind)}`,
        attrs: { value: entity.id },
      }));
    }
    if (state.entities.some((entity) => entity.id === previous)) select.value = previous;
  }
}

async function loadAccess() {
  renderLoading(byId("relationship-list"));
  renderLoading(byId("delegation-list"));
  const [entitiesResult, principalsResult, relationshipsResult, delegationsResult] = await Promise.allSettled([
    api("/v1/entities"),
    api("/v1/principals"),
    api("/v1/relationships"),
    api("/v1/delegations"),
  ]);
  if (entitiesResult.status === "fulfilled") state.entities = recordsOf(entitiesResult.value);
  if (principalsResult.status === "fulfilled") state.principals = recordsOf(principalsResult.value);
  updatePrincipalSelects();

  if (relationshipsResult.status === "fulfilled") {
    state.relationships = recordsOf(relationshipsResult.value);
    renderRelationships();
  } else renderError(byId("relationship-list"), relationshipsResult.reason);

  if (delegationsResult.status === "fulfilled") {
    state.delegations = recordsOf(delegationsResult.value);
    renderDelegations();
  } else renderError(byId("delegation-list"), delegationsResult.reason);
}

function renderRelationships() {
  const target = byId("relationship-list");
  if (!state.relationships.length) {
    renderEmpty(target, "Aucune permission active pour l’outil de démonstration.");
    return;
  }
  const rows = state.relationships.map((relationship) => {
    const actions = createElement("div", { className: "row-actions" });
    const revoke = createElement("button", {
      className: "button button-danger button-small",
      text: "Retirer",
      attrs: { type: "button" },
    });
    revoke.addEventListener("click", () => deleteRelationship(relationship.id, revoke));
    actions.append(revoke);
    return [
      createElement("span", { className: "mono", text: relationship.subject_id, attrs: { title: relationship.subject_id || "" } }),
      relationship.resource || "—",
      statusBadge(relationship.action, "—"),
      actions,
    ];
  });
  replaceContent(target, table(["Principal", "Ressource", "Action", ""], rows));
}

function renderDelegations() {
  const target = byId("delegation-list");
  if (!state.delegations.length) {
    renderEmpty(target, "Aucune délégation n’a été enregistrée.");
    return;
  }
  const rows = state.delegations.map((delegation) => {
    const actions = createElement("div", { className: "row-actions" });
    if (!delegation.status || delegation.status === "active") {
      const revoke = createElement("button", {
        className: "button button-danger button-small",
        text: "Révoquer",
        attrs: { type: "button" },
      });
      revoke.addEventListener("click", () => revokeDelegation(delegation.id, revoke));
      actions.append(revoke);
    }
    return [
      createElement("span", { className: "mono", text: delegation.delegate_principal_id, attrs: { title: delegation.delegate_principal_id || "" } }),
      delegation.resource || "—",
      statusBadge(delegation.status, "active"),
      formatDate(delegation.expires_at),
      actions,
    ];
  });
  replaceContent(target, table(["Délégué", "Ressource", "Statut", "Expiration", ""], rows));
}

async function refreshRelationships() {
  const payload = await api("/v1/relationships");
  state.relationships = recordsOf(payload);
  renderRelationships();
}

async function refreshDelegations() {
  const payload = await api("/v1/delegations");
  state.delegations = recordsOf(payload);
  renderDelegations();
}

async function deleteRelationship(id, button) {
  setPending(button, true, "Retrait…");
  try {
    await api(`/v1/relationships/${encodeURIComponent(id)}`, { method: "DELETE" });
    showToast("Permission retirée.");
    await refreshRelationships();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    setPending(button, false);
  }
}

async function revokeDelegation(id, button) {
  setPending(button, true, "Révocation…");
  try {
    await api(`/v1/delegations/${encodeURIComponent(id)}/revoke`, { method: "POST", body: {} });
    showToast("Délégation révoquée.");
    await refreshDelegations();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    setPending(button, false);
  }
}

function renderDecision(result) {
  const target = byId("decision-result");
  const decision = Boolean(result?.decision);
  const box = createElement("div", { className: `decision-box${decision ? "" : " is-denied"}` });
  const text = createElement("div");
  text.append(
    createElement("strong", { text: decision ? "Accès autorisé" : "Accès refusé" }),
    createElement("span", { text: result?.context?.reason || "Aucune raison détaillée n’a été fournie." }),
  );
  box.append(createElement("span", { text: decision ? "✓" : "×", attrs: { "aria-hidden": "true" } }), text);
  if (result?.context?.decision_id) {
    box.setAttribute("title", `Décision ${result.context.decision_id}`);
  }
  replaceContent(target, box);
}

function clearSecret() {
  if (state.secretTimer) window.clearTimeout(state.secretTimer);
  state.secretTimer = null;
  const target = byId("api-key-result");
  if (target) target.replaceChildren();
}

function renderSecret(result) {
  clearSecret();
  const target = byId("api-key-result");
  const secret = result?.secret;
  if (!secret) {
    replaceContent(target, createElement("p", { className: "form-message form-message-error", text: "Le service n’a pas retourné de secret." }));
    return;
  }
  const copy = createElement("button", { className: "copy-button", text: "Copier", attrs: { type: "button" } });
  copy.addEventListener("click", () => copyText(String(secret), copy));
  replaceContent(target, createElement("div", {
    className: "secret-box",
    children: [createElement("code", { text: secret }), copy],
  }));
  state.secretTimer = window.setTimeout(() => {
    replaceContent(target, createElement("p", { className: "form-message", text: "Le secret a été masqué. Générez une nouvelle clé si nécessaire." }));
    state.secretTimer = null;
  }, 60000);
}

async function loadTrust() {
  renderLoading(byId("evidence-list"));
  const [entitiesResult, evidenceResult] = await Promise.allSettled([
    api("/v1/entities"),
    api("/v1/evidence"),
  ]);
  if (entitiesResult.status === "fulfilled") {
    state.entities = recordsOf(entitiesResult.value);
    updateEntitySelects();
  }
  if (evidenceResult.status === "fulfilled") {
    state.evidence = recordsOf(evidenceResult.value);
    renderEvidence();
  } else renderError(byId("evidence-list"), evidenceResult.reason);
}

function renderEvidence() {
  const target = byId("evidence-list");
  if (!state.evidence.length) {
    renderEmpty(target, "Aucune preuve enregistrée pour ce contexte.");
    return;
  }
  const rows = state.evidence.map((evidence) => [
    createElement("span", { className: "mono", text: evidence.subject_entity_id, attrs: { title: evidence.subject_entity_id || "" } }),
    evidence.context || "—",
    statusBadge(evidence.outcome, "—"),
    evidence.provenance || "—",
    formatDate(evidence.observed_at || evidence.created_at),
  ]);
  replaceContent(target, table(["Entité", "Contexte", "Résultat", "Provenance", "Date"], rows));
}

async function refreshEvidence() {
  const payload = await api("/v1/evidence");
  state.evidence = recordsOf(payload);
  renderEvidence();
}

function renderAssessment(assessment) {
  const target = byId("assessment-result");
  const band = assessment?.result?.band || assessment?.band || assessment?.result || assessment?.status || "Disponible";
  const bandText = typeof band === "object" ? "Disponible" : band;
  const panel = createElement("div", { className: "assessment-panel" });
  const headline = createElement("div", {
    className: "assessment-band",
    children: [
      createElement("strong", { text: bandText }),
      statusBadge(assessment?.status, "active"),
    ],
  });
  const grid = createElement("div", { className: "assessment-grid" });
  const stats = [
    ["Confiance", assessment?.confidence_band],
    ["Échantillon", assessment?.sample_size],
    ["Diversité des sources", assessment?.source_diversity],
    ["Version du modèle", assessment?.model_version || assessment?.model],
  ];
  for (const [label, value] of stats) {
    const display = value === undefined || value === null ? "Non indiqué" : value;
    grid.append(createElement("div", {
      className: "assessment-stat",
      children: [createElement("span", { text: label }), createElement("strong", { text: display })],
    }));
  }
  panel.append(headline, grid);
  replaceContent(target, panel);
}

async function loadActivity() {
  renderLoading(byId("event-list"));
  renderLoading(byId("audit-list"));
  const [eventsResult, auditResult] = await Promise.allSettled([
    api("/v1/events"),
    api("/v1/audit"),
  ]);
  if (eventsResult.status === "fulfilled") renderActivityTable(byId("event-list"), recordsOf(eventsResult.value), false);
  else renderError(byId("event-list"), eventsResult.reason);
  if (auditResult.status === "fulfilled") renderActivityTable(byId("audit-list"), recordsOf(auditResult.value), true);
  else renderError(byId("audit-list"), auditResult.reason);
}

function renderActivityTable(target, records, audit) {
  if (!records.length) {
    renderEmpty(target, audit ? "Le journal d’audit est vide." : "Aucun événement de domaine.");
    return;
  }
  const rows = records.map((record) => [
    record.action || record.type || record.event_type || "Événement",
    createElement("span", {
      className: "mono",
      text: record.actor_id || record.actor_principal_id || record.principal_id || record.entity_id || record.aggregate_id,
      attrs: { title: record.actor_id || record.actor_principal_id || record.principal_id || record.entity_id || record.aggregate_id || "" },
    }),
    statusBadge(record.outcome || record.status, "enregistré"),
    formatDate(record.occurred_at || record.created_at || record.recorded_at),
  ]);
  replaceContent(target, table([audit ? "Action" : "Type", audit ? "Acteur" : "Agrégat", "Résultat", "Date"], rows));
}

async function verifyAudit(button) {
  const target = byId("audit-verification");
  target.classList.remove("is-invalid");
  target.textContent = "Vérification en cours…";
  setPending(button, true, "Vérification…");
  try {
    const result = await api("/v1/audit/verify");
    const valid = Boolean(result?.valid);
    target.classList.toggle("is-invalid", !valid);
    const hash = result?.head_hash ? ` · tête ${shortId(result.head_hash)}` : "";
    target.textContent = valid
      ? `Chaîne locale valide · ${result.count ?? 0} enregistrement(s)${hash} · témoin : ${result.witness?.status || "inconnu"}`
      : `La vérification a détecté une incohérence · ${result.count ?? 0} enregistrement(s)${hash}`;
  } catch (error) {
    target.classList.add("is-invalid");
    target.textContent = errorMessage(error);
  } finally {
    setPending(button, false);
  }
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const before = button.textContent;
    button.textContent = "Copié";
    window.setTimeout(() => { button.textContent = before; }, 1400);
  } catch {
    showToast("La copie automatique est indisponible dans ce navigateur.", true);
  }
}

function wireNavigation() {
  for (const nav of document.querySelectorAll("[data-view]")) {
    nav.addEventListener("click", () => navigate(nav.dataset.view));
  }
  for (const trigger of document.querySelectorAll("[data-open-view]")) {
    trigger.addEventListener("click", () => navigate(trigger.dataset.openView));
  }
  byId("mobile-nav-toggle").addEventListener("click", (event) => {
    const sidebar = document.querySelector(".sidebar");
    const open = sidebar.classList.toggle("is-open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
}

function wireForms() {
  byId("toggle-entity-form").addEventListener("click", (event) => {
    const panel = byId("entity-create-card");
    panel.hidden = !panel.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) panel.querySelector("input")?.focus();
  });

  byId("refresh-entities").addEventListener("click", async (event) => {
    setPending(event.currentTarget, true, "");
    try { await refreshEntitiesAndPrincipals(); }
    catch (error) { showToast(errorMessage(error), true); }
    finally { setPending(event.currentTarget, false); }
  });

  byId("entity-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setMessage("entity-form-message");
    setPending(form, true, "Création…");
    try {
      await api("/v1/entities", {
        method: "POST",
        body: { kind: values.get("kind"), display_name: String(values.get("display_name") || "").trim() },
      });
      form.reset();
      setMessage("entity-form-message", "Identité créée avec succès.");
      await refreshEntitiesAndPrincipals();
    } catch (error) {
      setMessage("entity-form-message", errorMessage(error), true);
    } finally { setPending(form, false); }
  });

  byId("relationship-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setMessage("relationship-form-message");
    setPending(form, true, "Attribution…");
    try {
      await api("/v1/relationships", {
        method: "POST",
        body: { subject_id: values.get("subject_id"), resource: "tool:demo", action: "execute" },
      });
      setMessage("relationship-form-message", "Permission accordée.");
      await refreshRelationships();
    } catch (error) { setMessage("relationship-form-message", errorMessage(error), true); }
    finally { setPending(form, false); }
  });

  byId("delegation-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setMessage("delegation-form-message");
    setPending(form, true, "Création…");
    try {
      await api("/v1/delegations", {
        method: "POST",
        body: {
          delegate_principal_id: values.get("delegate_principal_id"),
          resource: "tool:demo",
          action: "execute",
          ttl_seconds: Number(values.get("ttl_seconds")),
        },
      });
      setMessage("delegation-form-message", "Délégation créée.");
      await refreshDelegations();
    } catch (error) { setMessage("delegation-form-message", errorMessage(error), true); }
    finally { setPending(form, false); }
  });

  byId("authorize-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(form, true, "Évaluation…");
    renderLoading(byId("decision-result"), "Évaluation de la politique…");
    try {
      const result = await api("/v1/authorize", {
        method: "POST",
        body: {
          subject: { type: "principal", id: values.get("principal_id") },
          resource: { type: "tool", id: "demo" },
          action: { name: "execute" },
        },
      });
      renderDecision(result);
    } catch (error) { renderError(byId("decision-result"), error); }
    finally { setPending(form, false); }
  });

  byId("api-key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    clearSecret();
    setPending(form, true, "Génération…");
    try {
      const result = await api("/v1/api-keys", {
        method: "POST",
        body: {
          principal_id: values.get("principal_id"),
          name: String(values.get("name") || "").trim(),
          ttl_seconds: 3600,
        },
      });
      form.querySelector('input[name="name"]').value = "";
      renderSecret(result);
    } catch (error) {
      replaceContent(byId("api-key-result"), createElement("p", { className: "form-message form-message-error", text: errorMessage(error) }));
    } finally { setPending(form, false); }
  });

  byId("evidence-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setMessage("evidence-form-message");
    setPending(form, true, "Enregistrement…");
    try {
      await api("/v1/evidence", {
        method: "POST",
        body: {
          subject_entity_id: values.get("subject_entity_id"),
          context: "tool.execution.v1",
          outcome: values.get("outcome"),
          reference: String(values.get("reference") || "").trim(),
        },
      });
      form.querySelector('input[name="reference"]').value = "";
      setMessage("evidence-form-message", "Preuve enregistrée.");
      await refreshEvidence();
    } catch (error) { setMessage("evidence-form-message", errorMessage(error), true); }
    finally { setPending(form, false); }
  });

  byId("assessment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const entityId = values.get("entity_id");
    setPending(form, true, "Calcul…");
    renderLoading(byId("assessment-result"), "Calcul de l’évaluation contextuelle…");
    try {
      const result = await api(`/v1/assessments/${encodeURIComponent(entityId)}?context=${encodeURIComponent("tool.execution.v1")}`);
      renderAssessment(result);
    } catch (error) { renderError(byId("assessment-result"), error); }
    finally { setPending(form, false); }
  });

  byId("verify-audit").addEventListener("click", (event) => verifyAudit(event.currentTarget));

  for (const button of document.querySelectorAll("[data-copy-target]")) {
    button.addEventListener("click", () => {
      const target = byId(button.dataset.copyTarget);
      copyText(target.textContent, button);
    });
  }

  byId("logout-button").addEventListener("click", async (event) => {
    setPending(event.currentTarget, true, "Déconnexion…");
    try {
      const result = await api("/auth/logout", { method: "POST", body: {} });
      state.me = null;
      clearSecret();
      if(result.redirect) window.location.assign(result.redirect);
      else showLogin();
    } catch (error) {
      showToast(errorMessage(error), true);
      setPending(event.currentTarget, false);
    }
  });
}

wireNavigation();
wireForms();
bootstrap();
