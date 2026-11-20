-- How each shop works through rafts, used to calculate the turnaround figure:
-- rafts are opened in batches, a batch takes a few working days, and a finished
-- raft needs a little longer for invoicing and return.

alter table locations add column batch_size integer check (batch_size between 1 and 200);
alter table locations add column batch_days integer check (batch_days between 1 and 60);
alter table locations add column handoff_days integer check (handoff_days between 0 and 60);

update locations set batch_size = 20, batch_days = 3, handoff_days = 2 where code = 'york';
