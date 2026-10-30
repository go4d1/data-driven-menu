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

--
-- Name: set_default_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_default_settings() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.settings = NEW.settings || '{
    "permissionLevels": [
      {"color": "black",       "label": "Guest",        "level": 0},
      {"color": "dodgerblue",  "label": "Staff",        "level": 10},
      {"color": "forestgreen", "label": "Dept Head",    "level": 20},
      {"color": "crimson",     "label": "Facility Mgr", "level": 30},
      {"color": "fuchsia",     "label": "Global Admin", "level": 40}
    ],
    "roles": [
      {"code": "d", "label": "Developer"},
      {"code": "l", "label": "Legal"},
      {"code": "s", "label": "Security"}
    ]
  }'::jsonb;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: rex_path; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rex_path (
    prefix character varying NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: rex_path rex_path_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rex_path
    ADD CONSTRAINT rex_path_pkey PRIMARY KEY (prefix);


--
-- Name: rex_path trg_default_settings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_default_settings BEFORE INSERT ON public.rex_path FOR EACH ROW EXECUTE FUNCTION public.set_default_settings();


--
-- PostgreSQL database dump complete
--

\unrestrict fomexport

