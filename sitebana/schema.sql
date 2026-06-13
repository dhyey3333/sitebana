-- ============================================================
--  SITEBANA — Complete Supabase Database Schema
--  Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- 1. PROFILES (extends Supabase auth.users)
-- ─────────────────────────────────────────
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  role          TEXT DEFAULT 'owner',          -- owner | admin | staff
  plan          TEXT DEFAULT 'free',           -- free | starter | pro | business
  plan_expires  TIMESTAMPTZ,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────
-- 2. BUSINESSES
-- ─────────────────────────────────────────
CREATE TABLE public.businesses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  type          TEXT NOT NULL,                 -- Salon, Clinic, etc.
  city          TEXT NOT NULL,
  area          TEXT,
  phone         TEXT NOT NULL,
  tagline       TEXT,
  lang          TEXT DEFAULT 'English',
  plan          TEXT DEFAULT 'free',
  is_live       BOOLEAN DEFAULT FALSE,
  is_verified   BOOLEAN DEFAULT FALSE,
  is_featured   BOOLEAN DEFAULT FALSE,
  views         INTEGER DEFAULT 0,
  content       JSONB,                         -- AI-generated content blob
  meta          JSONB,                         -- SEO, hours, etc.
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for marketplace search
CREATE INDEX idx_businesses_city   ON public.businesses(city);
CREATE INDEX idx_businesses_type   ON public.businesses(type);
CREATE INDEX idx_businesses_slug   ON public.businesses(slug);
CREATE INDEX idx_businesses_owner  ON public.businesses(owner_id);
CREATE INDEX idx_businesses_search ON public.businesses
  USING GIN (to_tsvector('english', name || ' ' || COALESCE(city,'') || ' ' || COALESCE(type,'')));

-- ─────────────────────────────────────────
-- 3. BOOKINGS
-- ─────────────────────────────────────────
CREATE TABLE public.bookings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  service       TEXT NOT NULL,
  booking_date  DATE NOT NULL,
  booking_time  TEXT,
  amount        NUMERIC(10,2) DEFAULT 0,
  status        TEXT DEFAULT 'pending',        -- pending | confirmed | cancelled | completed
  notes         TEXT,
  source        TEXT DEFAULT 'manual',         -- manual | website | whatsapp | marketplace
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_business ON public.bookings(business_id);
CREATE INDEX idx_bookings_date     ON public.bookings(booking_date);
CREATE INDEX idx_bookings_status   ON public.bookings(status);

-- ─────────────────────────────────────────
-- 4. CUSTOMERS (CRM)
-- ─────────────────────────────────────────
CREATE TABLE public.customers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  tags          TEXT[] DEFAULT '{}',
  total_spend   NUMERIC(10,2) DEFAULT 0,
  visit_count   INTEGER DEFAULT 0,
  last_visit    DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customers_business ON public.customers(business_id);
CREATE UNIQUE INDEX idx_customers_phone ON public.customers(business_id, phone)
  WHERE phone IS NOT NULL;

