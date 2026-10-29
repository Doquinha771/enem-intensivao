-- Intensivão ENEM: estrutura do banco
-- Tudo fica no schema "enem", separado do schema public de outros apps do mesmo projeto.
-- Rode este arquivo inteiro no SQL Editor do Supabase (pode rodar de novo sem quebrar).
-- Depois rode seed_questions.sql e seed_keys.sql e adicione "enem" em
-- Project Settings > Data API > Exposed schemas.

create schema if not exists enem;
grant usage on schema enem to anon, authenticated;

-- ============================================================
-- Tabelas
-- ============================================================

create table if not exists enem.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  xp int not null default 0,
  show_in_ranking boolean not null default false,
  streak int not null default 0,
  best_streak int not null default 0,
  last_study date,
  created_at timestamptz not null default now()
);

create table if not exists enem.questions (
  id text primary key,            -- "2023-8" = ENEM 2023, questão 08
  year int not null,
  number int not null,
  page int not null,              -- página do PDF oficial do Inep
  theme text not null,
  stem text not null default '',
  options jsonb                   -- ["A...", "B...", ...] ou null quando as alternativas são imagens
);

-- Gabarito separado: nenhum usuário consegue ler esta tabela, só as funções do servidor.
create table if not exists enem.question_keys (
  question_id text primary key references enem.questions on delete cascade,
  answer smallint not null check (answer between 0 and 4)
);

create table if not exists enem.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  owner uuid not null references enem.profiles on delete cascade,
  question_ids text[] not null,
  created_at timestamptz not null default now()
);
-- "desafio": cada um faz sozinho e compara a nota; "coop": a equipe responde junta em tempo real
alter table enem.rooms add column if not exists mode text not null default 'desafio'
  check (mode in ('desafio', 'coop'));

create table if not exists enem.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references enem.profiles on delete cascade,
  room_id uuid references enem.rooms on delete set null,
  question_ids text[] not null,
  answers smallint[] not null,
  score int not null,
  total int not null,
  xp_gained int not null default 0,
  duration_s int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists exam_attempts_user_idx on enem.exam_attempts (user_id, created_at desc);

