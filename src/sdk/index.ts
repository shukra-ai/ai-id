export type EntityKind = "human" | "agent" | "service" | "organization";

export interface AIIDClientOptions {
  baseUrl: string;
  /** Server-side workload key. Never place it in localStorage or frontend code. */
  token?: string;
  /** Browser session mode: same-origin cookies plus /api/me CSRF token. */
  csrfToken?: string;
  fetch?: typeof globalThis.fetch;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface Entity {
  id: string;
  kind: EntityKind;
  display_name: string;
  status: string;
  created_at: string;
}

export interface Principal {
  id: string;
  entity_id: string;
  custody?: string;
  status?: string;
  created_at?: string;
}

export interface Relationship {
  id: string;
  subject_id: string;
  resource: string;
  action: string;
  created_at?: string;
}

export interface Delegation {
  id: string;
  delegate_principal_id: string;
  resource: string;
  action: string;
  status?: string;
  expires_at?: string;
  created_at?: string;
}

export interface Evidence {
  id: string;
  subject_entity_id: string;
  context: string;
  outcome: "success" | "failure";
  provenance: 'resource-observed' | 'tenant-asserted';
  created_at?: string;
  observed_at?: string;
}

export interface Assessment {
  context?: string;
  subject?: string;
  result?: { band?: string } | string;
  band?: string;
  confidence?: number | string;
  confidence_band?: string;
  sample_size?: number;
  source_diversity?: number;
  model?: string;
  model_version?: string;
  status?: string;
  explanation_codes?: string[];
}

export interface DomainEvent {
  id?: string;
  type?: string;
  event_type?: string;
  entity_id?: string;
  aggregate_id?: string;
  occurred_at?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface AuditRecord {
  id?: string;
  action?: string;
  actor_principal_id?: string;
  principal_id?: string;
  outcome?: string;
  status?: string;
  occurred_at?: string;
  recorded_at?: string;
  [key: string]: unknown;
}

export interface AIIDConfig {
  issuer: string;
  coreOrigin: string;
  mode: string;
}

export interface CurrentPrincipal {
  principal_id: string;
  entity_id: string;
  domain_id: string;
  domain_name: string;
  display_name: string;
  csrf_token?: string;
  scope: string | string[];
}

export interface WriteOptions {
  /** A caller-generated key that remains identical when the exact write is retried. */
  idempotencyKey: string;
  /** Required only by browser sessions protected with a CSRF token. */
  csrfToken?: string;
  signal?: AbortSignal;
}

export interface ReadOptions {
  signal?: AbortSignal;
}

export interface RequestOptions extends ReadOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  csrfToken?: string;
  headers?: HeadersInit;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  request_id?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly type?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly problem?: ProblemDetails;

