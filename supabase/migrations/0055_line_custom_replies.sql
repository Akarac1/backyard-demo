-- 0055: admin-defined answers for the LINE chat bot (Settings > LINE auto-replies).
-- Each item: { title, answer, keywords[], enabled, button_label, button_url }. Order = priority (first match wins).
alter table settings add column if not exists line_replies jsonb not null default '[]'::jsonb;

-- error: invalid_line_replies | not_allowed
create or replace function admin_set_line_replies(p_actor uuid, p_replies jsonb) returns settings
language plpgsql set search_path = public as $$
declare
  a staff_users; s settings; r jsonb; k text;
  clean jsonb := '[]'::jsonb; kw jsonb;
  v_title text; v_answer text; v_lbl text; v_url text;
begin
  a := staff_require_admin(p_actor);
  if p_replies is null or jsonb_typeof(p_replies) <> 'array' or jsonb_array_length(p_replies) > 30 then
    raise exception 'invalid_line_replies';
  end if;
  for r in select * from jsonb_array_elements(p_replies) loop
    if jsonb_typeof(r) <> 'object' then raise exception 'invalid_line_replies'; end if;
    v_title := btrim(coalesce(r->>'title', ''));
    v_answer := btrim(coalesce(r->>'answer', ''));
    v_lbl := btrim(coalesce(r->>'button_label', ''));
    v_url := btrim(coalesce(r->>'button_url', ''));
    kw := '[]'::jsonb;
    if jsonb_typeof(r->'keywords') = 'array' then
      for k in select btrim(t.v) from jsonb_array_elements_text(r->'keywords') as t(v) loop
        if k = '' then continue; end if;
        if char_length(k) < 2 or char_length(k) > 40 then raise exception 'invalid_line_replies'; end if;
        if not (kw ? k) then kw := kw || to_jsonb(k); end if;
      end loop;
    end if;
    -- a completely empty row (added but never filled in) is dropped
    if v_title = '' and v_answer = '' and jsonb_array_length(kw) = 0 and v_lbl = '' and v_url = '' then continue; end if;
    if char_length(v_title) not between 1 and 40 or char_length(v_answer) not between 1 and 1000
       or jsonb_array_length(kw) not between 1 and 10 then
      raise exception 'invalid_line_replies';
    end if;
    if (v_lbl = '') <> (v_url = '') or char_length(v_lbl) > 20 or char_length(v_url) > 500
       or (v_url <> '' and v_url !~ '^(https://|tel:)') then
      raise exception 'invalid_line_replies';
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object(
      'title', v_title, 'answer', v_answer, 'keywords', kw,
      'enabled', coalesce(r->>'enabled', 'true') <> 'false',
      'button_label', v_lbl, 'button_url', v_url));
  end loop;
  update settings set line_replies = clean where id = 1 returning * into s;
  perform audit(a, 'line_replies', 'settings', '1', jsonb_build_object('count', jsonb_array_length(clean)));
  return s;
end $$;

revoke all on function admin_set_line_replies(uuid, jsonb) from public, anon, authenticated;
grant execute on function admin_set_line_replies(uuid, jsonb) to service_role;
