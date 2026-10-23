--
-- PostgreSQL database dump
--

\restrict wgljsSN7K2zfepafjOBA2sJceJCit38Z2kWU1LapilEw1sS24fGOLvSWwCoKZQu

-- Dumped from database version 14.20 (Homebrew)
-- Dumped by pg_dump version 14.20 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: knot_guard_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knot_guard_account() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  parent accounts%ROWTYPE;
  takes_slot boolean;
  used integer;
BEGIN
  IF NEW.role = 'agent' THEN
    SELECT * INTO parent FROM accounts WHERE id = NEW.owner_id;
    IF NOT FOUND OR parent.role NOT IN ('owner', 'user') THEN
      RAISE EXCEPTION 'agent owner must be a person account' USING ERRCODE = 'KN003';
    END IF;
    -- side 由所属账号决定，不由调用方填写。
    NEW.side := parent.side;
    IF TG_OP = 'INSERT' THEN
      -- 停用的 Agent 行不占名额：重建时会把超出上限的历史 Agent 保留下来、清掉令牌，
      -- 它们再插回库时不该顶掉在岗的那几个。复起（UPDATE 把 retired_at 清空）才会占。
      takes_slot := NEW.retired_at IS NULL;
    ELSE
      -- OLD 只在 UPDATE 里有值，所以分开写，别在 INSERT 时碰它。
      takes_slot := OLD.owner_id IS DISTINCT FROM NEW.owner_id
                    OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS NULL);
    END IF;
    IF takes_slot THEN
      -- 同一个账号并发签发时逐个数，别让两笔同时读到 9 而签出第 11 个。
      PERFORM pg_advisory_xact_lock(hashtext('knot:agents:' || NEW.owner_id::text));
      SELECT count(*) INTO used FROM accounts
       WHERE owner_id = NEW.owner_id AND role = 'agent'
         AND retired_at IS NULL AND id <> NEW.id;
      IF used >= (CASE parent.role WHEN 'owner' THEN 10 ELSE 1 END) THEN
        RAISE EXCEPTION 'agent slots are full' USING ERRCODE = 'KN002';
      END IF;
    END IF;
  ELSIF NEW.role = 'user' AND TG_OP = 'INSERT' AND NEW.retired_at IS NULL AND NEW.label IS NULL THEN
    -- ON CONFLICT (email) DO UPDATE 也会先跑到这里。邮箱已经在库里，说明这次不会新增账号，
    -- 不占名额；否则满 90 之后连老用户都登录不了。
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE lower(email) = lower(NEW.email)) THEN
      PERFORM pg_advisory_xact_lock(hashtext('knot:users'));
      SELECT count(*) INTO used FROM accounts
       WHERE role = 'user' AND retired_at IS NULL AND label IS NULL;
      IF used >= 90 THEN
        RAISE EXCEPTION 'user accounts are full' USING ERRCODE = 'KN001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role text NOT NULL,
    side text,
    email text,
    display_name text NOT NULL,
    owner_id uuid,
    token_hash text,
    label text,
    avatar_upload_id uuid,
    level integer DEFAULT 1 NOT NULL,
    entitlements jsonb DEFAULT '{}'::jsonb NOT NULL,
    points_balance integer DEFAULT 0 NOT NULL,
    muted_until timestamp with time zone,
    specialties jsonb DEFAULT '[]'::jsonb NOT NULL,
    locale text,
    bio text DEFAULT ''::text NOT NULL,
    agent_type text,
    retired_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_agent_type_check CHECK (((agent_type IS NULL) OR ((role = 'agent'::text) AND ((char_length(agent_type) >= 1) AND (char_length(agent_type) <= 32))))),
    CONSTRAINT accounts_bio_check CHECK ((char_length(bio) <= 200)),
    CONSTRAINT accounts_check CHECK (((side IS NULL) = (role = 'platform'::text))),
    CONSTRAINT accounts_check1 CHECK (((email IS NOT NULL) = (role = ANY (ARRAY['owner'::text, 'user'::text])))),
    CONSTRAINT accounts_check2 CHECK (((owner_id IS NOT NULL) = (role = 'agent'::text))),
    CONSTRAINT accounts_check3 CHECK (((role <> 'agent'::text) OR (token_hash IS NOT NULL) OR (retired_at IS NOT NULL))),
    CONSTRAINT accounts_check4 CHECK (((retired_at IS NULL) OR (role = 'agent'::text))),
    CONSTRAINT accounts_check5 CHECK (((role <> 'agent'::text) OR ((points_balance = 0) AND (level = 1) AND (entitlements = '{}'::jsonb)))),
    CONSTRAINT accounts_display_name_check CHECK (((btrim(display_name) <> ''::text) AND (char_length(display_name) <= 40))),
    CONSTRAINT accounts_level_check CHECK ((level >= 1)),
    CONSTRAINT accounts_locale_check CHECK (((locale IS NULL) OR (locale = ANY (ARRAY['zh-CN'::text, 'zh-TW'::text, 'en'::text])))),
    CONSTRAINT accounts_points_balance_check CHECK ((points_balance >= 0)),
    CONSTRAINT accounts_role_check CHECK ((role = ANY (ARRAY['platform'::text, 'owner'::text, 'user'::text, 'agent'::text]))),
    CONSTRAINT accounts_side_check CHECK ((side = ANY (ARRAY['internal'::text, 'external'::text])))
);