create table if not exists enem.answer_history (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references enem.exam_attempts on delete cascade,
  user_id uuid not null references enem.profiles on delete cascade,
  question_id text not null references enem.questions on delete cascade,
  theme text not null,
  chosen smallint,
  correct boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists answer_history_user_idx on enem.answer_history (user_id, created_at desc);

create table if not exists enem.achievements (
  code text primary key,
  name text not null,
  description text not null,
  secret boolean not null default false,
  xp int not null default 0,
  sort int not null default 0
);

create table if not exists enem.user_achievements (
  user_id uuid not null references enem.profiles on delete cascade,
  code text not null references enem.achievements on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table if not exists enem.user_missions (
  user_id uuid not null references enem.profiles on delete cascade,
  day date not null,
  code text not null,
  primary key (user_id, day, code)
);

insert into enem.achievements (code, name, description, secret, xp, sort) values
  ('primeira_prova',  'Primeiro passo',     'Termine sua primeira prova.',                       false,  20, 1),
  ('perfeccionista',  'Perfeccionista',     'Gabarite uma prova de 10 questões.',                false, 100, 2),
  ('velocista',       'Velocista',          'Termine rápido e acerte 70% ou mais.',              false,  50, 3),
  ('maratonista',     'Maratonista',        'Faça 5 provas.',                                    false,  60, 4),
  ('centenario',      'Centenário',         'Responda 100 questões.',                            false, 100, 5),
  ('sequencia3',      'Constância',         'Estude 3 dias seguidos.',                           false,  50, 6),
  ('sequencia7',      'Semana cheia',       'Estude 7 dias seguidos.',                           false, 150, 7),
  ('mestre_variacao', 'Mestre da variação', 'Acerte 10 questões de variação linguística.',       false,  80, 8),
  ('desafiante',      'Desafiante',         'Termine um desafio entre amigos.',                  false,  40, 9),
  ('parceria',        'Parceria',           'Termine uma prova no modo coop.',                   false,  40, 9),
  ('coruja',          'Coruja',             'Termine uma prova entre meia-noite e 5h.',          true,   30, 10),
  ('teimoso',         'Teimoso',            'Mude uma resposta e acerte.',                       true,   30, 11),
  ('curioso',         'Curioso',            'Achou o segredo do logo.',                          true,   25, 12),
  ('konami',          'Código secreto',     'Digitou o código mais famoso dos videogames.',      true,   50, 13)
on conflict (code) do update set name = excluded.name, description = excluded.description,
  secret = excluded.secret, xp = excluded.xp, sort = excluded.sort;

-- ============================================================
-- Segurança (RLS)
-- ============================================================

alter table enem.profiles          enable row level security;
alter table enem.questions         enable row level security;
alter table enem.question_keys     enable row level security;
alter table enem.rooms             enable row level security;
alter table enem.exam_attempts     enable row level security;
alter table enem.answer_history    enable row level security;
alter table enem.achievements      enable row level security;
alter table enem.user_achievements enable row level security;
alter table enem.user_missions     enable row level security;

drop policy if exists "ver o próprio perfil" on enem.profiles;
create policy "ver o próprio perfil" on enem.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "editar o próprio perfil" on enem.profiles;
create policy "editar o próprio perfil" on enem.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "questões são públicas" on enem.questions;
create policy "questões são públicas" on enem.questions for select to anon, authenticated using (true);
drop policy if exists "conquistas são públicas" on enem.achievements;
create policy "conquistas são públicas" on enem.achievements for select to anon, authenticated using (true);
drop policy if exists "salas visíveis para quem está logado" on enem.rooms;
create policy "salas visíveis para quem está logado" on enem.rooms for select to authenticated using (true);

drop policy if exists "ver as próprias tentativas" on enem.exam_attempts;
create policy "ver as próprias tentativas" on enem.exam_attempts for select to authenticated using (user_id = auth.uid());
drop policy if exists "ver o próprio histórico" on enem.answer_history;
create policy "ver o próprio histórico" on enem.answer_history for select to authenticated using (user_id = auth.uid());
drop policy if exists "ver as próprias conquistas" on enem.user_achievements;
create policy "ver as próprias conquistas" on enem.user_achievements for select to authenticated using (user_id = auth.uid());
drop policy if exists "ver as próprias missões" on enem.user_missions;
create policy "ver as próprias missões" on enem.user_missions for select to authenticated using (user_id = auth.uid());

-- Leitura liberada (o RLS acima filtra as linhas); ninguém escreve direto: tudo passa pelas funções abaixo.
grant select on all tables in schema enem to anon, authenticated;
revoke insert, update, delete on all tables in schema enem from anon, authenticated;
revoke all on enem.question_keys from anon, authenticated;
-- No perfil, o usuário só muda o apelido e se aparece no ranking (XP nunca).
grant update (username, show_in_ranking) on enem.profiles to authenticated;

-- ============================================================
-- Perfil do Intensivão, criado pelo site no primeiro acesso.
-- (Sem gatilho em auth.users, porque o login é compartilhado com outros apps do projeto.)
-- ============================================================

create or replace function enem.ensure_profile(p_username text default null) returns enem.profiles
language plpgsql security definer set search_path = enem as $$
declare
  uid uuid := auth.uid();
  base text := left(coalesce(nullif(regexp_replace(coalesce(p_username, ''), '[^A-Za-z0-9_]', '', 'g'), ''), 'estudante'), 18);
  v text;
  p profiles%rowtype;
begin
  if uid is null then raise exception 'Faça login.'; end if;
  select * into p from profiles where id = uid;
  if found then return p; end if;
  if char_length(base) < 3 then base := 'estudante'; end if;
  v := base;
  while exists (select 1 from profiles where username = v) loop
    v := base || '_' || substr(md5(random()::text), 1, 4);
  end loop;
  insert into profiles (id, username) values (uid, v) on conflict (id) do nothing;
  select * into p from profiles where id = uid;
  return p;
end $$;

-- ============================================================
-- Funções
-- ============================================================

create or replace function enem.level_for(p_xp int) returns int
language sql immutable as $$ select floor(sqrt(greatest(p_xp, 0) / 50.0))::int + 1 $$;

create or replace function enem.today_br() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Missões diárias e o progresso de um usuário num dia
create or replace function enem.mission_progress(p_uid uuid, p_day date)
returns table (code text, name text, xp int, progress int, goal int)
language sql stable security definer set search_path = enem as $$
  select 'questoes10', 'Responder 10 questões', 30,
         (select count(*)::int from answer_history h where h.user_id = p_uid
            and (h.created_at at time zone 'America/Sao_Paulo')::date = p_day), 10
  union all
  select 'prova80', 'Acertar 80% em uma prova', 40,
         coalesce((select max(round(a.score * 100.0 / a.total))::int from exam_attempts a where a.user_id = p_uid
            and a.total >= 5 and (a.created_at at time zone 'America/Sao_Paulo')::date = p_day), 0), 80
  union all
  select 'duas_provas', 'Fazer 2 provas', 30,
         (select count(*)::int from exam_attempts a where a.user_id = p_uid
            and (a.created_at at time zone 'America/Sao_Paulo')::date = p_day), 2
$$;

create or replace function enem.my_missions()
returns table (code text, name text, xp int, progress int, goal int, claimed boolean)
language sql stable security definer set search_path = enem as $$
  select m.code, m.name, m.xp, least(m.progress, m.goal), m.goal,
         exists (select 1 from user_missions u where u.user_id = auth.uid() and u.day = today_br() and u.code = m.code)
  from mission_progress(auth.uid(), today_br()) m
$$;

-- Corrige a prova no servidor, salva tudo, dá XP, missões e conquistas.
create or replace function enem.submit_attempt(
  p_question_ids text[],
  p_answers smallint[],
  p_flipped boolean[] default null,
  p_duration_s int default 0,
  p_room_code text default null
) returns jsonb
language plpgsql security definer set search_path = enem as $$
declare
  uid uuid := auth.uid();
  n int := coalesce(array_length(p_question_ids, 1), 0);
  v_room rooms%rowtype;
  v_keys smallint[];
  v_score int;
  v_flip_right int;
  v_xp int;
  v_bonus int := 0;
  v_aid uuid;
  v_today date := today_br();
  v_hour int := extract(hour from now() at time zone 'America/Sao_Paulo');
  v_prof profiles%rowtype;
  v_streak int;
  v_new_ach jsonb := '[]'::jsonb;
  v_new_mis jsonb := '[]'::jsonb;
  r record;
begin
  if uid is null then raise exception 'Faça login para enviar a prova.'; end if;
  if n < 1 or n > 45 or n <> coalesce(array_length(p_answers, 1), 0) then raise exception 'Prova inválida.'; end if;
  if (select count(distinct q) from unnest(p_question_ids) q) <> n then raise exception 'Há questões repetidas.'; end if;
  if exists (select 1 from unnest(p_answers) a where a is not null and (a < 0 or a > 4)) then raise exception 'Resposta inválida.'; end if;

  insert into profiles (id, username)
  values (uid, 'estudante_' || substr(replace(uid::text, '-', ''), 1, 8)) on conflict do nothing;

  if p_room_code is not null then
    select * into v_room from rooms where code = upper(p_room_code);
    if not found then raise exception 'Desafio não encontrado.'; end if;
    if v_room.question_ids <> p_question_ids then raise exception 'As questões não batem com o desafio.'; end if;
    if exists (select 1 from exam_attempts where room_id = v_room.id and user_id = uid) then
      raise exception 'Você já fez este desafio.';
    end if;
  end if;

  select array_agg(k.answer order by u.ord) into v_keys
  from unnest(p_question_ids) with ordinality u(qid, ord)
  join question_keys k on k.question_id = u.qid;
  if coalesce(array_length(v_keys, 1), 0) <> n then raise exception 'Questão desconhecida.'; end if;

  select count(*) filter (where p_answers[i] = v_keys[i]),
         count(*) filter (where p_answers[i] = v_keys[i] and coalesce(p_flipped[i], false))
    into v_score, v_flip_right
  from generate_subscripts(p_question_ids, 1) i;

  v_xp := v_score * 10 + 20 + case when v_score = n and n >= 10 then 50 else 0 end;
  -- Prova "entregue" rápido demais (menos de 8 s por questão) não rende XP.
  if p_duration_s < n * 8 then v_xp := 0; end if;

  insert into exam_attempts (user_id, room_id, question_ids, answers, score, total, xp_gained, duration_s)
  values (uid, v_room.id, p_question_ids, p_answers, v_score, n, v_xp, greatest(p_duration_s, 0))
  returning id into v_aid;

  insert into answer_history (attempt_id, user_id, question_id, theme, chosen, correct)
  select v_aid, uid, p_question_ids[i], q.theme, p_answers[i], coalesce(p_answers[i] = v_keys[i], false)
  from generate_subscripts(p_question_ids, 1) i
  join questions q on q.id = p_question_ids[i];

  select * into v_prof from profiles where id = uid for update;
  v_streak := case
    when v_prof.last_study = v_today then greatest(v_prof.streak, 1)
    when v_prof.last_study = v_today - 1 then v_prof.streak + 1
    else 1 end;

  if v_xp > 0 then
    for r in select * from mission_progress(uid, v_today) m where m.progress >= m.goal loop
      insert into user_missions (user_id, day, code) values (uid, v_today, r.code) on conflict do nothing;
      if found then
        v_bonus := v_bonus + r.xp;
        v_new_mis := v_new_mis || jsonb_build_object('name', r.name, 'xp', r.xp);
      end if;
    end loop;
  end if;

  for r in
    select a.code, a.name, a.xp from achievements a
    where a.code = any (array_remove(array[
      'primeira_prova',
      case when v_score = n and n >= 10 then 'perfeccionista' end,
      case when p_duration_s >= n * 8 and p_duration_s < n * 30 and v_score >= ceil(n * 0.7) then 'velocista' end,
      case when (select count(*) from exam_attempts where user_id = uid) >= 5 then 'maratonista' end,
      case when (select count(*) from answer_history where user_id = uid) >= 100 then 'centenario' end,
      case when v_streak >= 3 then 'sequencia3' end,
      case when v_streak >= 7 then 'sequencia7' end,
      case when v_hour < 5 then 'coruja' end,
      case when v_flip_right > 0 then 'teimoso' end,
      case when v_room.mode = 'desafio' then 'desafiante' end,
      case when v_room.mode = 'coop' then 'parceria' end,
      case when (select count(*) from answer_history where user_id = uid and correct
                 and theme = 'Variação linguística') >= 10 then 'mestre_variacao' end
    ], null))
  loop
    insert into user_achievements (user_id, code) values (uid, r.code) on conflict do nothing;
    if found then
      v_bonus := v_bonus + r.xp;
      v_new_ach := v_new_ach || jsonb_build_object('code', r.code, 'name', r.name, 'xp', r.xp);
    end if;
  end loop;

  update profiles set xp = xp + v_xp + v_bonus, streak = v_streak,
    best_streak = greatest(best_streak, v_streak), last_study = v_today
  where id = uid returning * into v_prof;
  update exam_attempts set xp_gained = v_xp + v_bonus where id = v_aid;

  return jsonb_build_object(
    'attempt_id', v_aid, 'score', v_score, 'total', n,
    'xp_gained', v_xp + v_bonus, 'xp', v_prof.xp, 'level', level_for(v_prof.xp),
    'streak', v_streak, 'keys', to_jsonb(v_keys),
    'achievements', v_new_ach, 'missions', v_new_mis);
end $$;

-- Conquistas de easter egg (só estas podem ser liberadas pelo navegador)
create or replace function enem.unlock_secret(p_code text) returns jsonb
language plpgsql security definer set search_path = enem as $$
declare uid uuid := auth.uid(); a achievements%rowtype;
begin
  if uid is null then raise exception 'Faça login.'; end if;
  if p_code not in ('curioso', 'konami') then raise exception 'Segredo inválido.'; end if;
  select * into a from achievements where code = p_code;
  insert into user_achievements (user_id, code) values (uid, p_code) on conflict do nothing;
  if not found then return null; end if;
  update profiles set xp = xp + a.xp where id = uid;
  return jsonb_build_object('code', a.code, 'name', a.name, 'xp', a.xp);
end $$;

-- Desafios e salas coop entre amigos
drop function if exists enem.create_room(text[], int);
create or replace function enem.create_room(p_themes text[], p_n int default 10, p_mode text default 'desafio') returns jsonb
language plpgsql security definer set search_path = enem as $$
declare uid uuid := auth.uid(); v_ids text[]; v_code text;
begin
  if uid is null then raise exception 'Faça login.'; end if;
  if p_mode not in ('desafio', 'coop') then raise exception 'Modo inválido.'; end if;
  v_ids := array(select id from questions where theme = any (p_themes)
                 order by random() limit least(greatest(coalesce(p_n, 10), 5), 20));
  if coalesce(array_length(v_ids, 1), 0) < 5 then raise exception 'Escolha mais temas.'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from rooms where code = v_code);
  end loop;
  insert into rooms (code, owner, question_ids, mode) values (v_code, uid, v_ids, p_mode);
  return jsonb_build_object('code', v_code, 'question_ids', to_jsonb(v_ids), 'mode', p_mode);
end $$;

create or replace function enem.get_room(p_code text) returns jsonb
language sql stable security definer set search_path = enem as $$
  select jsonb_build_object('code', r.code, 'question_ids', to_jsonb(r.question_ids), 'mode', r.mode,
    'owner', p.username, 'created_at', r.created_at,
    'done', exists (select 1 from exam_attempts a where a.room_id = r.id and a.user_id = auth.uid()))
  from rooms r join profiles p on p.id = r.owner
  where r.code = upper(p_code) and auth.uid() is not null
$$;

create or replace function enem.room_scoreboard(p_code text)
returns table (username text, score int, total int, duration_s int, finished_at timestamptz, is_me boolean)
language sql stable security definer set search_path = enem as $$
  select p.username, a.score, a.total, a.duration_s, a.created_at, a.user_id = auth.uid()
  from rooms r join exam_attempts a on a.room_id = r.id join profiles p on p.id = a.user_id
  where r.code = upper(p_code) and auth.uid() is not null
  order by a.score desc, a.duration_s asc
$$;

-- Ranking semanal: só aparece quem ativou no perfil (você sempre se vê)
create or replace function enem.weekly_ranking()
returns table (username text, xp_week int, level int, is_me boolean)
language sql stable security definer set search_path = enem as $$
  select p.username, sum(a.xp_gained)::int, level_for(p.xp), p.id = auth.uid()
  from exam_attempts a join profiles p on p.id = a.user_id
  where a.created_at > now() - interval '7 days'
    and (p.show_in_ranking or p.id = auth.uid()) and auth.uid() is not null
  group by p.id, p.username, p.xp
  order by 2 desc
  limit 50
$$;

revoke execute on all functions in schema enem from public, anon;
grant execute on function
  enem.level_for(int), enem.today_br(), enem.my_missions(), enem.ensure_profile(text),
  enem.submit_attempt(text[], smallint[], boolean[], int, text),
  enem.unlock_secret(text), enem.create_room(text[], int, text),
  enem.get_room(text), enem.room_scoreboard(text), enem.weekly_ranking()
to authenticated;
