-- V26: Allow CANCELED status on contest_application for voluntary cancellation and member withdrawal cleanup

ALTER TABLE contest_application
    DROP CONSTRAINT IF EXISTS contest_application_status_check;

ALTER TABLE contest_application
    ADD CONSTRAINT contest_application_status_check
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED'));
