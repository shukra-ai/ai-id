export const coreSchema = `
CREATE TABLE IF NOT EXISTS core_domains (
 id uuid PRIMARY KEY, name text NOT NULL, auth_subject text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS core_entities (
 id uuid PRIMARY KEY, domain_id uuid NOT NULL REFERENCES core_domains(id),
 kind text NOT NULL CHECK(kind IN ('human','agent','service','organization')),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','tombstoned')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(domain_id,id)
);
CREATE TABLE IF NOT EXISTS core_principals (
 id uuid PRIMARY KEY, domain_id uuid NOT NULL REFERENCES core_domains(id), entity_id uuid NOT NULL,
 custody text NOT NULL CHECK(custody IN ('personal','organization-managed','workload-custodial')),
 role text NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(domain_id,id),
 FOREIGN KEY(domain_id,entity_id) REFERENCES core_entities(domain_id,id)
);
CREATE OR REPLACE FUNCTION core_reject_principal_rebind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.entity_id <> NEW.entity_id OR OLD.domain_id <> NEW.domain_id THEN
 RAISE EXCEPTION 'Principal bindings are immutable'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS core_principal_immutable ON core_principals;
CREATE TRIGGER core_principal_immutable BEFORE UPDATE ON core_principals FOR EACH ROW EXECUTE FUNCTION core_reject_principal_rebind();
CREATE TABLE IF NOT EXISTS core_auth_links (
 issuer text NOT NULL, subject text NOT NULL, domain_id uuid NOT NULL, principal_id uuid NOT NULL,
 PRIMARY KEY(issuer,subject), FOREIGN KEY(domain_id,principal_id) REFERENCES core_principals(domain_id,id)
);
CREATE TABLE IF NOT EXISTS core_sessions (
 hash text PRIMARY KEY, domain_id uuid NOT NULL, principal_id uuid NOT NULL, csrf text NOT NULL,
 tokens text NOT NULL, expires_at timestamptz NOT NULL, last_seen timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(domain_id,principal_id) REFERENCES core_principals(domain_id,id)
);
CREATE TABLE IF NOT EXISTS core_login_states (
 hash text PRIMARY KEY, verifier text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE core_sessions ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
CREATE TABLE IF NOT EXISTS core_api_keys (
 id uuid PRIMARY KEY, domain_id uuid NOT NULL, principal_id uuid NOT NULL, name text NOT NULL,
 hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(domain_id,principal_id) REFERENCES core_principals(domain_id,id)
);
CREATE TABLE IF NOT EXISTS core_relationships (
 id uuid PRIMARY KEY, domain_id uuid NOT NULL, subject_id uuid NOT NULL,
 resource text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(domain_id,subject_id,resource,action), FOREIGN KEY(domain_id,subject_id) REFERENCES core_principals(domain_id,id)
);
CREATE TABLE IF NOT EXISTS core_delegations (
 id uuid PRIMARY KEY, domain_id uuid NOT NULL, grantor_principal_id uuid NOT NULL, delegate_principal_id uuid NOT NULL,
 resource text NOT NULL, action text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 max_depth integer NOT NULL DEFAULT 0 CHECK(max_depth=0), epoch integer NOT NULL DEFAULT 0,
 decision_id uuid NOT NULL, policy_version text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(domain_id,grantor_principal_id) REFERENCES core_principals(domain_id,id),
 FOREIGN KEY(domain_id,delegate_principal_id) REFERENCES core_principals(domain_id,id)
);
CREATE TABLE IF NOT EXISTS core_evidence (
 id uuid PRIMARY KEY, domain_id uuid NOT NULL, subject_entity_id uuid NOT NULL, source_entity_id uuid NOT NULL,
 context text NOT NULL CHECK(context='tool.execution.v1'), outcome text NOT NULL CHECK(outcome IN ('success','failure')),
 reference_hash text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disputed')),
 provenance text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(domain_id,source_entity_id,reference_hash),
 FOREIGN KEY(domain_id,subject_entity_id) REFERENCES core_entities(domain_id,id),
 FOREIGN KEY(domain_id,source_entity_id) REFERENCES core_entities(domain_id,id)
);
CREATE TABLE IF NOT EXISTS core_audit (
 id uuid PRIMARY KEY, domain_id uuid NOT NULL REFERENCES core_domains(id), sequence bigint NOT NULL,
 actor_id uuid NOT NULL, action text NOT NULL, resource_id text NOT NULL, request_id text NOT NULL,
 occurred_at text NOT NULL, previous_hash text NOT NULL, hash text NOT NULL, data jsonb NOT NULL,
 UNIQUE(domain_id,sequence)
);
CREATE TABLE IF NOT EXISTS core_outbox (
 event_id uuid PRIMARY KEY REFERENCES core_audit(id), domain_id uuid NOT NULL, sequence bigint NOT NULL,
 event_type text NOT NULL, aggregate_id text NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), witnessed_at timestamptz
);
CREATE TABLE IF NOT EXISTS core_idempotency (
 domain_id uuid NOT NULL, principal_id uuid NOT NULL, key text NOT NULL,
 request_hash text NOT NULL, status integer NOT NULL, response jsonb NOT NULL,
 expires_at timestamptz NOT NULL, PRIMARY KEY(domain_id,principal_id,key)
);
CREATE INDEX IF NOT EXISTS core_entities_domain_idx ON core_entities(domain_id,created_at,id);
CREATE INDEX IF NOT EXISTS core_audit_domain_idx ON core_audit(domain_id,sequence);
CREATE INDEX IF NOT EXISTS core_evidence_domain_idx ON core_evidence(domain_id,subject_entity_id,created_at);
`;
