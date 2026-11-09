create table if not exists public.wines (
  id uuid primary key default gen_random_uuid(),
  producer text not null,
  name text not null,
  region text default '',
  grape text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.tastings (
  id uuid primary key default gen_random_uuid(),
  wine_id uuid not null references public.wines(id) on delete cascade,
  vintage text not null check (vintage = 'NV' or vintage ~ '^[0-9]{4}$'),
  rating int not null check (rating between 50 and 100),
  price numeric check (price is null or price >= 0),
  created_at timestamptz not null default now()
);

alter table public.wines enable row level security;
alter table public.tastings enable row level security;

-- Open access by request: anyone with the link can read, add, edit and delete.
create policy "open wines" on public.wines for all to anon using (true) with check (true);
create policy "open tastings" on public.tastings for all to anon using (true) with check (true);

-- Existing entries
with w1 as (
  insert into public.wines (producer, name, region, grape)
  values ('Artadi', 'Viña de Gain', 'Rioja', 'Tempranillo') returning id
), w2 as (
  insert into public.wines (producer, name, region, grape)
  values ('Abadia Retuerta', 'Valdebellon', 'Sardon de Duero', 'Tempranillo') returning id
)
insert into public.tastings (wine_id, vintage, rating, price)
select id, '2019', 82, 48 from w1
union all
select id, '2019', 90, 105 from w2;
