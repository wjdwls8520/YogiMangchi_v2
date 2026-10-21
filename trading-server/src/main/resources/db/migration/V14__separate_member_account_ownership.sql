-- Preserve every existing Guest ID/credential/wallet. Content member IDs are scalar references, never cross-schema FKs.
ALTER TABLE trading_account ADD COLUMN member_id BIGINT UNIQUE;
ALTER TABLE trading_account ALTER COLUMN credential_hash DROP NOT NULL;
ALTER TABLE trading_account ALTER COLUMN credential_expires_at DROP NOT NULL;
ALTER TABLE trading_account ADD CONSTRAINT account_ownership_check CHECK (
    (guest_account AND member_id IS NULL AND credential_hash IS NOT NULL AND credential_expires_at IS NOT NULL)
    OR (NOT guest_account AND member_id IS NOT NULL AND member_id>0 AND credential_hash IS NULL AND credential_expires_at IS NULL)
);