  constructor(options: {
    status: number;
    message: string;
    requestId?: string;
    problem?: ProblemDetails;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.requestId = options.requestId;
    this.problem = options.problem;
    this.type = options.problem?.type;
    this.title = options.problem?.title;
    this.detail = options.problem?.detail;
    this.instance = options.problem?.instance;
  }
}

export interface CreateEntityInput {
  kind: EntityKind;
  display_name: string;
}

export interface CreatePrincipalInput {
  custody: "workload-custodial";
}

export interface CreateRelationshipInput {
  subject_id: string;
  resource: string;
  action: string;
}

export interface AuthorizationRequest {
  subject: { type: "principal"; id: string };
  resource: { type: string; id: string };
  action: { name: string };
}

export interface AuthorizationDecision {
  decision: boolean;
  context: {
    decision_id?: string;
    reason?: string;
    [key: string]: unknown;
  };
}

export interface CreateDelegationInput {
  delegate_principal_id: string;
  resource: string;
  action: string;
  ttl_seconds: number;
}

export interface CreateApiKeyInput {
  principal_id: string;
  name: string;
  ttl_seconds: number;
}

export interface CreatedApiKey {
  id: string;
  secret: string;
  principal_id?: string;
  name?: string;
  expires_at?: string;
  [key: string]: unknown;
}

export interface CreateEvidenceInput {
  subject_entity_id: string;
  context: string;
  outcome: "success" | "failure";
  reference: string;
}

export interface AuditVerification {
  valid: boolean;
  count: number;
  head_hash: string | null;
}

export interface AIIDClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  getConfig(options?: ReadOptions): Promise<AIIDConfig>;
  getMe(options?: ReadOptions): Promise<CurrentPrincipal>;
  listEntities(cursor?: string, options?: ReadOptions): Promise<Page<Entity>>;
  createEntity(input: CreateEntityInput, options: WriteOptions): Promise<Entity>;
  listPrincipals(cursor?: string, options?: ReadOptions): Promise<Page<Principal>>;
  createPrincipal(entityId: string, input: CreatePrincipalInput, options: WriteOptions): Promise<Principal>;
  listRelationships(cursor?: string, options?: ReadOptions): Promise<Page<Relationship>>;
  createRelationship(input: CreateRelationshipInput, options: WriteOptions): Promise<Relationship>;
  deleteRelationship(id: string, options: WriteOptions): Promise<void>;
  authorize(input: AuthorizationRequest, options: WriteOptions): Promise<AuthorizationDecision>;
  listDelegations(cursor?: string, options?: ReadOptions): Promise<Page<Delegation>>;
  createDelegation(input: CreateDelegationInput, options: WriteOptions): Promise<Delegation>;
  revokeDelegation(id: string, options: WriteOptions): Promise<Delegation>;
  createApiKey(input: CreateApiKeyInput, options: WriteOptions): Promise<CreatedApiKey>;
  revokeApiKey(id: string, options: WriteOptions): Promise<{id:string;revoked:boolean}>;
  executeTool(input: {delegation_id:string;input:string}, options: WriteOptions): Promise<{id:string;output:string;evidence_id:string;delegation_id:string}>;
  listEvents(cursor?: string, options?: ReadOptions): Promise<Page<DomainEvent>>;
  listAudit(cursor?: string, options?: ReadOptions): Promise<Page<AuditRecord>>;
  verifyAudit(options?: ReadOptions): Promise<AuditVerification>;
  listEvidence(cursor?: string, options?: ReadOptions): Promise<Page<Evidence>>;
  createEvidence(input: CreateEvidenceInput, options: WriteOptions): Promise<Evidence>;
  getAssessment(entityId: string, context: string, options?: ReadOptions): Promise<Assessment>;
  logout(options: WriteOptions): Promise<void>;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("baseUrl must use HTTP or HTTPS");
  }
  if (url.username || url.password || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new TypeError('Use HTTPS except for local development; URL credentials are forbidden');
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function requireWriteOptions(options: WriteOptions): void {
  if (!options || typeof options.idempotencyKey !== "string" || !options.idempotencyKey.trim()) {
    throw new TypeError("A non-empty idempotencyKey is required for writes");
  }
}

function collectionPath(path: string, cursor?: string): string {
  if (!cursor) return path;
  const query = new URLSearchParams({ cursor });
  return `${path}?${query.toString()}`;
}

function writeRequest(options: WriteOptions, body?: unknown): RequestOptions {
  requireWriteOptions(options);
  return {
    method: "POST",
    body,
    idempotencyKey: options.idempotencyKey,
    csrfToken: options.csrfToken,
    signal: options.signal,
  };
}

async function readProblem(response: Response): Promise<{ problem?: ProblemDetails; message: string }> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    try {
      const value = await response.json() as unknown;
      if (value && typeof value === "object") {
        const problem = value as ProblemDetails;
        const message = problem.detail || problem.title || `AI ID request failed (${response.status})`;
        return { problem, message };
      }
    } catch {
      // The fallback below deliberately avoids exposing an unreadable response body.
    }
  }
  return { message: `AI ID request failed (${response.status})` };
}

