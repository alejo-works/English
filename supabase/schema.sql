-- English Deck · esquema de Supabase (fase 2)
-- Pégalo entero en Supabase → SQL Editor → New query → Run. Se puede ejecutar más de una vez.

-- Estado FSRS actual de cada tarjeta (una fila por usuario y tarjeta)
create table if not exists public.card_state (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key         text        not null,               -- "vocab:follow-up-on" / "error:pp-yesterday"
  kind        text        not null check (kind in ('vocab', 'error')),
  card_id     text        not null,               -- id del CSV
  state       smallint    not null,               -- 0 new, 1 learning, 2 review, 3 relearning
  due         timestamptz not null,
  last_review timestamptz,
  stability   double precision not null default 0,
  difficulty  double precision not null default 0,
  reps        integer     not null default 0,
  lapses      integer     not null default 0,
  card        jsonb       not null,               -- tarjeta ts-fsrs completa
  updated_at  timestamptz not null,               -- cuándo cambió en el dispositivo (gana el más reciente)
  synced_at   timestamptz not null default now(), -- cuándo llegó al servidor (cursor de sincronización)
  primary key (user_id, key)
);

-- Historial de repasos (solo se añade; el id lo genera el dispositivo para no duplicar)
create table if not exists public.review_log (
  id             uuid        primary key,
  user_id        uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key            text        not null,
  kind           text        not null check (kind in ('vocab', 'error')),
  card_id        text        not null,
  rating         smallint    not null check (rating between 1 and 4),
  state          smallint    not null,            -- estado ANTES de valorar
  review         timestamptz not null,
  due            timestamptz not null,
  stability      double precision not null,
  difficulty     double precision not null,
  scheduled_days integer     not null default 0,
  mode           text        not null default 'normal',
  synced_at      timestamptz not null default now()
);

create index if not exists card_state_synced_idx on public.card_state (user_id, synced_at);
create index if not exists review_log_synced_idx on public.review_log (user_id, synced_at);
create index if not exists review_log_key_idx    on public.review_log (user_id, key);

-- synced_at siempre lo pone el servidor
create or replace function public.touch_synced_at() returns trigger
language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end $$;

drop trigger if exists card_state_touch on public.card_state;
create trigger card_state_touch before insert or update on public.card_state
  for each row execute function public.touch_synced_at();

drop trigger if exists review_log_touch on public.review_log;
create trigger review_log_touch before insert or update on public.review_log
  for each row execute function public.touch_synced_at();

-- RLS: cada usuario solo ve y toca sus filas
alter table public.card_state enable row level security;
alter table public.review_log enable row level security;

drop policy if exists "card_state propio" on public.card_state;
create policy "card_state propio" on public.card_state
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "review_log propio" on public.review_log;
create policy "review_log propio" on public.review_log
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Las Actions usan la service key (se salta RLS); el rol anon no tiene acceso.
revoke all on public.card_state, public.review_log from anon;
grant select, insert, update, delete on public.card_state, public.review_log to authenticated;
