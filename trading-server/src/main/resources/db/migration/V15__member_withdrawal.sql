ALTER TABLE trading_account DROP CONSTRAINT trading_account_status_check;
ALTER TABLE trading_account ADD CONSTRAINT trading_account_status_check CHECK (status IN ('ACTIVE','BANKRUPT','WITHDRAWN'));
ALTER TABLE trading_account ADD COLUMN withdrawn_at TIMESTAMPTZ;
ALTER TABLE trading_account ADD CONSTRAINT account_withdrawal_state CHECK (
    (status='WITHDRAWN' AND NOT guest_account AND withdrawn_at IS NOT NULL) OR
    (status<>'WITHDRAWN' AND withdrawn_at IS NULL));

ALTER TABLE position ADD COLUMN close_reason VARCHAR(32);
ALTER TABLE position DROP CONSTRAINT position_close_state;
ALTER TABLE position ADD CONSTRAINT position_close_state CHECK (
    (close_reason IS NULL AND (
      (status='OPEN' AND quantity>0 AND margin>0 AND entry_notional>0 AND closed_at IS NULL AND exit_price IS NULL AND merged_into_position_id IS NULL) OR
      (status IN ('CLOSED','LIQUIDATED') AND quantity=0 AND margin=0 AND entry_notional=0 AND closed_at IS NOT NULL AND exit_price IS NOT NULL AND exit_price>0 AND merged_into_position_id IS NULL) OR
      (status='MERGED' AND merged_into_position_id IS NOT NULL AND merged_into_position_id<>id))) OR
    (close_reason IS NOT NULL AND close_reason='MEMBER_WITHDRAWAL' AND status='CLOSED' AND quantity=0 AND margin=0 AND entry_notional=0
      AND reserved_close_quantity=0 AND closed_at IS NOT NULL AND exit_price IS NULL AND merged_into_position_id IS NULL));
