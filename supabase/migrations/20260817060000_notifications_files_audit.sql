-- =============================================================================
--  Migration : 20260817006000_notifications_files_audit
--  Phase     : 5/6 — الإشعارات، الملفات، سجل التدقيق، وطبقة التكامل
--  Reference : docs/DATABASE.md §2.6 · §2.7 · §2.8
--
--  ⚠️ ممنوع تخزين أي مفاتيح مزوّدين هنا — تبقى في متغيرات البيئة.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) الإشعارات
-- -----------------------------------------------------------------------------
create table if not exists public.notification_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  branch_id       uuid        references public.branches(id) on delete cascade,
  key             text        not null,
  channel         text        not null check (channel in ('sms', 'email', 'push', 'whatsapp')),
  locale          text        not null default 'ar',
  subject         text,
  body            text        not null,
  -- أسماء المتغيرات المسموح بها داخل القالب، للتحقق قبل الإرسال
  variables       jsonb       not null default '[]'::jsonb,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint notification_templates_key_channel_locale_key
    unique (organization_id, key, channel, locale)
);

comment on table public.notification_templates is
  'قوالب الرسائل. متى تُرسل ومن يعتمد نصها = P-17 معلّقة.';

create table if not exists public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations(id) on delete cascade,
  branch_id           uuid        references public.branches(id) on delete set null,
  channel             text        not null check (channel in ('sms', 'email', 'push', 'whatsapp', 'in_app')),
  template_key        text,
  -- المستلم: رقم/بريد للقنوات الخارجية، أو معرّف مستخدم للإشعار داخل النظام
  recipient           text,
  recipient_user_id   uuid        references public.profiles(id) on delete cascade,
  recipient_customer_id uuid      references public.customers(id) on delete set null,
  subject             text,
  body                text,
  payload             jsonb       not null default '{}'::jsonb,
  status              text        not null default 'queued'
                        check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
  attempts            integer     not null default 0 check (attempts >= 0),
  max_attempts        integer     not null default 3 check (max_attempts > 0),
  last_error          text,
  provider            text,
  provider_message_id text,
  scheduled_at        timestamptz,
  sent_at             timestamptz,
  -- للإشعارات داخل النظام: مقروء/غير مقروء
  read_at             timestamptz,
  source_module       text,
  source_record_id    uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid
);

create index if not exists notifications_status_scheduled_idx
  on public.notifications (status, scheduled_at) where status in ('queued', 'sending');
create index if not exists notifications_recipient_user_idx
  on public.notifications (recipient_user_id, read_at);
create index if not exists notifications_org_created_idx
  on public.notifications (organization_id, created_at desc);

comment on column public.notifications.last_error is
  'رسالة خطأ المزوّد. ⚠️ يُمنع تخزين أي مفتاح أو توكن هنا — يُنقّى قبل الكتابة.';

create table if not exists public.notification_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  branch_id       uuid        references public.branches(id) on delete set null,
  notification_id uuid        not null references public.notifications(id) on delete cascade,
  attempt_no      integer     not null check (attempt_no > 0),
  provider        text,
  status          text        not null,
  response_code   text,
  response_message text,
  created_at      timestamptz not null default now()
);

create index if not exists notification_logs_notification_idx
  on public.notification_logs (notification_id, attempt_no);

-- -----------------------------------------------------------------------------
-- 2) الملفات — البيانات الوصفية فقط؛ المحتوى في Supabase Storage
-- -----------------------------------------------------------------------------
create table if not exists public.files (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations(id) on delete restrict,
  branch_id        uuid        references public.branches(id) on delete restrict,
  bucket           text        not null default 'documents',
  storage_path     text        not null,
  file_name        text        not null,
  mime_type        text,
  size_bytes       bigint      check (size_bytes >= 0),
  checksum         text,
  -- ارتباط الملف بأي كيان (عميل، أمر شراء، مستند…)
  entity_type      text,
  entity_id        uuid,
  -- الصلاحية المطلوبة لعرض/تنزيل هذا الملف
  required_permission text,
  is_public        boolean     not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  constraint files_bucket_path_key unique (bucket, storage_path)
);

create index if not exists files_entity_idx on public.files (entity_type, entity_id);
create index if not exists files_org_idx on public.files (organization_id, created_at desc);

comment on table public.files is
  'بيانات وصفية للملفات. الملفات نفسها في Supabase Storage في buckets خاصة. '
  'is_public افتراضيًا false — لا يُرفع إلا بقرار موثّق.';

