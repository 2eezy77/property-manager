-- Remove legacy owner login isaac@743aave.local; keep josemontero2002@gmail.com as sole owner.
DO $migration$
DECLARE
  v_legacy UUID;
  v_owner  UUID;
  v_pair   TEXT[];
  v_tbl    TEXT;
  v_col    TEXT;
BEGIN
  SELECT id INTO v_legacy FROM users WHERE email = 'isaac@743aave.local';
  IF v_legacy IS NULL THEN
    RAISE NOTICE 'isaac@743aave.local not found — skip';
    RETURN;
  END IF;

  SELECT id INTO v_owner FROM users WHERE email = 'josemontero2002@gmail.com' LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Cannot remove legacy owner: josemontero2002@gmail.com not found';
  END IF;

  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['organizations', 'owner_id'],
    ARRAY['leases', 'created_by'],
    ARRAY['utility_bills', 'created_by'],
    ARRAY['announcements', 'sender_id'],
    ARRAY['maintenance_requests', 'assigned_to'],
    ARRAY['maintenance_status_history', 'changed_by'],
    ARRAY['maintenance_notes', 'author_id'],
    ARRAY['maintenance_attachments', 'uploaded_by'],
    ARRAY['message_threads', 'escalated_to'],
    ARRAY['messages', 'sender_user_id'],
    ARRAY['audit_logs', 'actor_user_id'],
    ARRAY['audit_logs', 'acknowledged_by'],
    ARRAY['utility_bill_splits', 'waived_by'],
    ARRAY['payments', 'waived_by'],
    ARRAY['access_codes', 'created_by'],
    ARRAY['access_codes', 'revoked_by'],
    ARRAY['impersonation_sessions', 'created_by'],
    ARRAY['impersonation_sessions', 'revoked_by'],
    ARRAY['owner_finance_checklist', 'owner_id'],
    ARRAY['owner_mortgage_statements', 'owner_id'],
    ARRAY['manager_playbook_checklist', 'manager_id']
  ]
  LOOP
    v_tbl := v_pair[1];
    v_col := v_pair[2];
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = v_col
    ) THEN
      EXECUTE format(
        'UPDATE %I SET %I = $1 WHERE %I = $2',
        v_tbl, v_col, v_col
      ) USING v_owner, v_legacy;
    END IF;
  END LOOP;

  DELETE FROM refresh_tokens WHERE user_id = v_legacy;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'property_assignments') THEN
    DELETE FROM property_assignments WHERE user_id = v_legacy;
  END IF;
  DELETE FROM notifications WHERE user_id = v_legacy;

  DELETE FROM users WHERE id = v_legacy;
END $migration$;
