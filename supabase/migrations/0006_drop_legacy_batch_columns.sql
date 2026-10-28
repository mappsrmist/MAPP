-- Follow-up to 0005: the per-batch section / advisor / contact / mail were copied onto every
-- batch member in 0005 and nothing writes or reads them any more. Apply this only after the v2
-- app is deployed and the batch sheets have been checked.
alter table public.batches
  drop column section,
  drop column advisor_name,
  drop column contact_number,
  drop column srm_mail;