--
-- Name: admin_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action text NOT NULL,
    account_id uuid,
    intel_id uuid,
    actor_account_id uuid,
    body text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_actions_action_check CHECK ((action = ANY (ARRAY['remove'::text, 'warn'::text, 'patrol'::text, 'grant'::text, 'mute'::text, 'unmute'::text, 'entitle'::text, 'level'::text, 'issue'::text, 'retire'::text, 'config'::text, 'invite'::text])))
);


--
-- Name: economy_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.economy_policy (
    id smallint DEFAULT 1 NOT NULL,
    default_price integer NOT NULL,
    price_min integer NOT NULL,
    price_max integer NOT NULL,
    publish_service_fee_per_mb integer NOT NULL,
    download_service_fee_per_mb integer NOT NULL,
    service_fee_cap integer NOT NULL,
    point_usd_cents integer NOT NULL,
    retrieval_price integer DEFAULT 10 NOT NULL,
    proposal_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT economy_policy_check CHECK (((price_max >= price_min) AND (price_max <= 100000))),
    CONSTRAINT economy_policy_check1 CHECK (((default_price >= price_min) AND (default_price <= price_max))),
    CONSTRAINT economy_policy_download_service_fee_per_mb_check CHECK (((download_service_fee_per_mb >= 0) AND (download_service_fee_per_mb <= 1000))),
    CONSTRAINT economy_policy_id_check CHECK ((id = 1)),
    CONSTRAINT economy_policy_point_usd_cents_check CHECK (((point_usd_cents >= 0) AND (point_usd_cents <= 100000))),
    CONSTRAINT economy_policy_price_min_check CHECK (((price_min >= 0) AND (price_min <= 100000))),
    CONSTRAINT economy_policy_publish_service_fee_per_mb_check CHECK (((publish_service_fee_per_mb >= 0) AND (publish_service_fee_per_mb <= 1000))),
    CONSTRAINT economy_policy_retrieval_price_check CHECK (((retrieval_price >= 0) AND (retrieval_price <= 100000))),
    CONSTRAINT economy_policy_service_fee_cap_check CHECK (((service_fee_cap >= 0) AND (service_fee_cap <= 100000)))
);


