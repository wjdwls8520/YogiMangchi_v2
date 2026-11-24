-- Additive cutover. Stop old writers/workers before exposing the new endpoints.
ALTER TABLE position
    ADD COLUMN stop_loss_status VARCHAR(16) NOT NULL DEFAULT 'NONE',
    ADD COLUMN stop_loss_price NUMERIC(38,18),
    ADD COLUMN stop_loss_version BIGINT NOT NULL DEFAULT 0 CHECK(stop_loss_version>=0),
    ADD COLUMN stop_loss_updated_at TIMESTAMPTZ,
    ADD COLUMN stop_loss_triggered_at TIMESTAMPTZ,
    ADD COLUMN stop_loss_price_event_time TIMESTAMPTZ,
    ADD COLUMN stop_loss_trigger_price NUMERIC(38,18),
    ADD COLUMN stop_loss_trigger_order_id BIGINT REFERENCES trading_order(id),
    ADD COLUMN stop_loss_reason VARCHAR(32),
    ADD CONSTRAINT position_stop_loss_state CHECK (
      (stop_loss_status='NONE' AND stop_loss_price IS NULL AND stop_loss_version=0) OR
      (stop_loss_status IN ('ACTIVE','CANCELED','TRIGGERED','EXPIRED') AND stop_loss_price>0
       AND stop_loss_version>0 AND stop_loss_updated_at IS NOT NULL
       AND (stop_loss_status<>'ACTIVE' OR status='OPEN')));

CREATE TABLE position_stop_loss_command (
    account_id BIGINT NOT NULL REFERENCES trading_account(id),
    request_key VARCHAR(100) NOT NULL,
    position_id BIGINT NOT NULL REFERENCES position(id),
    request_fingerprint VARCHAR(64) NOT NULL,
    response JSONB NOT NULL CHECK(jsonb_typeof(response)='object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(account_id,request_key)
);

ALTER TABLE trading_event ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE trading_event ALTER COLUMN order_status DROP NOT NULL;
ALTER TABLE trading_event ADD COLUMN position_id BIGINT REFERENCES position(id),
    ADD COLUMN stop_loss_version BIGINT;
ALTER TABLE trading_event DROP CONSTRAINT trading_event_event_type_check;
ALTER TABLE trading_event ADD CONSTRAINT trading_event_event_type_check CHECK(event_type IN
    ('ORDER_PENDING','ORDER_FILLED','ORDER_CANCELED','ORDER_REJECTED','POSITION_LIQUIDATED','STOP_LOSS_CHANGED'));
ALTER TABLE trading_event ADD CONSTRAINT trading_event_source_check CHECK (
    (event_type='STOP_LOSS_CHANGED' AND order_id IS NULL AND order_status IS NULL AND position_id IS NOT NULL AND stop_loss_version>0)
    OR (event_type<>'STOP_LOSS_CHANGED' AND order_id IS NOT NULL AND order_status IS NOT NULL AND position_id IS NULL AND stop_loss_version IS NULL));
CREATE UNIQUE INDEX trading_event_stop_loss_version ON trading_event(position_id,stop_loss_version)
    WHERE event_type='STOP_LOSS_CHANGED';

-- Existing financial round rules retained; setting events inherit the immutable owned position round.
CREATE OR REPLACE FUNCTION assign_member_round() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE rid BIGINT; guest BOOLEAN;
BEGIN
 IF TG_TABLE_NAME IN ('fill','trading_event') THEN
   IF TG_TABLE_NAME='trading_event' THEN
     IF NEW.order_id IS NULL THEN
       SELECT round_id INTO rid FROM position WHERE id=NEW.position_id AND account_id=NEW.account_id;
       IF NOT FOUND THEN RAISE EXCEPTION 'Owned stop loss position required'; END IF;
     ELSE
       SELECT round_id INTO rid FROM trading_order WHERE id=NEW.order_id;
     END IF;
   ELSE
     SELECT round_id INTO rid FROM trading_order WHERE id=NEW.order_id;
   END IF;
 ELSE
   SELECT guest_account INTO guest FROM trading_account WHERE id=NEW.account_id;
   IF guest THEN rid:=NULL;
   ELSE
     SELECT id INTO rid FROM member_trading_round WHERE account_id=NEW.account_id AND status='ACTIVE';
     IF rid IS NULL THEN RAISE EXCEPTION 'Active member round required'; END IF;
   END IF;
 END IF;
 IF NEW.round_id IS NOT NULL AND NEW.round_id IS DISTINCT FROM rid THEN RAISE EXCEPTION 'Invalid financial round'; END IF;
 IF TG_TABLE_NAME='fill' AND rid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM member_trading_round WHERE id=rid AND status='ACTIVE') THEN RAISE EXCEPTION 'Completed round cannot receive a new fill'; END IF;
 NEW.round_id:=rid;
 RETURN NEW;
END $$;
