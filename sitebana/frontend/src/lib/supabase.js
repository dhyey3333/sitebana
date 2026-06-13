// ============================================================
//  SITEBANA — Supabase Client & Data Layer
//  File: frontend/src/lib/supabase.js
// ============================================================

import { createClient } from '@supabase/supabase-js'

// ─── ENV (set these in .env.local) ───────────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession:     true,    // stays logged in across refreshes
    autoRefreshToken:   true,    // silently refreshes JWT
    detectSessionInUrl: true,    // handles magic link / OAuth redirects
  },
})

// ─────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────
export const Auth = {
  /** Sign up with email + password. Name stored in metadata → triggers profile creation */
  async signUp(name, email, password) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    if (error) throw error
    return data.user
  },

  /** Log in */
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data.user
  },

  /** Log out */
  async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  /** Get current session user */
  async getUser() {
    const { data: { user } } = await supabase.auth.getUser()
    return user
  },

  /** Listen for auth state changes (call in App root) */
  onAuthChange(callback) {
    return supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null)
    })
  },

  /** Send password reset email */
  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) throw error
  },
}

// ─────────────────────────────────────────
//  PROFILES
// ─────────────────────────────────────────
export const Profiles = {
  async get(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) throw error
    return data
  },

  async update(userId, updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single()
    if (error) throw error
    return data
  },
}

