-- V1.4.6 Phase 5: wallet reassignment intent carried as server-owned authorization-session state.
-- Additive only. The previous active wallet and explicit replacement confirmation are frozen
-- at /authorize and revalidated at /token before any Agent Context mutation.
ALTER TABLE oauth_authorization_sessions ADD COLUMN previous_wallet_id TEXT;
ALTER TABLE oauth_authorization_sessions ADD COLUMN replacement_confirmed INTEGER NOT NULL DEFAULT 0;
