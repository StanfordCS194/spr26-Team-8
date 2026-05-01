create extension if not exists vector;

create table if not exists image_embeddings (
  memory_id  uuid not null references memories(memory_id) on delete cascade,
  user_id    uuid not null,
  model_name text not null,
  embedding  vector(512) not null,
  created_at timestamptz not null default now(),
  primary key (memory_id, model_name)
);

create index if not exists image_embeddings_hnsw
  on image_embeddings using hnsw (embedding vector_cosine_ops);

alter table image_embeddings enable row level security;

create policy "image_embeddings_select_own" on image_embeddings
  for select using (auth.uid() = user_id);
create policy "image_embeddings_insert_own" on image_embeddings
  for insert with check (auth.uid() = user_id);

create or replace function search_memories_by_embedding(
  query_embedding   vector(512),
  match_count       int     default 30,
  model_name_filter text    default null
) returns table (memory_id uuid, distance float)
language sql stable security invoker
as $$
  select e.memory_id, e.embedding <=> query_embedding as distance
  from image_embeddings e
  where (model_name_filter is null or e.model_name = model_name_filter)
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
