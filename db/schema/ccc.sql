--
-- PostgreSQL database dump
--

\restrict fomexport

-- Dumped from database version 17.9 (Homebrew)
-- Dumped by pg_dump version 17.9 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: fommenu; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fommenu (
    pk integer NOT NULL,
    parentpk integer,
    cprompt character varying(60),
    chref character varying(60),
    cfunction character varying(120),
    isort integer,
    ilevel integer,
    crole character varying(10),
    objective text,
    cexec text,
    jscript text,
    lparent boolean,
    chtml text,
    jqclass character varying(10),
    class character varying(10),
    private character varying(60)
);


--
-- Name: fompages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fompages (
    name character varying(60) NOT NULL,
    title character varying(120),
    html text,
    crole integer DEFAULT 0,
    cfunction text,
    isort integer DEFAULT 0,
    active boolean DEFAULT true,
    updated timestamp without time zone DEFAULT now()
);


--
-- Name: movies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movies (
    id integer NOT NULL,
    performer_name character varying(50),
    movie_name character varying(70),
    character_name character varying(50),
    rating numeric(3,1),
    box_office numeric(12,2)
);


--
-- Name: movies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.movies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: movies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.movies_id_seq OWNED BY public.movies.id;


--
-- Name: photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photos (
    id integer NOT NULL,
    title character varying(100),
    caption text,
    igroup integer DEFAULT 0,
    filename text,
    originalname text,
    mimetype character varying(100),
    sizebytes integer,
    uploaded_by integer,
    uploaded_at timestamp without time zone DEFAULT now()
);


--
-- Name: photos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.photos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: photos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.photos_id_seq OWNED BY public.photos.id;


--
-- Name: sendemail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sendemail (
    id integer NOT NULL,
    name text NOT NULL,
    qtype text NOT NULL,
    query text,
    qname text,
    qparams jsonb,
    letter text DEFAULT ''::text NOT NULL,
    CONSTRAINT sendemail_qtype_check CHECK ((qtype = ANY (ARRAY['raw'::text, 'saved'::text])))
);


--
-- Name: sendemail_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sendemail_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sendemail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sendemail_id_seq OWNED BY public.sendemail.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    firstname character varying(50) NOT NULL,
    lastname character varying(50) NOT NULL,
    email character varying(100),
    phone character varying(20),
    role character varying(30) DEFAULT 'user'::character varying,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    permission integer DEFAULT 0,
    password character varying(200)
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: widgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widgets (
    id integer NOT NULL,
    chead text NOT NULL,
    cbody text,
    igroup integer,
    jscript text
);


--
-- Name: widgets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.widgets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: widgets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.widgets_id_seq OWNED BY public.widgets.id;


--
-- Name: movies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movies ALTER COLUMN id SET DEFAULT nextval('public.movies_id_seq'::regclass);


--
-- Name: photos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos ALTER COLUMN id SET DEFAULT nextval('public.photos_id_seq'::regclass);


--
-- Name: sendemail id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sendemail ALTER COLUMN id SET DEFAULT nextval('public.sendemail_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: widgets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widgets ALTER COLUMN id SET DEFAULT nextval('public.widgets_id_seq'::regclass);


--
-- Name: fommenu fomMenu_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fommenu
    ADD CONSTRAINT "fomMenu_pkey" PRIMARY KEY (pk);


--
-- Name: fompages fompages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fompages
    ADD CONSTRAINT fompages_pkey PRIMARY KEY (name);


--
-- Name: movies movies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movies
    ADD CONSTRAINT movies_pkey PRIMARY KEY (id);


--
-- Name: photos photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_pkey PRIMARY KEY (id);


--
-- Name: sendemail sendemail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sendemail
    ADD CONSTRAINT sendemail_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: widgets widgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widgets
    ADD CONSTRAINT widgets_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict fomexport