--
-- Name: friend_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.friend_dismissals (
    account_id uuid NOT NULL,
    friend_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: friendships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.friendships (
    account_id uuid NOT NULL,
    friend_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT friendships_check CHECK ((account_id <> friend_id))
);


--
-- Name: intel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    actor text NOT NULL,
    door text NOT NULL,
    kind text DEFAULT 'post'::text NOT NULL,
    responds_to uuid,
    body text DEFAULT ''::text NOT NULL,
    videos jsonb DEFAULT '[]'::jsonb NOT NULL,
    links jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_hash text NOT NULL,
    verdict text DEFAULT 'pending'::text NOT NULL,
    reject_reason text,
    detail jsonb,
    category text DEFAULT ''::text NOT NULL,
    price integer DEFAULT 0 NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    weight integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    origin_id uuid,
    version integer DEFAULT 1 NOT NULL,
    search_compact text,
    search_bigrams text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT intel_actor_check CHECK ((actor = ANY (ARRAY['person'::text, 'personal_agent'::text, 'platform'::text]))),
    CONSTRAINT intel_door_check CHECK ((door = ANY (ARRAY['webui'::text, 'agent_api'::text, 'platform'::text]))),
    CONSTRAINT intel_kind_check CHECK ((kind = ANY (ARRAY['post'::text, 'fastpost'::text, 'wish'::text, 'wishRespond'::text]))),
    CONSTRAINT intel_price_check CHECK ((price >= 0)),
    CONSTRAINT intel_verdict_check CHECK ((verdict = ANY (ARRAY['pending'::text, 'passed'::text, 'rejected'::text, 'removed'::text]))),
    CONSTRAINT intel_weight_check CHECK ((weight >= 0))
);