-- ─────────────────────────────────────────
-- 5. INVOICES
-- ─────────────────────────────────────────
CREATE TABLE public.invoices (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  client_name   TEXT NOT NULL,
  client_phone  TEXT,
  client_email  TEXT,
  items         JSONB NOT NULL DEFAULT '[]',   -- [{name, qty, price}]
  subtotal      NUMERIC(10,2) NOT NULL,
  gst_rate      NUMERIC(5,2) DEFAULT 0,
  gst_amount    NUMERIC(10,2) DEFAULT 0,
  total         NUMERIC(10,2) NOT NULL,
  status        TEXT DEFAULT 'pending',        -- pending | paid | overdue | cancelled
  due_date      DATE,
  paid_at       TIMESTAMPTZ,
  payment_method TEXT,                         -- upi | card | cash | bank
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_business ON public.invoices(business_id);
CREATE INDEX idx_invoices_status   ON public.invoices(status);

-- Auto-generate invoice number
CREATE OR REPLACE FUNCTION public.generate_invoice_number(biz_id UUID)
RETURNS TEXT AS $$
DECLARE
  count INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO count
  FROM public.invoices WHERE business_id = biz_id;
  RETURN 'INV-' || LPAD(count::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────
-- 6. REVIEWS
-- ─────────────────────────────────────────
CREATE TABLE public.reviews (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  stars         INTEGER CHECK (stars BETWEEN 1 AND 5),
  text          TEXT,
  reply         TEXT,
  replied_at    TIMESTAMPTZ,
  is_verified   BOOLEAN DEFAULT FALSE,
  source        TEXT DEFAULT 'sitebana',       -- sitebana | google | manual
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_business ON public.reviews(business_id);

-- ─────────────────────────────────────────
-- 7. PAYMENTS / TRANSACTIONS
-- ─────────────────────────────────────────
CREATE TABLE public.payments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_id          UUID REFERENCES public.invoices(id),
  amount              NUMERIC(10,2) NOT NULL,
  currency            TEXT DEFAULT 'INR',
  method              TEXT,                    -- upi | card | netbanking | emi
  status              TEXT DEFAULT 'created',  -- created | authorized | captured | failed | refunded
  razorpay_order_id   TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  razorpay_signature  TEXT,
  metadata            JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_business   ON public.payments(business_id);
CREATE INDEX idx_payments_razorpay   ON public.payments(razorpay_order_id);

-- ─────────────────────────────────────────
-- 8. SUBSCRIPTIONS (platform billing)
-- ─────────────────────────────────────────
CREATE TABLE public.subscriptions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan                TEXT NOT NULL,           -- starter | pro | business
  billing_cycle       TEXT DEFAULT 'monthly',  -- monthly | yearly
  amount              NUMERIC(10,2) NOT NULL,
  status              TEXT DEFAULT 'active',   -- active | cancelled | expired | past_due
  current_period_start TIMESTAMPTZ,
  current_period_end  TIMESTAMPTZ,
  razorpay_sub_id     TEXT,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 9. MARKETPLACE LEADS
-- ─────────────────────────────────────────
CREATE TABLE public.leads (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  interest      TEXT,
  score         INTEGER DEFAULT 50,            -- 0-100 lead score
  status        TEXT DEFAULT 'new',            -- new | contacted | converted | lost
  source        TEXT DEFAULT 'marketplace',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 10. ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads        ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only see/edit their own
CREATE POLICY "profiles_self" ON public.profiles
  FOR ALL USING (auth.uid() = id);

-- Businesses: owners manage theirs; everyone can read live listings
CREATE POLICY "businesses_owner" ON public.businesses
  FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "businesses_public_read" ON public.businesses
  FOR SELECT USING (is_live = TRUE);

-- Bookings: only business owner
CREATE POLICY "bookings_owner" ON public.bookings
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- Customers: only business owner
CREATE POLICY "customers_owner" ON public.customers
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- Invoices: only business owner
CREATE POLICY "invoices_owner" ON public.invoices
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- Reviews: owners manage theirs; public can read
CREATE POLICY "reviews_owner" ON public.reviews
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );
CREATE POLICY "reviews_public_read" ON public.reviews
  FOR SELECT USING (TRUE);

-- Payments: only business owner
CREATE POLICY "payments_owner" ON public.payments
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- Subscriptions: only the subscriber
CREATE POLICY "subscriptions_self" ON public.subscriptions
  FOR ALL USING (auth.uid() = profile_id);

-- Leads: only business owner
CREATE POLICY "leads_owner" ON public.leads
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- ─────────────────────────────────────────
-- 11. UPDATED_AT TRIGGERS
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.businesses  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bookings    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.customers   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.invoices    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.payments    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────
-- 12. HELPFUL VIEWS
-- ─────────────────────────────────────────

-- Business stats summary (for dashboard)
CREATE VIEW public.business_stats AS
SELECT
  b.id,
  b.owner_id,
  b.name,
  b.city,
  b.type,
  b.views,
  COUNT(DISTINCT bk.id)                                      AS total_bookings,
  COUNT(DISTINCT CASE WHEN bk.status = 'confirmed' THEN bk.id END) AS confirmed_bookings,
  COALESCE(SUM(CASE WHEN bk.status != 'cancelled' THEN bk.amount END), 0) AS total_revenue,
  COUNT(DISTINCT c.id)                                       AS total_customers,
  ROUND(AVG(r.stars), 1)                                     AS avg_rating,
  COUNT(DISTINCT r.id)                                       AS review_count
FROM public.businesses b
LEFT JOIN public.bookings   bk ON bk.business_id = b.id
LEFT JOIN public.customers  c  ON c.business_id  = b.id
LEFT JOIN public.reviews    r  ON r.business_id  = b.id
GROUP BY b.id;

-- ─────────────────────────────────────────
-- DONE — Schema ready for production
-- ─────────────────────────────────────────