// ─────────────────────────────────────────
//  BUSINESSES
// ─────────────────────────────────────────
export const Businesses = {
  /** Get business owned by current user */
  async getMyBusiness(ownerId) {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', ownerId)
      .single()
    if (error && error.code !== 'PGRST116') throw error // PGRST116 = not found
    return data
  },

  /** Create a new business listing */
  async create(ownerId, bizData) {
    const slug = makeSlug(bizData.name)
    const { data, error } = await supabase
      .from('businesses')
      .insert({ ...bizData, owner_id: ownerId, slug, is_live: true })
      .select()
      .single()
    if (error) throw error
    return data
  },

  /** Update business details */
  async update(bizId, updates) {
    const { data, error } = await supabase
      .from('businesses')
      .update(updates)
      .eq('id', bizId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  /** Marketplace search — public, no auth needed */
  async search({ query = '', city = '', type = '', limit = 20, offset = 0 } = {}) {
    let q = supabase
      .from('businesses')
      .select('id, name, slug, type, city, area, phone, tagline, content, is_featured, created_at')
      .eq('is_live', true)
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (city && city !== 'All') q = q.eq('city', city)
    if (type && type !== 'All') q = q.ilike('type', `%${type}%`)
    if (query) q = q.textSearch('name', query, { config: 'english' })

    const { data, error } = await q
    if (error) throw error
    return data
  },

  /** Fetch by slug (public website) */
  async getBySlug(slug) {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('slug', slug)
      .single()
    if (error) throw error
    // Increment view count (fire and forget)
    supabase.rpc('increment_views', { biz_id: data.id }).then(() => {})
    return data
  },

  /** Dashboard stats */
  async getStats(bizId) {
    const { data, error } = await supabase
      .from('business_stats')
      .select('*')
      .eq('id', bizId)
      .single()
    if (error) throw error
    return data
  },
}

// ─────────────────────────────────────────
//  BOOKINGS
// ─────────────────────────────────────────
export const Bookings = {
  async list(bizId, { status, date, limit = 50 } = {}) {
    let q = supabase
      .from('bookings')
      .select('*')
      .eq('business_id', bizId)
      .order('booking_date', { ascending: false })
      .limit(limit)

    if (status) q = q.eq('status', status)
    if (date)   q = q.eq('booking_date', date)

    const { data, error } = await q
    if (error) throw error
    return data
  },

  async create(bizId, booking) {
    const { data, error } = await supabase
      .from('bookings')
      .insert({ ...booking, business_id: bizId })
      .select()
      .single()
    if (error) throw error

    // Upsert customer record
    if (booking.customer_phone) {
      await Customers.upsert(bizId, {
        name:  booking.customer_name,
        phone: booking.customer_phone,
        email: booking.customer_email,
      })
    }
    return data
  },

  async updateStatus(bookingId, status) {
    const { data, error } = await supabase
      .from('bookings')
      .update({ status })
      .eq('id', bookingId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async delete(bookingId) {
    const { error } = await supabase
      .from('bookings')
      .delete()
      .eq('id', bookingId)
    if (error) throw error
  },
}

// ─────────────────────────────────────────
//  CUSTOMERS
// ─────────────────────────────────────────
export const Customers = {
  async list(bizId, { search, limit = 100 } = {}) {
    let q = supabase
      .from('customers')
      .select('*')
      .eq('business_id', bizId)
      .order('total_spend', { ascending: false })
      .limit(limit)

    if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)

    const { data, error } = await q
    if (error) throw error
    return data
  },

  async create(bizId, customer) {
    const { data, error } = await supabase
      .from('customers')
      .insert({ ...customer, business_id: bizId })
      .select()
      .single()
    if (error) throw error
    return data
  },

  /** Insert or update customer by phone */
  async upsert(bizId, customer) {
    const { data, error } = await supabase
      .from('customers')
      .upsert(
        { ...customer, business_id: bizId, visit_count: 1 },
        { onConflict: 'business_id,phone', ignoreDuplicates: false }
      )
      .select()
      .single()
    if (error) console.error('Customer upsert:', error)
    return data
  },

  async update(customerId, updates) {
    const { data, error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', customerId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async delete(customerId) {
    const { error } = await supabase.from('customers').delete().eq('id', customerId)
    if (error) throw error
  },
}

// ─────────────────────────────────────────
//  INVOICES
// ─────────────────────────────────────────
export const Invoices = {
  async list(bizId, { status, limit = 50 } = {}) {
    let q = supabase
      .from('invoices')
      .select('*')
      .eq('business_id', bizId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) q = q.eq('status', status)

    const { data, error } = await q
    if (error) throw error
    return data
  },

  async create(bizId, invoice) {
    // Generate invoice number server-side via RPC
    const { data: invNum } = await supabase.rpc('generate_invoice_number', { biz_id: bizId })

    const { data, error } = await supabase
      .from('invoices')
      .insert({ ...invoice, business_id: bizId, invoice_number: invNum })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async markPaid(invoiceId, method = 'manual') {
    const { data, error } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: method })
      .eq('id', invoiceId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async delete(invoiceId) {
    const { error } = await supabase.from('invoices').delete().eq('id', invoiceId)
    if (error) throw error
  },
}

// ─────────────────────────────────────────
//  REVIEWS
// ─────────────────────────────────────────
export const Reviews = {
  async list(bizId) {
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('business_id', bizId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },

  async reply(reviewId, reply) {
    const { data, error } = await supabase
      .from('reviews')
      .update({ reply, replied_at: new Date().toISOString() })
      .eq('id', reviewId)
      .select()
      .single()
    if (error) throw error
    return data
  },
}

// ─────────────────────────────────────────
//  REAL-TIME SUBSCRIPTIONS
// ─────────────────────────────────────────
export const Realtime = {
  /** Subscribe to new bookings for a business */
  onNewBooking(bizId, callback) {
    return supabase
      .channel(`bookings:${bizId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'bookings',
        filter: `business_id=eq.${bizId}`,
      }, payload => callback(payload.new))
      .subscribe()
  },

  /** Subscribe to invoice payment updates */
  onInvoiceUpdate(bizId, callback) {
    return supabase
      .channel(`invoices:${bizId}`)
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'invoices',
        filter: `business_id=eq.${bizId}`,
      }, payload => callback(payload.new))
      .subscribe()
  },

  unsubscribe(channel) {
    supabase.removeChannel(channel)
  },
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function makeSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50)
    + '-' + Math.random().toString(36).slice(2, 6)
}