export function createAIIDClient(options: AIIDClientOptions): AIIDClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!options.token?.trim() && !options.csrfToken?.trim()) {
    throw new TypeError("Provide a workload token or a same-origin browser csrfToken");
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("A Fetch API implementation is required");
  }

  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes('\\')) {
      throw new TypeError("SDK request paths must be same-origin absolute paths");
    }

    const method = requestOptions.method ?? "GET";
    if (method !== "GET") {
      if (!requestOptions.idempotencyKey?.trim()) {
        throw new TypeError("A non-empty idempotencyKey is required for writes");
      }
    }

    const headers = new Headers(requestOptions.headers);
    headers.set("Accept", "application/json");
    if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
    if (requestOptions.body !== undefined) headers.set("Content-Type", "application/json");
    if (requestOptions.idempotencyKey) headers.set("Idempotency-Key", requestOptions.idempotencyKey);
    const csrf = requestOptions.csrfToken ?? options.csrfToken;
    if (csrf) headers.set("X-CSRF-Token", csrf);

    const response = await fetchImplementation(`${baseUrl}${path}`, {
      method,
      headers,
      signal: requestOptions.signal,
      credentials: options.token ? 'omit' : 'same-origin',
      redirect: 'error',
      body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
    });

    if (!response.ok) {
      const { problem, message } = await readProblem(response);
      const requestId = response.headers.get("x-request-id") ||
        (typeof problem?.request_id === "string" ? problem.request_id : undefined);
      throw new ApiError({ status: response.status, message, requestId, problem });
    }

    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  return {
    request,
    getConfig: (readOptions = {}) => request<AIIDConfig>("/api/config", readOptions),
    getMe: (readOptions = {}) => request<CurrentPrincipal>("/api/me", readOptions),
    listEntities: (cursor, readOptions = {}) => request<Page<Entity>>(collectionPath("/v1/entities", cursor), readOptions),
    createEntity: (input, writeOptions) => request<Entity>("/v1/entities", writeRequest(writeOptions, input)),
    listPrincipals: (cursor, readOptions = {}) => request<Page<Principal>>(collectionPath("/v1/principals", cursor), readOptions),
    createPrincipal: (entityId, input, writeOptions) => request<Principal>(
      `/v1/entities/${encodeURIComponent(entityId)}/principals`,
      writeRequest(writeOptions, input),
    ),
    listRelationships: (cursor, readOptions = {}) => request<Page<Relationship>>(collectionPath("/v1/relationships", cursor), readOptions),
    createRelationship: (input, writeOptions) => request<Relationship>("/v1/relationships", writeRequest(writeOptions, input)),
    deleteRelationship: (id, writeOptions) => {
      requireWriteOptions(writeOptions);
      return request<void>(`/v1/relationships/${encodeURIComponent(id)}`, {
        method: "DELETE",
        idempotencyKey: writeOptions.idempotencyKey,
        csrfToken: writeOptions.csrfToken,
        signal: writeOptions.signal,
      });
    },
    authorize: (input, writeOptions) => request<AuthorizationDecision>("/v1/authorize", writeRequest(writeOptions, input)),
    listDelegations: (cursor, readOptions = {}) => request<Page<Delegation>>(collectionPath("/v1/delegations", cursor), readOptions),
    createDelegation: (input, writeOptions) => request<Delegation>("/v1/delegations", writeRequest(writeOptions, input)),
    revokeDelegation: (id, writeOptions) => request<Delegation>(
      `/v1/delegations/${encodeURIComponent(id)}/revoke`,
      writeRequest(writeOptions, {}),
    ),
    createApiKey: (input, writeOptions) => request<CreatedApiKey>("/v1/api-keys", writeRequest(writeOptions, input)),
    revokeApiKey: (id, writeOptions) => request(`/v1/api-keys/${encodeURIComponent(id)}`, {...writeRequest(writeOptions), method:'DELETE'}),
    executeTool: (input, writeOptions) => request('/v1/tool-executions', writeRequest(writeOptions,input)),
    listEvents: (cursor, readOptions = {}) => request<Page<DomainEvent>>(collectionPath("/v1/events", cursor), readOptions),
    listAudit: (cursor, readOptions = {}) => request<Page<AuditRecord>>(collectionPath("/v1/audit", cursor), readOptions),
    verifyAudit: (readOptions = {}) => request<AuditVerification>("/v1/audit/verify", readOptions),
    listEvidence: (cursor, readOptions = {}) => request<Page<Evidence>>(collectionPath("/v1/evidence", cursor), readOptions),
    createEvidence: (input, writeOptions) => request<Evidence>("/v1/evidence", writeRequest(writeOptions, input)),
    getAssessment: (entityId, context, readOptions = {}) => {
      const query = new URLSearchParams({ context });
      return request<Assessment>(`/v1/assessments/${encodeURIComponent(entityId)}?${query.toString()}`, readOptions);
    },
    logout: (writeOptions) => request<void>("/auth/logout", writeRequest(writeOptions, {})),
  };
}
