-- ============================================================
--  SITEBANA — Additional Supabase SQL Functions
--  Run these in Supabase SQL Editor AFTER running schema.sql
-- ============================================================

-- Increment view counter (called from backend, avoids race conditions)
CREATE OR REPLACE FUNCTION public.increment_views(biz_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.businesses
  SET views = views + 1
  WHERE id = biz_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Platform-wide admin stats
CREATE OR REPLACE FUNCTION public.admin_platform_stats()
RETURNS JSON AS $$
DECLARE result JSON;
BEGIN
  SELECT json_build_object(
    'total_businesses',   (SELECT COUNT(*) FROM public.businesses),
    'live_businesses',    (SELECT COUNT(*) FROM public.businesses WHERE is_live = TRUE),
    'total_users',        (SELECT COUNT(*) FROM public.profiles),
    'total_bookings',     (SELECT COUNT(*) FROM public.bookings),
    'total_revenue',      (SELECT COALESCE(SUM(amount), 0) FROM public.payments WHERE status = 'captured'),
    'pro_subscribers',    (SELECT COUNT(*) FROM public.subscriptions WHERE status = 'active'),
    'cities_covered',     (SELECT COUNT(DISTINCT city) FROM public.businesses)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update customer spend when booking is confirmed
CREATE OR REPLACE FUNCTION public.update_customer_on_booking()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status = 'pending' THEN
    UPDATE public.customers
    SET
      total_spend = total_spend + NEW.amount,
      visit_count = visit_count + 1,
      last_visit  = NEW.booking_date
    WHERE business_id = NEW.business_id
      AND phone = NEW.customer_phone;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_confirmed_update_customer
  AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_customer_on_booking();

-- Grant anon role access to marketplace search
GRANT EXECUTE ON FUNCTION public.increment_views(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_views(UUID) TO authenticated;
