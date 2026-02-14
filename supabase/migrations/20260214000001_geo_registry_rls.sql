-- Add created_by column to track row ownership
alter table geo_registry
  add column created_by uuid references auth.users(id) default auth.uid();

-- Enable Row Level Security
alter table geo_registry enable row level security;

-- SELECT: authenticated users can read all entries
create policy "Authenticated users can view geo_registry"
  on geo_registry for select
  to authenticated
  using (true);

-- INSERT: authenticated users can insert their own entries
create policy "Authenticated users can insert geo_registry"
  on geo_registry for insert
  to authenticated
  with check (auth.uid() = created_by);

-- UPDATE: users can only update their own entries
create policy "Users can update own geo_registry entries"
  on geo_registry for update
  to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- DELETE: users can only delete their own entries
create policy "Users can delete own geo_registry entries"
  on geo_registry for delete
  to authenticated
  using (auth.uid() = created_by);
