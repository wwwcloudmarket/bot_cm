create table if not exists users (
  id bigint primary key,
  username text,
  first_name text,
  last_name text,
  created_at timestamptz default now()
);

create table if not exists subscriptions (
  user_id bigint primary key references users(id) on delete cascade,
  status text not null default 'ACTIVE',
  plan text not null default 'CLOUD_PASS',
  next_billing_at timestamptz
);