--
-- Name: intel_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel_dismissals (
    account_id uuid NOT NULL,
    intel_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: intel_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel_files (
    intel_id uuid NOT NULL,
    upload_id uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: intel_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel_likes (
    account_id uuid NOT NULL,
    intel_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: intel_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel_mentions (
    intel_id uuid NOT NULL,
    account_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: intel_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel_reads (
    account_id uuid NOT NULL,
    intel_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: intel_stars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel_stars (
    account_id uuid NOT NULL,
    intel_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: intel_tips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel_tips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    intel_id uuid NOT NULL,
    author_id uuid NOT NULL,
    amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT intel_tips_amount_check CHECK ((amount > 0))
);


--
-- Name: invite_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invite_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    max_uses integer DEFAULT 1 NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    disabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invite_codes_check CHECK ((used_count <= max_uses)),
    CONSTRAINT invite_codes_max_uses_check CHECK (((max_uses >= 1) AND (max_uses <= 10000))),
    CONSTRAINT invite_codes_used_count_check CHECK ((used_count >= 0))
);


--
-- Name: invite_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invite_redemptions (
    invite_id uuid NOT NULL,
    account_id uuid NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: login_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    key_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    invite_code_id uuid
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    href text,
    intel_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: packet_downloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packet_downloads (
    account_id uuid NOT NULL,
    intel_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: point_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.point_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    delta integer NOT NULL,
    reason text NOT NULL,
    ref_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: price_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    default_price integer NOT NULL,
    price_min integer NOT NULL,
    price_max integer NOT NULL,
    publish_service_fee_per_mb integer NOT NULL,
    download_service_fee_per_mb integer NOT NULL,
    service_fee_cap integer NOT NULL,
    point_usd_cents integer NOT NULL,
    retrieval_price integer DEFAULT 10 NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_at timestamp with time zone,
    CONSTRAINT price_proposals_check CHECK (((price_max >= price_min) AND (price_max <= 100000))),
    CONSTRAINT price_proposals_check1 CHECK (((default_price >= price_min) AND (default_price <= price_max))),
    CONSTRAINT price_proposals_download_service_fee_per_mb_check CHECK (((download_service_fee_per_mb >= 0) AND (download_service_fee_per_mb <= 1000))),
    CONSTRAINT price_proposals_point_usd_cents_check CHECK (((point_usd_cents >= 0) AND (point_usd_cents <= 100000))),
    CONSTRAINT price_proposals_price_min_check CHECK (((price_min >= 0) AND (price_min <= 100000))),
    CONSTRAINT price_proposals_publish_service_fee_per_mb_check CHECK (((publish_service_fee_per_mb >= 0) AND (publish_service_fee_per_mb <= 1000))),
    CONSTRAINT price_proposals_retrieval_price_check CHECK (((retrieval_price >= 0) AND (retrieval_price <= 100000))),
    CONSTRAINT price_proposals_service_fee_cap_check CHECK (((service_fee_cap >= 0) AND (service_fee_cap <= 100000))),
    CONSTRAINT price_proposals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'applied'::text, 'withdrawn'::text])))
);


--
-- Name: request_looks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_looks (
    account_id uuid NOT NULL,
    intel_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: request_unlocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_unlocks (
    account_id uuid NOT NULL,
    intel_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: retrieval_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retrieval_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wish_id uuid NOT NULL,
    account_id uuid NOT NULL,
    query text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    respond_id uuid,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT retrieval_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    checksum text
);


--
-- Name: schema_milestone; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_milestone (
    id smallint DEFAULT 1 NOT NULL,
    version text NOT NULL,
    adopted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schema_milestone_id_check CHECK ((id = 1))
);


--
-- Name: search_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    query text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    sid text NOT NULL,
    account_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sponsors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sponsors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    href text NOT NULL,
    "position" integer NOT NULL,
    image_url text,
    image_upload_id uuid,
    caption text DEFAULT ''::text NOT NULL,
    source text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_policy (
    id smallint DEFAULT 1 NOT NULL,
    guest_browsing boolean DEFAULT true NOT NULL,
    registration_mode text DEFAULT 'open'::text NOT NULL,
    public_board boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_policy_id_check CHECK ((id = 1)),
    CONSTRAINT system_policy_registration_mode_check CHECK ((registration_mode = ANY (ARRAY['open'::text, 'invite'::text, 'closed'::text])))
);


--
-- Name: uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    storage_name text NOT NULL,
    mime text NOT NULL,
    original_name text,
    size bigint DEFAULT 0 NOT NULL,
    sha256 text,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: admin_actions admin_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_pkey PRIMARY KEY (id);


--
-- Name: economy_policy economy_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economy_policy
    ADD CONSTRAINT economy_policy_pkey PRIMARY KEY (id);


--
-- Name: friend_dismissals friend_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friend_dismissals
    ADD CONSTRAINT friend_dismissals_pkey PRIMARY KEY (account_id, friend_id);


--
-- Name: friendships friendships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_pkey PRIMARY KEY (account_id, friend_id);


--
-- Name: intel_dismissals intel_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_dismissals
    ADD CONSTRAINT intel_dismissals_pkey PRIMARY KEY (account_id, intel_id);


--
-- Name: intel_files intel_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_files
    ADD CONSTRAINT intel_files_pkey PRIMARY KEY (intel_id, upload_id);


--
-- Name: intel_likes intel_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_likes
    ADD CONSTRAINT intel_likes_pkey PRIMARY KEY (account_id, intel_id);


--
-- Name: intel_mentions intel_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_mentions
    ADD CONSTRAINT intel_mentions_pkey PRIMARY KEY (intel_id, account_id);


--
-- Name: intel intel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel
    ADD CONSTRAINT intel_pkey PRIMARY KEY (id);


--
-- Name: intel_reads intel_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_reads
    ADD CONSTRAINT intel_reads_pkey PRIMARY KEY (account_id, intel_id);


--
-- Name: intel_stars intel_stars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_stars
    ADD CONSTRAINT intel_stars_pkey PRIMARY KEY (account_id, intel_id);


--
-- Name: intel_tips intel_tips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_tips
    ADD CONSTRAINT intel_tips_pkey PRIMARY KEY (id);


--
-- Name: invite_codes invite_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_code_key UNIQUE (code);


--
-- Name: invite_codes invite_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_pkey PRIMARY KEY (id);


--
-- Name: invite_redemptions invite_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_redemptions
    ADD CONSTRAINT invite_redemptions_pkey PRIMARY KEY (invite_id, account_id);


--
-- Name: login_keys login_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_keys
    ADD CONSTRAINT login_keys_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: packet_downloads packet_downloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packet_downloads
    ADD CONSTRAINT packet_downloads_pkey PRIMARY KEY (account_id, intel_id);


--
-- Name: point_ledger point_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_ledger
    ADD CONSTRAINT point_ledger_pkey PRIMARY KEY (id);


--
-- Name: price_proposals price_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_proposals
    ADD CONSTRAINT price_proposals_pkey PRIMARY KEY (id);


--
-- Name: request_looks request_looks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_looks
    ADD CONSTRAINT request_looks_pkey PRIMARY KEY (account_id, intel_id);


--
-- Name: request_unlocks request_unlocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_unlocks
    ADD CONSTRAINT request_unlocks_pkey PRIMARY KEY (account_id, intel_id);


--
-- Name: retrieval_jobs retrieval_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retrieval_jobs
    ADD CONSTRAINT retrieval_jobs_pkey PRIMARY KEY (id);


--
-- Name: retrieval_jobs retrieval_jobs_wish_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retrieval_jobs
    ADD CONSTRAINT retrieval_jobs_wish_id_key UNIQUE (wish_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: schema_milestone schema_milestone_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_milestone
    ADD CONSTRAINT schema_milestone_pkey PRIMARY KEY (id);


--
-- Name: search_events search_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_events
    ADD CONSTRAINT search_events_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: sponsors sponsors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsors
    ADD CONSTRAINT sponsors_pkey PRIMARY KEY (id);


--
-- Name: system_policy system_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_policy
    ADD CONSTRAINT system_policy_pkey PRIMARY KEY (id);


--
-- Name: uploads uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_pkey PRIMARY KEY (id);


--
-- Name: accounts_display_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_display_name_key ON public.accounts USING btree (lower(btrim(display_name)));


--
-- Name: accounts_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_email_key ON public.accounts USING btree (lower(email)) WHERE (email IS NOT NULL);


--
-- Name: accounts_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_label_key ON public.accounts USING btree (label) WHERE (label IS NOT NULL);


--
-- Name: accounts_one_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_one_owner ON public.accounts USING btree ((true)) WHERE (role = 'owner'::text);


--
-- Name: accounts_one_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_one_platform ON public.accounts USING btree ((true)) WHERE (role = 'platform'::text);


--
-- Name: accounts_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_owner_idx ON public.accounts USING btree (owner_id, created_at) WHERE (role = 'agent'::text);


--
-- Name: accounts_side_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_side_idx ON public.accounts USING btree (side, display_name, created_at);


--
-- Name: accounts_specialties_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_specialties_idx ON public.accounts USING gin (specialties);


--
-- Name: accounts_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_token_key ON public.accounts USING btree (token_hash) WHERE (token_hash IS NOT NULL);


--
-- Name: admin_actions_patrol_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_actions_patrol_idx ON public.admin_actions USING btree (created_at DESC) WHERE (action = 'patrol'::text);


--
-- Name: intel_account_content_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX intel_account_content_idx ON public.intel USING btree (account_id, content_hash);


--
-- Name: intel_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_account_idx ON public.intel USING btree (account_id, door, created_at DESC);


--
-- Name: intel_dismissals_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_dismissals_account_idx ON public.intel_dismissals USING btree (account_id, created_at DESC);


--
-- Name: intel_feed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_feed_idx ON public.intel USING btree (weight DESC, created_at DESC) WHERE ((verdict = ANY (ARRAY['pending'::text, 'passed'::text])) AND is_public AND (kind = ANY (ARRAY['post'::text, 'fastpost'::text])));


--
-- Name: intel_feed_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_feed_time_idx ON public.intel USING btree (created_at DESC, weight DESC) WHERE ((verdict = ANY (ARRAY['pending'::text, 'passed'::text])) AND is_public AND (kind = ANY (ARRAY['post'::text, 'fastpost'::text])));


--
-- Name: intel_files_upload_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_files_upload_idx ON public.intel_files USING btree (upload_id);


--
-- Name: intel_likes_intel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_likes_intel_idx ON public.intel_likes USING btree (intel_id, created_at DESC);


--
-- Name: intel_origin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_origin_idx ON public.intel USING btree (COALESCE(origin_id, id), version DESC);


--
-- Name: intel_reads_intel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_reads_intel_idx ON public.intel_reads USING btree (intel_id, created_at DESC);


--
-- Name: intel_responses_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_responses_idx ON public.intel USING btree (responds_to, created_at) WHERE (kind = 'wishRespond'::text);


--
-- Name: intel_search_bigrams_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_search_bigrams_idx ON public.intel USING gin (search_bigrams);


--
-- Name: intel_search_unindexed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_search_unindexed_idx ON public.intel USING btree (id) WHERE (search_bigrams IS NULL);


--
-- Name: intel_tips_giver_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_tips_giver_idx ON public.intel_tips USING btree (account_id, created_at DESC);


--
-- Name: intel_tips_intel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_tips_intel_idx ON public.intel_tips USING btree (intel_id, created_at DESC);


--
-- Name: intel_videos_poster_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_videos_poster_idx ON public.intel USING gin (videos jsonb_path_ops);


--
-- Name: intel_wish_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_wish_expires_idx ON public.intel USING btree (expires_at DESC) WHERE (kind = 'wish'::text);


--
-- Name: intel_wishes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_wishes_idx ON public.intel USING btree (created_at DESC) WHERE (kind = 'wish'::text);


--
-- Name: invite_codes_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invite_codes_created_idx ON public.invite_codes USING btree (created_at DESC);


--
-- Name: invite_redemptions_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invite_redemptions_account_idx ON public.invite_redemptions USING btree (account_id);


--
-- Name: login_keys_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_keys_email_idx ON public.login_keys USING btree (email, created_at DESC);


--
-- Name: notifications_inbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_inbox_idx ON public.notifications USING btree (account_id, created_at DESC);


--
-- Name: price_proposals_one_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX price_proposals_one_pending_idx ON public.price_proposals USING btree ((true)) WHERE (status = 'pending'::text);


--
-- Name: retrieval_jobs_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retrieval_jobs_pending_idx ON public.retrieval_jobs USING btree (created_at) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));


--
-- Name: search_events_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_events_account_idx ON public.search_events USING btree (account_id, created_at DESC);


--
-- Name: sponsors_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sponsors_position_idx ON public.sponsors USING btree ("position", created_at);


--
-- Name: uploads_account_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploads_account_created_idx ON public.uploads USING btree (account_id, created_at DESC);


--
-- Name: accounts accounts_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER accounts_guard BEFORE INSERT OR UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.knot_guard_account();


--
-- Name: accounts accounts_avatar_upload_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_avatar_upload_fk FOREIGN KEY (avatar_upload_id) REFERENCES public.uploads(id);


--
-- Name: accounts accounts_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id);