-- -----------------------------------------------------------------------------
-- 3) سجل التدقيق — append-only
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  branch_id       uuid        references public.branches(id) on delete set null,
  user_id         uuid        references public.profiles(id) on delete set null,
  action          text        not null,
  module          text        not null,
  entity_type     text        not null,
  entity_id       uuid,
  old_values      jsonb,
  new_values      jsonb,
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_user_idx on public.audit_logs (user_id, created_at desc);
create index if not exists audit_logs_branch_idx on public.audit_logs (branch_id, created_at desc);

comment on table public.audit_logs is
  'سجل تدقيق append-only. ⚠️ ممنوع تسجيل كلمات مرور أو توكنات أو مفاتيح — '
  'التنقية تتم في طبقة التطبيق قبل الكتابة (packages/core/src/audit).';

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function app.prevent_mutation();

-- -----------------------------------------------------------------------------
-- 4) طبقة التكامل مع النظام القديم — حجز معماري فقط
--    ⚠️ لا يوجد أي كود تكامل. النظام القديم غير معروف بعد (Q-17).
--    المخطط integration غير مكشوف عبر PostgREST.
-- -----------------------------------------------------------------------------
create table if not exists integration.import_batches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  source_system   text        not null,
  entity_type     text        not null,
  status          text        not null default 'pending'
                    check (status in ('pending', 'running', 'completed', 'failed', 'rolled_back')),
  total_records   integer     not null default 0,
  succeeded       integer     not null default 0,
  failed          integer     not null default 0,
  started_at      timestamptz,
  finished_at     timestamptz,
  error_summary   text,
  created_at      timestamptz not null default now(),
  created_by      uuid
);

-- الجسر الذي يجعل الاستيراد قابلًا للتكرار بلا ازدواج (idempotent)
create table if not exists integration.entity_mappings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  source_system   text        not null,
  entity_type     text        not null,
  legacy_id       text        not null,
  new_id          uuid        not null,
  batch_id        uuid        references integration.import_batches(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint entity_mappings_unique unique (source_system, entity_type, legacy_id)
);

create table if not exists integration.sync_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  source_system   text        not null,
  direction       text        not null check (direction in ('inbound', 'outbound')),
  entity_type     text        not null,
  status          text        not null,
  message         text,
  created_at      timestamptz not null default now()
);

comment on schema integration is
  'طبقة التكامل مع النظام القديم. فارغة من المنطق عمدًا حتى تحليل النظام (Q-17).';

-- -----------------------------------------------------------------------------
-- 5) سياسات RLS
-- -----------------------------------------------------------------------------
select app.apply_rls('notification_templates', 'notifications.view', 'notifications.templates.manage', 'notifications.templates.manage', 'notifications.templates.manage');
select app.apply_audit_triggers('notification_templates');

select app.apply_rls('files', 'reports.view', 'reports.view', null, null);
select app.apply_audit_triggers('files');

-- notifications : قاعدة إضافية — المستخدم يرى إشعاراته الشخصية دائمًا
select app.apply_rls('notifications', 'notifications.view', 'notifications.send', 'notifications.send', null);
select app.apply_audit_triggers('notifications');

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using ((select app.is_active_user()) and recipient_user_id = (select auth.uid()));

-- تعليم إشعاري كمقروء لا يحتاج صلاحية إرسال
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using ((select app.is_active_user()) and recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));

-- notification_logs : قراءة فقط لمن يملك صلاحية عرض الإشعارات
alter table public.notification_logs enable row level security;

drop policy if exists notification_logs_select on public.notification_logs;
create policy notification_logs_select on public.notification_logs
  for select to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_permission('notifications.view'))
  );

grant select on public.notification_logs to authenticated;

-- audit_logs : قراءة فقط، وبصلاحية حساسة. الكتابة من الخادم بمفتاح إداري.
alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_permission('audit.view'))
    and (branch_id is null or (select app.can_access_branch(branch_id)))
  );

-- الإدراج مسموح للمستخدم الموثّق لأن التطبيق يكتب السجل بجلسة المستخدم نفسه؛
-- والقيود أعلاه + محفّز عدم القابلية للتعديل تمنع العبث بالسجلات القائمة.
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and user_id = (select auth.uid())
  );

grant select, insert on public.audit_logs to authenticated;

-- integration.* : لا وصول من العميل إطلاقًا
revoke all on all tables in schema integration from anon, authenticated;
