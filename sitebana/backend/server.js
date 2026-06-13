// ============================================================
//  SITEBANA — Backend API Server
//  Node.js + Express + Razorpay
//
//  Install: npm install express razorpay @supabase/supabase-js
//           dotenv cors helmet express-rate-limit crypto
//  Run:     node server.js
// ============================================================

import express        from 'express'
import cors           from 'cors'
import helmet         from 'helmet'
import rateLimit      from 'express-rate-limit'
import Razorpay       from 'razorpay'
import crypto         from 'crypto'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const app = express()

// ─────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:5173'],
  credentials: true,
}))

// Raw body for Razorpay webhook signature verification
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '1mb' }))

// Rate limiting — protects against abuse
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: 'Too many requests' })
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many auth attempts' })
app.use('/api/', limiter)
app.use('/api/auth', authLimiter)

// ─────────────────────────────────────────
//  CLIENTS
// ─────────────────────────────────────────
// Service-role key bypasses RLS — ONLY use on the server, never expose to frontend
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
})

// ─────────────────────────────────────────
//  AUTH MIDDLEWARE — Verify Supabase JWT
// ─────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorised' })

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })

  req.user = user
  next()
}

// ─────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), env: process.env.NODE_ENV })
})

// ═════════════════════════════════════════
//  PAYMENTS — Razorpay
// ═════════════════════════════════════════

/**
 * POST /api/payments/create-order
 * Creates a Razorpay order for an invoice payment
 * Body: { invoice_id, amount (in INR), currency? }
 */