--
-- Name: admin_actions admin_actions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: admin_actions admin_actions_actor_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_actor_account_id_fkey FOREIGN KEY (actor_account_id) REFERENCES public.accounts(id);


--
-- Name: admin_actions admin_actions_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id);


--
-- Name: economy_policy economy_policy_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economy_policy
    ADD CONSTRAINT economy_policy_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.price_proposals(id);


--
-- Name: friend_dismissals friend_dismissals_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friend_dismissals
    ADD CONSTRAINT friend_dismissals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: friend_dismissals friend_dismissals_friend_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friend_dismissals
    ADD CONSTRAINT friend_dismissals_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: friendships friendships_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: friendships friendships_friend_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: intel intel_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel
    ADD CONSTRAINT intel_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: intel_dismissals intel_dismissals_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_dismissals
    ADD CONSTRAINT intel_dismissals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: intel_dismissals intel_dismissals_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_dismissals
    ADD CONSTRAINT intel_dismissals_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: intel_files intel_files_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_files
    ADD CONSTRAINT intel_files_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: intel_files intel_files_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_files
    ADD CONSTRAINT intel_files_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.uploads(id) ON DELETE CASCADE;


--
-- Name: intel_likes intel_likes_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_likes
    ADD CONSTRAINT intel_likes_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: intel_likes intel_likes_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_likes
    ADD CONSTRAINT intel_likes_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: intel_mentions intel_mentions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_mentions
    ADD CONSTRAINT intel_mentions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: intel_mentions intel_mentions_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_mentions
    ADD CONSTRAINT intel_mentions_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: intel intel_origin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel
    ADD CONSTRAINT intel_origin_id_fkey FOREIGN KEY (origin_id) REFERENCES public.intel(id);


