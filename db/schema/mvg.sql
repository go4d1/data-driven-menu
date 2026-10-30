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
-- Name: sendemail id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sendemail ALTER COLUMN id SET DEFAULT nextval('public.sendemail_id_seq'::regclass);


--
-- Name: fompages fompages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fompages
    ADD CONSTRAINT fompages_pkey PRIMARY KEY (name);


--
-- Name: sendemail sendemail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sendemail
    ADD CONSTRAINT sendemail_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict fomexport