app.post('/api/payments/create-order', requireAuth, async (req, res) => {
  try {
    const { invoice_id, amount, currency = 'INR', notes = {} } = req.body

    if (!amount || amount < 1) {
      return res.status(400).json({ error: 'Amount must be at least ₹1' })
    }

    // Verify invoice belongs to user's business
    if (invoice_id) {
      const { data: inv } = await supabase
        .from('invoices')
        .select('id, business_id, businesses(owner_id)')
        .eq('id', invoice_id)
        .single()

      if (inv?.businesses?.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' })
      }
    }

    // Create Razorpay order (amount in paise = INR × 100)
    const order = await razorpay.orders.create({
      amount:   Math.round(amount * 100),
      currency,
      receipt:  invoice_id || `ord_${Date.now()}`,
      notes,
    })

    // Save order to DB
    await supabase.from('payments').insert({
      business_id:        req.body.business_id,
      invoice_id:         invoice_id || null,
      amount,
      currency,
      razorpay_order_id:  order.id,
      status:             'created',
      metadata:           { notes },
    })

    // Update invoice with order ID
    if (invoice_id) {
      await supabase
        .from('invoices')
        .update({ razorpay_order_id: order.id })
        .eq('id', invoice_id)
    }

    res.json({
      order_id:   order.id,
      amount:     order.amount,
      currency:   order.currency,
      key_id:     process.env.RAZORPAY_KEY_ID,
    })
  } catch (err) {
    console.error('Create order error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/payments/verify
 * Verifies Razorpay payment signature after checkout
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, invoice_id? }
 */
app.post('/api/payments/verify', requireAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, invoice_id } = req.body

    // HMAC-SHA256 verification
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex')

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' })
    }

    // Mark payment as captured
    await supabase
      .from('payments')
      .update({
        status:               'captured',
        razorpay_payment_id,
        razorpay_signature,
      })
      .eq('razorpay_order_id', razorpay_order_id)

    // Mark invoice as paid
    if (invoice_id) {
      await supabase
        .from('invoices')
        .update({
          status:               'paid',
          paid_at:              new Date().toISOString(),
          payment_method:       'razorpay',
          razorpay_payment_id,
        })
        .eq('id', invoice_id)
    }

    // Fetch payment details from Razorpay for receipt
    const payment = await razorpay.payments.fetch(razorpay_payment_id)

    res.json({ success: true, payment_id: razorpay_payment_id, method: payment.method })
  } catch (err) {
    console.error('Verify payment error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/payments/webhook
 * Razorpay webhook — handles async payment events
 * Configure in Razorpay dashboard: https://dashboard.razorpay.com/app/webhooks
 */
app.post('/api/payments/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature']
    const body      = req.body   // raw buffer

    // Verify webhook signature
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex')

    if (expectedSig !== signature) {
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    const event = JSON.parse(body.toString())
    console.log('Razorpay webhook:', event.event)

    switch (event.event) {
      case 'payment.captured': {
        const p = event.payload.payment.entity
        await supabase
          .from('payments')
          .update({ status: 'captured', razorpay_payment_id: p.id })
          .eq('razorpay_order_id', p.order_id)
        break
      }
      case 'payment.failed': {
        const p = event.payload.payment.entity
        await supabase
          .from('payments')
          .update({ status: 'failed' })
          .eq('razorpay_order_id', p.order_id)
        break
      }
      case 'refund.created': {
        const r = event.payload.refund.entity
        await supabase
          .from('payments')
          .update({ status: 'refunded' })
          .eq('razorpay_payment_id', r.payment_id)
        break
      }
      case 'subscription.activated': {
        const s = event.payload.subscription.entity
        await supabase
          .from('subscriptions')
          .update({ status: 'active', current_period_end: new Date(s.current_end * 1000).toISOString() })
          .eq('razorpay_sub_id', s.id)
        break
      }
      case 'subscription.cancelled': {
        const s = event.payload.subscription.entity
        await supabase
          .from('subscriptions')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('razorpay_sub_id', s.id)
        break
      }
    }

    res.json({ received: true })
  } catch (err) {
    console.error('Webhook error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ═════════════════════════════════════════
//  SUBSCRIPTIONS (Platform plans)
// ═════════════════════════════════════════

const PLAN_AMOUNTS = { starter: 29900, pro: 59900, business: 99900 } // paise

/**
 * POST /api/subscriptions/create
 * Creates a Razorpay subscription for a platform plan
 */
app.post('/api/subscriptions/create', requireAuth, async (req, res) => {
  try {
    const { plan, billing_cycle = 'monthly' } = req.body

    if (!PLAN_AMOUNTS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' })
    }

    // Get or create Razorpay plan
    const razorpayPlan = await razorpay.plans.create({
      period:   billing_cycle === 'yearly' ? 'yearly' : 'monthly',
      interval: 1,
      item: {
        name:     `Sitebana ${plan} Plan`,
        amount:   billing_cycle === 'yearly' ? Math.round(PLAN_AMOUNTS[plan] * 10 * 0.7) : PLAN_AMOUNTS[plan],
        currency: 'INR',
      },
    })

    // Create subscription
    const sub = await razorpay.subscriptions.create({
      plan_id:          razorpayPlan.id,
      total_count:      billing_cycle === 'yearly' ? 12 : 120,
      quantity:         1,
      customer_notify:  1,
      notes:            { user_id: req.user.id, plan },
    })

    // Save subscription
    await supabase.from('subscriptions').insert({
      profile_id:     req.user.id,
      plan,
      billing_cycle,
      amount:         PLAN_AMOUNTS[plan] / 100,
      status:         'created',
      razorpay_sub_id: sub.id,
    })

    res.json({ subscription_id: sub.id, key_id: process.env.RAZORPAY_KEY_ID })
  } catch (err) {
    console.error('Create subscription error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ═════════════════════════════════════════
//  AI SITE GENERATION (server-side for security)
// ═════════════════════════════════════════

/**
 * POST /api/generate-site
 * Generates website content via Claude API (server-side = key stays private)
 */
app.post('/api/generate-site', requireAuth, async (req, res) => {
  try {
    const { name, type, city, area, tagline, lang } = req.body

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1200,
        system: `You generate Indian small business website content. Return ONLY valid JSON, no markdown:
{"headline":"short punchy headline max 7 words","tagline":"one compelling sentence","about":"2-3 warm professional sentences","services":[{"name":"","price":"₹XXX","duration":"XX mins"}],"reviews":[{"name":"Indian name","initials":"XX","text":"authentic review","stars":5}],"hours":"opening hours","seo_title":"SEO title","seo_desc":"meta desc under 155 chars","whatsapp_greeting":"pre-filled WhatsApp message"}
Generate exactly 6 services and 3 reviews. Be authentic and India-specific.`,
        messages: [{ role: 'user', content: `Business: ${name}\nType: ${type}\nCity: ${city}\nArea: ${area || city}\nTagline: ${tagline}\nLanguage: ${lang || 'English'}` }],
      }),
    })

    const data  = await response.json()
    const raw   = data.content?.[0]?.text || ''
    const content = JSON.parse(raw.replace(/```json|```/g, '').trim())

    res.json({ content })
  } catch (err) {
    console.error('Generate site error:', err)
    res.status(500).json({ error: 'Content generation failed' })
  }
})

// ═════════════════════════════════════════
//  MARKETPLACE
// ═════════════════════════════════════════

/** GET /api/marketplace?q=&city=&type=&page= */
app.get('/api/marketplace', async (req, res) => {
  try {
    const { q = '', city = '', type = '', page = 1 } = req.query
    const limit  = 20
    const offset = (Number(page) - 1) * limit

    let query = supabase
      .from('businesses')
      .select('id, name, slug, type, city, area, phone, tagline, content->headline, content->services, is_featured, created_at', { count: 'exact' })
      .eq('is_live', true)
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (city && city !== 'All') query = query.eq('city', city)
    if (type && type !== 'All') query = query.ilike('type', `%${type}%`)
    if (q)                      query = query.ilike('name', `%${q}%`)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ businesses: data, total: count, page: Number(page), pages: Math.ceil(count / limit) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
//  ADMIN ROUTES (internal use)
// ─────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  next()
}

/** GET /api/admin/stats */
app.get('/api/admin/stats', requireAuth, requireAdmin, async (_req, res) => {
  const { data } = await supabase.rpc('admin_platform_stats')
  res.json(data)
})

/** POST /api/admin/feature/:bizId */
app.post('/api/admin/feature/:bizId', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('businesses')
    .update({ is_featured: true })
    .eq('id', req.params.bizId)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─────────────────────────────────────────
//  START
// ─────────────────────────────────────────
const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`✅ Sitebana API running on port ${PORT}`))

export default app