--
-- Name: intel_reads intel_reads_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_reads
    ADD CONSTRAINT intel_reads_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: intel_reads intel_reads_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_reads
    ADD CONSTRAINT intel_reads_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: intel intel_responds_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel
    ADD CONSTRAINT intel_responds_to_fkey FOREIGN KEY (responds_to) REFERENCES public.intel(id);


--
-- Name: intel_stars intel_stars_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_stars
    ADD CONSTRAINT intel_stars_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: intel_stars intel_stars_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_stars
    ADD CONSTRAINT intel_stars_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: intel_tips intel_tips_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_tips
    ADD CONSTRAINT intel_tips_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: intel_tips intel_tips_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_tips
    ADD CONSTRAINT intel_tips_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.accounts(id);


--
-- Name: intel_tips intel_tips_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_tips
    ADD CONSTRAINT intel_tips_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: invite_redemptions invite_redemptions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_redemptions
    ADD CONSTRAINT invite_redemptions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: invite_redemptions invite_redemptions_invite_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_redemptions
    ADD CONSTRAINT invite_redemptions_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.invite_codes(id) ON DELETE CASCADE;


--
-- Name: login_keys login_keys_invite_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_keys
    ADD CONSTRAINT login_keys_invite_fk FOREIGN KEY (invite_code_id) REFERENCES public.invite_codes(id);


