-- EventSession."type" became TEXT in 20260915010000_simplify_event_session_fields,
-- which left this enum unused. No column references it, so dropping it touches
-- no table and takes no table lock.
DROP TYPE IF EXISTS "EventSessionType";