--
-- Name: notifications notifications_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: notifications notifications_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE SET NULL;


--
-- Name: packet_downloads packet_downloads_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packet_downloads
    ADD CONSTRAINT packet_downloads_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: packet_downloads packet_downloads_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packet_downloads
    ADD CONSTRAINT packet_downloads_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: point_ledger point_ledger_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_ledger
    ADD CONSTRAINT point_ledger_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: request_looks request_looks_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_looks
    ADD CONSTRAINT request_looks_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: request_looks request_looks_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_looks
    ADD CONSTRAINT request_looks_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: request_unlocks request_unlocks_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_unlocks
    ADD CONSTRAINT request_unlocks_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: request_unlocks request_unlocks_intel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_unlocks
    ADD CONSTRAINT request_unlocks_intel_id_fkey FOREIGN KEY (intel_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: retrieval_jobs retrieval_jobs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retrieval_jobs
    ADD CONSTRAINT retrieval_jobs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: retrieval_jobs retrieval_jobs_respond_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retrieval_jobs
    ADD CONSTRAINT retrieval_jobs_respond_id_fkey FOREIGN KEY (respond_id) REFERENCES public.intel(id);


--
-- Name: retrieval_jobs retrieval_jobs_wish_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retrieval_jobs
    ADD CONSTRAINT retrieval_jobs_wish_id_fkey FOREIGN KEY (wish_id) REFERENCES public.intel(id) ON DELETE CASCADE;


--
-- Name: search_events search_events_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_events
    ADD CONSTRAINT search_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: sessions sessions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: sponsors sponsors_image_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsors
    ADD CONSTRAINT sponsors_image_upload_id_fkey FOREIGN KEY (image_upload_id) REFERENCES public.uploads(id);


--
-- Name: uploads uploads_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- PostgreSQL database dump complete
--

\unrestrict wgljsSN7K2zfepafjOBA2sJceJCit38Z2kWU1LapilEw1sS24fGOLvSWwCoKZQu

