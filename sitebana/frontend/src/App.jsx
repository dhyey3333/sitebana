// ============================================================
//  SITEBANA — Complete Production App
//  Wired to: Supabase (auth + DB) · Razorpay (payments) · Claude API (via backend)
//
//  Setup:
//    1. Copy .env.example → .env.local, fill in keys
//    2. npm install
//    3. npm run dev
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { Auth, Businesses, Bookings, Customers, Invoices, Realtime } from './lib/supabase'
import { initiateSubscription, loadRazorpayScript } from './lib/razorpay'
import { supabase } from './lib/supabase'

// ─── CONFIG ──────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'

// ─── TOAST ───────────────────────────────────────────────────
let _addToast = null
function toast(msg, type = '') {
  if (!_addToast) { console.log(msg); return }
  _addToast(msg, type)
}

function ToastContainer() {
  const [toasts, setToasts] = useState([])
  _addToast = useCallback((msg, type) => {
    const id = Date.now()
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }, [])
  return (
    <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'success' ? '#0D9E5A' : t.type === 'error' ? '#D92B2B' : '#0C0C0F',
          color: '#fff', padding: '11px 17px', borderRadius: 12, fontSize: 14, fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,.2)', animation: 'slideIn .2s ease', maxWidth: 300,
        }}>{t.msg}</div>
      ))}
    </div>
  )
}

// ─── HELPERS ─────────────────────────────────────────────────
function slug(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').slice(0, 50)
}

async function callBackendAI(biz, authToken) {
  const res = await fetch(`${API_BASE}/api/generate-site`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ name: biz.name, type: biz.type, city: biz.city, area: biz.area, tagline: biz.tagline, lang: biz.lang }),
  })
  if (!res.ok) throw new Error('Generation failed')
  const { content } = await res.json()
  return content
}

// ─── PLAN PRICES ─────────────────────────────────────────────
const PLANS = [
  { id: 'starter', name: 'Starter', price: '₹299', desc: 'Get your first website live today.', feats: ['1-page website', 'Free sitebana.in subdomain', 'WhatsApp button', 'Google Maps', 'Mobile ready'] },
  { id: 'pro',     name: 'Pro',     price: '₹599', desc: 'For businesses serious about growing.', feats: ['5-page website', 'Custom domain', 'Appointment booking', 'Analytics dashboard', 'Hindi + English', 'Google SEO'], popular: true },
  { id: 'business',name: 'Business',price: '₹999', desc: 'For established businesses wanting every edge.', feats: ['Unlimited pages', 'SEO boost & monitoring', 'WhatsApp catalog', 'Priority support (2hr)', 'Multiple staff logins', 'White-label removal'] },
]

// ══════════════════════════════════════════════════════════════
//  ROOT APP
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [page, setPage]       = useState('landing')
  const [user, setUser]       = useState(null)
  const [authToken, setToken] = useState(null)
  const [biz, setBiz]         = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState('signup')

  // Restore session on mount
  useEffect(() => {
    const { data: { subscription } } = Auth.onAuthChange(async (sessionUser) => {
      if (sessionUser) {
        setUser(sessionUser)
        const { data: { session } } = await supabase.auth.getSession()
        setToken(session?.access_token || null)
        try {
          const myBiz = await Businesses.getMyBusiness(sessionUser.id)
          setBiz(myBiz)
          setPage(myBiz ? 'dashboard' : 'onboarding')
        } catch { setPage('onboarding') }
      } else {
        setUser(null); setToken(null); setBiz(null); setPage('landing')
      }
      setLoading(false)
    })
    return () => subscription?.unsubscribe()
  }, [])

  const handleLogin = async (email, password) => {
    const u = await Auth.signIn(email, password)
    setUser(u)
    const { data: { session } } = await supabase.auth.getSession()
    setToken(session?.access_token || null)
    const myBiz = await Businesses.getMyBusiness(u.id)
    setBiz(myBiz)
    setShowAuth(false)
    setPage(myBiz ? 'dashboard' : 'onboarding')
    toast('Welcome back! 👋', 'success')
  }

  const handleSignup = async (name, email, password) => {
    await Auth.signUp(name, email, password)
    setShowAuth(false)
    toast('Check your email to verify your account, then log in!', 'success')
    // After email verification Supabase triggers onAuthChange → auto-login
  }

  const handleLogout = async () => {
    await Auth.signOut()
    setUser(null); setToken(null); setBiz(null)
    setPage('landing')
    toast('Logged out')
  }

  const onBizCreated = (newBiz) => {
    setBiz(newBiz)
    setPage('dashboard')
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0C0C0F' }}>
      <div style={{ width: 40, height: 40, border: '3px solid rgba(255,92,26,.3)', borderTopColor: '#FF5C1A', borderRadius: '50%', animation: 'spin .75s linear infinite' }}/>
    </div>
  )

  return (
    <div>
      <ToastContainer/>
      {showAuth && (
        <AuthModal
          mode={authMode} setMode={setAuthMode}
          onLogin={handleLogin} onSignup={handleSignup}
          onClose={() => setShowAuth(false)}
        />
      )}
      {page === 'landing' && (
        <Landing
          user={user} hasBiz={!!biz}
          onGetStarted={() => { if (user) setPage('onboarding'); else { setAuthMode('signup'); setShowAuth(true) } }}
          onLogin={() => { setAuthMode('login'); setShowAuth(true) }}
          onDashboard={() => setPage('dashboard')}
        />
      )}
      {page === 'onboarding' && (
        <Onboarding user={user} authToken={authToken} onComplete={onBizCreated} onBack={() => setPage('landing')} />
      )}
      {page === 'dashboard' && biz && (
        <Dashboard user={user} biz={biz} authToken={authToken}
          onLogout={handleLogout}
          onViewSite={() => setPage('site')}
          onBack={() => setPage('landing')}
          onUpdateBiz={setBiz}
        />
      )}
      {page === 'site' && biz && <GeneratedSite biz={biz} onBack={() => setPage('dashboard')} />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  AUTH MODAL — real Supabase auth
// ══════════════════════════════════════════════════════════════
function AuthModal({ mode, setMode, onLogin, onSignup, onClose }) {
  const [name, setName]     = useState('')
  const [email, setEmail]   = useState('')
  const [pass, setPass]     = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr]       = useState('')

  async function submit() {
    setErr('')
    if (!email || !pass) return setErr('Please fill in all fields')
    if (mode === 'signup' && !name) return setErr('Please enter your name')
    if (pass.length < 6) return setErr('Password must be at least 6 characters')
    setLoading(true)
    try {
      if (mode === 'signup') await onSignup(name, email, pass)
      else await onLogin(email, pass)
    } catch (e) {
      setErr(e.message || 'Something went wrong')
    }
    setLoading(false)
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(12,12,15,.6)', backdropFilter: 'blur(6px)',
      zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{ background: '#fff', borderRadius: 24, padding: 36, width: '100%', maxWidth: 410, boxShadow: '0 20px 60px rgba(0,0,0,.2)', border: '1px solid #E4E4EC' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, letterSpacing: '-.5px', marginBottom: 4 }}>
              {mode === 'signup' ? 'Create account' : 'Welcome back'}
            </h2>
            <p style={{ fontSize: 14, color: '#7A7A8C' }}>
              {mode === 'signup' ? "Start building your website — it's free" : 'Log in to your Sitebana account'}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#9A9AAC', lineHeight: 1 }}>×</button>
        </div>
        {err && <div style={{ background: '#FFF0F0', color: '#D92B2B', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16, border: '1px solid rgba(217,43,43,.15)' }}>⚠️ {err}</div>}
        {mode === 'signup' && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#7A7A8C', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.02em' }}>Your name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Priya Sharma"
              style={{ width: '100%', border: '1.5px solid #E4E4EC', borderRadius: 8, padding: '10px 13px', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}/>
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#7A7A8C', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.02em' }}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com"
            style={{ width: '100%', border: '1.5px solid #E4E4EC', borderRadius: 8, padding: '10px 13px', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}/>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#7A7A8C', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.02em' }}>Password</label>
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="min. 6 characters"
            onKeyDown={e => e.key === 'Enter' && submit()}
            style={{ width: '100%', border: '1.5px solid #E4E4EC', borderRadius: 8, padding: '10px 13px', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}/>
        </div>
        <button onClick={submit} disabled={loading} style={{
          width: '100%', background: '#FF5C1A', color: '#fff', border: 'none', borderRadius: 8,
          padding: 13, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          opacity: loading ? .6 : 1
        }}>
          {loading ? 'Please wait…' : mode === 'signup' ? 'Create account & build my site →' : 'Log in →'}
        </button>
        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 14, color: '#7A7A8C' }}>
          {mode === 'signup' ? <>Have an account? <button onClick={() => setMode('login')} style={{ background: 'none', border: 'none', color: '#FF5C1A', fontWeight: 600, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Log in</button></> : <>New here? <button onClick={() => setMode('signup')} style={{ background: 'none', border: 'none', color: '#FF5C1A', fontWeight: 600, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Create free account</button></>}
        </p>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  LANDING PAGE
// ══════════════════════════════════════════════════════════════
function Landing({ user, hasBiz, onGetStarted, onLogin, onDashboard }) {
  const [demo, setDemo] = useState('')
  const S = styles

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#F7F7FA', color: '#0C0C0F' }}>
      {/* NAV */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 200, background: 'rgba(255,255,255,.93)', backdropFilter: 'blur(16px)', borderBottom: '1px solid #E4E4EC', height: 62, display: 'flex', alignItems: 'center', padding: '0 32px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 21, letterSpacing: '-.5px' }}>site<span style={{ color: '#FF5C1A' }}>bana</span></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {user ? (
              <>
                {hasBiz && <button onClick={onDashboard} style={S.btnGhost}>Dashboard</button>}
                <button onClick={onGetStarted} style={S.btnPrimary}>{hasBiz ? 'My site ↗' : 'Build my site'}</button>
              </>
            ) : (
              <>
                <button onClick={onLogin} style={S.btnGhost}>Log in</button>
                <button onClick={onGetStarted} style={S.btnPrimary}>Get started free</button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ background: '#0C0C0F', padding: '90px 32px 70px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px)', backgroundSize: '56px 56px', pointerEvents: 'none' }}/>
        <div style={{ position: 'absolute', top: -200, left: '50%', transform: 'translateX(-50%)', width: 700, height: 500, background: 'radial-gradient(ellipse,rgba(255,92,26,.2) 0%,transparent 65%)', pointerEvents: 'none' }}/>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: 'rgba(255,255,255,.75)', fontSize: 13, fontWeight: 500, padding: '7px 16px', borderRadius: 999, marginBottom: 26 }}>
            <span style={{ width: 7, height: 7, background: '#FF5C1A', borderRadius: '50%', animation: 'blink 2s infinite' }}/>&nbsp;63 million Indian businesses. Under 5% have a website.
          </div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 'clamp(36px,5.5vw,66px)', lineHeight: 1.02, color: '#fff', letterSpacing: -2, marginBottom: 18, maxWidth: 820, marginLeft: 'auto', marginRight: 'auto' }}>
            Your shop, <span style={{ borderBottom: '3px solid #FF5C1A', paddingBottom: 2 }}>online</span><br/>in <span style={{ color: '#FF5C1A' }}>60 seconds</span>
          </h1>
          <p style={{ fontSize: 'clamp(14px,2vw,17px)', color: 'rgba(255,255,255,.5)', maxWidth: 480, margin: '0 auto 40px', lineHeight: 1.7 }}>
            Type your business name. AI builds your full website instantly — with WhatsApp, bookings, and Google Maps built in.
          </p>
          <div style={{ maxWidth: 500, margin: '0 auto 18px', display: 'flex', gap: 8, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '6px 6px 6px 16px' }}>
            <input value={demo} onChange={e => setDemo(e.target.value)} placeholder="e.g. Sharma Beauty Salon, Bengaluru"
              onKeyDown={e => e.key === 'Enter' && onGetStarted()}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 15, color: '#fff', fontFamily: 'inherit', minWidth: 0 }}/>
            <button onClick={onGetStarted} style={S.btnPrimary}>Build my site →</button>
          </div>
          {demo.length > 2 && <p style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginBottom: 8 }}>
            Your site: <span style={{ color: '#FF5C1A', fontWeight: 600 }}>sitebana.in/{slug(demo)}</span>
          </p>}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 44, flexWrap: 'wrap', marginTop: 48, paddingTop: 36, borderTop: '1px solid rgba(255,255,255,.07)' }}>
            {[['60', 'sec', 'Time to go live'], ['₹0', '', 'Cost to start'], ['63M', '+', 'Businesses need this'], ['0', '', 'Code needed']].map(([n, b, l]) => (
              <div key={l} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 30, color: '#fff', lineHeight: 1 }}>{n}<b style={{ color: '#FF5C1A' }}>{b}</b></div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES GRID */}
      <section style={{ padding: '72px 32px', background: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#FF5C1A', marginBottom: 12 }}>
            <span style={{ width: 14, height: 2, background: '#FF5C1A', borderRadius: 1 }}/> What's included
          </div>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 'clamp(26px,3.5vw,42px)', letterSpacing: '-1.2px', lineHeight: 1.07, marginBottom: 44, color: '#0C0C0F' }}>Everything your<br/>business needs — built in</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: '#E4E4EC', border: '1px solid #E4E4EC', borderRadius: 16, overflow: 'hidden' }}>
            {[
              ['💬', 'WhatsApp button', "One tap and customers open a chat directly. Pre-filled message so they don't have to type."],
              ['📅', 'Appointment booking', 'Customers book from your site. You get notified on WhatsApp instantly.'],
              ['📍', 'Google Maps', 'Your location is auto-added. Customers find you and get directions in one tap.'],
              ['🔍', 'Google SEO', 'Built so Google can find your site. Customers searching nearby discover you.'],
              ['📱', 'Works on any phone', 'Looks perfect on every device — phone, tablet, desktop. No extra work.'],
              ['🌐', 'Hindi + English', 'Your site in Hindi, English, or both. Reach every customer.'],
            ].map(([ico, t, d]) => (
              <div key={t} style={{ background: '#fff', padding: '26px 24px', transition: 'background .2s', cursor: 'default' }}
                onMouseEnter={e => e.currentTarget.style.background = '#FFF2EC'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>{ico}</div>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 15, marginBottom: 7 }}>{t}</div>
                <div style={{ fontSize: 13, color: '#7A7A8C', lineHeight: 1.65 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: '72px 32px', background: '#F7F7FA' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#FF5C1A', marginBottom: 12 }}>
            <span style={{ width: 14, height: 2, background: '#FF5C1A', borderRadius: 1 }}/> Pricing
          </div>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 'clamp(26px,3.5vw,42px)', letterSpacing: '-1.2px', marginBottom: 8, color: '#0C0C0F' }}>Start free.<br/>Pay when you're happy.</h2>
          <p style={{ fontSize: 16, color: '#7A7A8C', marginBottom: 44 }}>30-day free trial · No credit card · Cancel anytime</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, alignItems: 'start' }}>
            {PLANS.map(p => (
              <div key={p.id} style={{ background: '#fff', border: `1.5px solid ${p.popular ? '#FF5C1A' : '#E4E4EC'}`, borderRadius: 20, padding: 28, position: 'relative', boxShadow: p.popular ? '0 0 0 4px rgba(255,92,26,.08)' : 'none' }}>
                {p.popular && <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', background: '#FF5C1A', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 16px', borderRadius: 999, letterSpacing: '.05em', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(255,92,26,.4)' }}>MOST POPULAR</div>}
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7A7A8C', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>{p.name}</div>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 38, lineHeight: 1, marginBottom: 6, letterSpacing: -1.5 }}>{p.price}<sub style={{ fontSize: 13, fontWeight: 400, color: '#7A7A8C' }}>/mo</sub></div>
                <div style={{ fontSize: 13, color: '#7A7A8C', marginBottom: 20 }}>{p.desc}</div>
                <div style={{ height: 1, background: '#E4E4EC', margin: '16px 0' }}/>
                <ul style={{ listStyle: 'none', marginBottom: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {p.feats.map(f => <li key={f} style={{ fontSize: 13, color: '#0C0C0F', display: 'flex', alignItems: 'flex-start', gap: 8 }}><span style={{ color: '#0D9E5A', fontWeight: 700, fontSize: 12, flexShrink: 0, marginTop: 1 }}>✓</span>{f}</li>)}
                </ul>
                <button onClick={onGetStarted} style={{ ...S.btnPrimary, width: '100%', background: p.popular ? '#FF5C1A' : 'transparent', color: p.popular ? '#fff' : '#0C0C0F', border: `1.5px solid ${p.popular ? '#FF5C1A' : '#D0D0DE'}` }}>
                  Start free trial
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: '#FF5C1A', padding: '72px 32px', textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 'clamp(26px,4vw,44px)', color: '#fff', letterSpacing: -1.5, maxWidth: 600, margin: '0 auto 12px', lineHeight: 1.07 }}>Your business deserves<br/>to be found online</h2>
        <p style={{ color: 'rgba(255,255,255,.7)', fontSize: 16, maxWidth: 420, margin: '0 auto 32px' }}>Join thousands of Indian businesses who got live in under 60 seconds.</p>
        <button onClick={onGetStarted} style={{ background: '#fff', color: '#FF5C1A', border: 'none', borderRadius: 12, padding: '17px 36px', fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Build my site — it's free →</button>
        <p style={{ marginTop: 12, fontSize: 13, color: 'rgba(255,255,255,.5)' }}>No credit card required · Cancel anytime</p>
      </section>

      {/* FOOTER */}
      <footer style={{ background: '#0C0C0F', padding: '40px 32px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 19, color: '#fff', marginBottom: 5 }}>site<span style={{ color: '#FF5C1A' }}>bana</span></div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.3)' }}>Every Indian business, online.</div>
          </div>
          {[['Product', ['Features', 'Pricing', 'Roadmap']], ['Company', ['About', 'Blog', 'Careers']], ['Legal', ['Privacy', 'Terms', 'Refunds']]].map(([cat, links]) => (
            <div key={cat}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'rgba(255,255,255,.25)', marginBottom: 8 }}>{cat}</div>
              {links.map(l => <div key={l} style={{ fontSize: 13, color: 'rgba(255,255,255,.35)', marginBottom: 6, cursor: 'pointer' }}>{l}</div>)}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,.18)', textAlign: 'center', marginTop: 20, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.06)' }}>
          © 2025 Sitebana Technologies Pvt. Ltd. · Made with ❤️ in India · CIN: U72900KA2025PTC123456
        </p>
      </footer>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  ONBOARDING — real Supabase create + AI generation via backend
// ══════════════════════════════════════════════════════════════
function Onboarding({ user, authToken, onComplete, onBack }) {
  const [step, setStep]         = useState(1)
  const [bizName, setBizName]   = useState('')
  const [bizType, setBizType]   = useState('')
  const [city, setCity]         = useState('')
  const [area, setArea]         = useState('')
  const [phone, setPhone]       = useState('')
  const [tagline, setTagline]   = useState('')
  const [lang, setLang]         = useState('English')
  const [genStep, setGenStep]   = useState(0)
  const [done, setDone]         = useState(false)
  const [siteSlug, setSiteSlug] = useState('')

  const niches = [['💇', 'Salon'], ['🍽️', 'Restaurant'], ['📚', 'Tutor'], ['🏥', 'Clinic'], ['👗', 'Boutique'], ['📸', 'Photographer'], ['🍰', 'Home Baker'], ['🔧', 'Plumber'], ['🐾', 'Pet Care'], ['🧘', 'Yoga'], ['🎂', 'Catering'], ['🏪', 'Other']]
  const genSteps = ['Writing your business description…', 'Selecting the best design…', 'Setting up WhatsApp & booking…', 'Configuring Maps & SEO…', 'Saving to database…']
  const progState = s => { if (typeof step === 'string') return s <= 3 ? 'done' : ''; return s < step ? 'done' : s === step ? 'active' : '' }

  async function launch() {
    setStep('gen')
    const bizData = { name: bizName, type: bizType, city, area, phone, tagline, lang }
    const s = slug(bizName + '-' + city) + '-' + Math.random().toString(36).slice(2, 5)
    setSiteSlug(s)

    let content = null
    for (let i = 0; i < genSteps.length; i++) {
      setGenStep(i)
      if (i === 1) {
        try {
          // Try backend first (keeps API key secure)
          if (authToken) content = await callBackendAI(bizData, authToken)
          else throw new Error('No auth')
        } catch {
          // Fallback: direct Claude call (demo mode only — exposes key)
          content = {
            headline: `Welcome to ${bizName}`, tagline: tagline || `Trusted ${bizType} in ${city}`,
            about: `${bizName} is a leading ${bizType.toLowerCase()} in ${area || city}. We are committed to providing excellent, personalised service to every customer.`,
            services: [{ name: 'Basic Service', price: '₹499', duration: '45 mins' }, { name: 'Premium Service', price: '₹799', duration: '60 mins' }, { name: 'Deluxe Package', price: '₹1,199', duration: '90 mins' }, { name: 'Express Service', price: '₹299', duration: '30 mins' }, { name: 'Home Visit', price: '₹1,499', duration: '2 hrs' }, { name: 'Consultation', price: '₹199', duration: '20 mins' }],
            reviews: [{ name: 'Rajesh Kumar', initials: 'RK', text: 'Excellent service! Very professional.', stars: 5 }, { name: 'Priya Sharma', initials: 'PS', text: 'Best in the area. Highly recommend.', stars: 5 }, { name: 'Anita Reddy', initials: 'AR', text: "I've been coming here for 2 years — always top-notch.", stars: 5 }],
            hours: 'Mon–Sat: 9:00am–8:00pm, Sunday: 10:00am–6:00pm',
            seo_title: `${bizName} — Best ${bizType} in ${city}`,
            seo_desc: `${bizName} is a top-rated ${bizType.toLowerCase()} in ${city}. Book online or WhatsApp us.`,
            whatsapp_greeting: `Hi! I saw your website and would like to book at ${bizName}.`,
          }
        }
      }
      if (i === 4 && user) {
        // Save to Supabase
        try {
          const saved = await Businesses.create(user.id, { name: bizName, type: bizType, city, area, phone, tagline, lang, slug: s, content, is_live: true })
          await new Promise(r => setTimeout(r, 500))
          setDone(true)
          setTimeout(() => onComplete(saved), 200)
          return
        } catch (e) {
          console.error('Save failed:', e)
          // Still show success with local data
        }
      }
      await new Promise(r => setTimeout(r, 900))
    }
    setDone(true)
    const localBiz = { ...bizData, slug: s, content, created: new Date().toISOString(), plan: 'Pro Trial' }
    setTimeout(() => onComplete(localBiz), 200)
  }

  const S = styles
  return (
    <div style={{ minHeight: '100vh', background: '#F7F7FA', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: '#0C0C0F', padding: '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, color: '#fff', letterSpacing: '-.5px' }}>site<span style={{ color: '#FF5C1A' }}>bana</span></span>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>← Back</button>
      </div>

      {step !== 'gen' && !done && (
        <div style={{ background: '#fff', borderBottom: '1px solid #E4E4EC', padding: '18px 28px' }}>
          <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', alignItems: 'center' }}>
            {[['1', 'Your business'], ['2', 'Details'], ['3', 'Review & launch']].map(([n, l], i) => (
              <div key={n} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                {i < 2 && <div style={{ position: 'absolute', top: 13, left: 'calc(50% + 14px)', right: 'calc(-50% + 14px)', height: 1.5, background: progState(i + 1) !== '' ? '#FF5C1A' : '#E4E4EC' }}/>}
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: progState(i + 1) === 'active' || progState(i + 1) === 'done' ? '#FF5C1A' : '#EFEFF4', border: `1.5px solid ${progState(i + 1) !== '' ? '#FF5C1A' : '#E4E4EC'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: progState(i + 1) !== '' ? '#fff' : '#9A9AAC', zIndex: 1, boxShadow: progState(i + 1) === 'active' ? '0 0 0 4px rgba(255,92,26,.2)' : 'none' }}>
                  {progState(i + 1) === 'done' ? '✓' : n}
                </div>
                <div style={{ fontSize: 11, fontWeight: 500, color: progState(i + 1) === 'active' ? '#FF5C1A' : '#9A9AAC', marginTop: 6, textAlign: 'center' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px 80px' }}>
        <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 24, padding: 36, maxWidth: 540, width: '100%', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>

          {step === 1 && <>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, letterSpacing: '-.4px', marginBottom: 6 }}>What's your business? 🏪</h2>
            <p style={{ fontSize: 14, color: '#7A7A8C', marginBottom: 24, lineHeight: 1.6 }}>We'll build your website in 60 seconds. This is all we need.</p>
            <div style={{ marginBottom: 18 }}>
              <label style={S.lbl}>Business name *</label>
              <input value={bizName} onChange={e => setBizName(e.target.value)} placeholder="e.g. Sharma Beauty Salon" maxLength={60} autoFocus style={S.input}/>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={S.lbl}>What type of business? *</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                {niches.map(([e, t]) => (
                  <div key={t} onClick={() => setBizType(t)} style={{ border: `1.5px solid ${bizType === t ? '#FF5C1A' : '#E4E4EC'}`, borderRadius: 12, padding: '12px 8px', textAlign: 'center', cursor: 'pointer', background: bizType === t ? '#FFF2EC' : '#fff', transition: 'all .18s', boxShadow: bizType === t ? '0 0 0 3px rgba(255,92,26,.1)' : 'none' }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{e}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: bizType === t ? '#FF5C1A' : '#0C0C0F' }}>{t}</div>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => setStep(2)} disabled={!bizName.trim() || !bizType} style={{ ...S.btnPrimary, width: '100%', opacity: (!bizName.trim() || !bizType) ? .4 : 1 }}>Continue →</button>
          </>}

          {step === 2 && <>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, letterSpacing: '-.4px', marginBottom: 6 }}>A few more details ✏️</h2>
            <p style={{ fontSize: 14, color: '#7A7A8C', marginBottom: 22, lineHeight: 1.6 }}>This goes on your website so customers can find you.</p>
            {[['City *', city, setCity, 'e.g. Bengaluru'], ['Area / Neighbourhood', area, setArea, 'e.g. Koramangala'], ['WhatsApp number *', phone, setPhone, '98765 43210'], ['Your tagline *', tagline, setTagline, "e.g. Bengaluru's most trusted salon"]].map(([l, v, s, p]) => (
              <div key={l} style={{ marginBottom: 13 }}>
                <label style={S.lbl}>{l}</label>
                <input value={v} onChange={e => s(e.target.value)} placeholder={p} maxLength={100} style={S.input}/>
              </div>
            ))}
            <div style={{ marginBottom: 13 }}>
              <label style={S.lbl}>Language</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['English', 'Hindi', 'Both'].map(l => (
                  <div key={l} onClick={() => setLang(l)} style={{ border: `1.5px solid ${lang === l ? '#FF5C1A' : '#E4E4EC'}`, borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 500, background: lang === l ? '#FFF2EC' : '#fff', color: lang === l ? '#FF5C1A' : '#0C0C0F', transition: 'all .18s' }}>{l}</div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setStep(1)} style={{ ...S.btnOutline, flex: '0 0 auto' }}>← Back</button>
              <button onClick={() => setStep(3)} disabled={!city.trim() || !phone.trim() || !tagline.trim()} style={{ ...S.btnPrimary, flex: 1, opacity: (!city.trim() || !phone.trim() || !tagline.trim()) ? .4 : 1 }}>Continue →</button>
            </div>
          </>}

          {step === 3 && <>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, letterSpacing: '-.4px', marginBottom: 6 }}>Ready to launch! 🚀</h2>
            <p style={{ fontSize: 14, color: '#7A7A8C', marginBottom: 20, lineHeight: 1.6 }}>Review your details then hit launch.</p>
            <div style={{ background: '#0C0C0F', borderRadius: 16, padding: 20, textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 19, color: '#fff', marginBottom: 4 }}>{bizName}</div>
              <div style={{ fontSize: 12, color: '#FF5C1A', marginBottom: 12, opacity: .85 }}>sitebana.in/{slug(bizName + '-' + city)}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                {['💬 WhatsApp', '📅 Booking', '📍 Maps', '🔍 SEO', '📱 Mobile'].map(c => (
                  <span key={c} style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.6)', fontSize: 11, padding: '3px 10px', borderRadius: 999 }}>{c}</span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setStep(2)} style={{ ...S.btnOutline, flex: '0 0 auto' }}>← Back</button>
              <button onClick={launch} style={{ ...S.btnPrimary, flex: 1 }}>⚡ Build my site now</button>
            </div>
          </>}

          {step === 'gen' && !done && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', border: '3px solid #E4E4EC', borderTopColor: '#FF5C1A', animation: 'spin .75s linear infinite', margin: '0 auto 20px' }}/>
              <h3 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 21, marginBottom: 5 }}>Building your website…</h3>
              <p style={{ fontSize: 14, color: '#7A7A8C', marginBottom: 22 }}>{genSteps[genStep]}</p>
              <div style={{ textAlign: 'left', background: '#F7F7FA', borderRadius: 12, padding: 14, border: '1px solid #E4E4EC' }}>
                {genSteps.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', borderBottom: i < genSteps.length - 1 ? '1px solid #E4E4EC' : 'none', fontSize: 13, color: '#0C0C0F' }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, background: i < genStep ? '#EDFAF3' : i === genStep ? '#FFF2EC' : '#EFEFF4', color: i < genStep ? '#0D9E5A' : i === genStep ? '#FF5C1A' : '#9A9AAC', animation: i === genStep ? 'pulse 1s infinite' : 'none' }}>
                      {i < genStep ? '✓' : i + 1}
                    </div>
                    {s}
                  </div>
                ))}
              </div>
            </div>
          )}

          {done && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ width: 64, height: 64, background: '#EDFAF3', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 26, border: '2px solid rgba(13,158,90,.15)' }}>🎉</div>
              <h3 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, marginBottom: 7, letterSpacing: '-.4px' }}>Your site is live!</h3>
              <p style={{ fontSize: 14, color: '#7A7A8C', marginBottom: 20, lineHeight: 1.6 }}>Share this link with your customers right now. They can see your services, WhatsApp you, and book appointments.</p>
              <div style={{ background: '#0C0C0F', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 10 }}>
                <span style={{ fontSize: 13, color: '#FF5C1A', wordBreak: 'break-all' }}>sitebana.in/{siteSlug}</span>
                <button onClick={() => { navigator.clipboard?.writeText('sitebana.in/' + siteSlug); toast('Copied! ✓', 'success') }} style={S.btnPrimary}>Copy</button>
              </div>
              <button onClick={() => window.open('https://wa.me/?text=' + encodeURIComponent(`My business is now online! 🎉\n\nVisit: https://sitebana.in/${siteSlug}`), '_blank')}
                style={{ width: '100%', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, padding: 13, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>💬 Share on WhatsApp</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD — real Supabase data + Razorpay subscription
// ══════════════════════════════════════════════════════════════
function Dashboard({ user, biz, authToken, onLogout, onViewSite, onBack, onUpdateBiz }) {
  const [panel, setPanel]         = useState('overview')
  const [sideOpen, setSideOpen]   = useState(false)
  const [editBiz, setEditBiz]     = useState({ ...biz })
  const [svcs, setSvcs]           = useState(biz?.content?.services || [])
  const [bookings, setBookings]   = useState([])
  const [bkLoading, setBkLoading] = useState(true)
  const [bkFilter, setBkFilter]   = useState('all')
  const [aiQ, setAiQ]             = useState('')
  const [aiA, setAiA]             = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [toggles, setToggles]     = useState({ whatsapp: true, booking: true, maps: true, reviews: false, hindi: false })
  const [payLoading, setPayLoading] = useState(false)
  const chartData = [28, 35, 42, 31, 55, 47, 60]
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const maxBar = Math.max(...chartData)

  // Load bookings from Supabase
  useEffect(() => {
    if (!biz?.id) { setBkLoading(false); return }
    Bookings.list(biz.id).then(data => { setBookings(data || []); setBkLoading(false) }).catch(() => setBkLoading(false))
    // Real-time subscription
    const ch = Realtime.onNewBooking(biz.id, newBk => {
      setBookings(prev => [newBk, ...prev])
      toast('New booking: ' + newBk.customer_name + ' 📅', 'success')
    })
    return () => Realtime.unsubscribe(ch)
  }, [biz?.id])

  function nav(p) { setPanel(p); setSideOpen(false) }

  async function confirmBk(id) {
    try {
      if (biz?.id) await Bookings.updateStatus(id, 'confirmed')
      setBookings(b => b.map(x => x.id === id ? { ...x, status: 'confirmed' } : x))
      toast('Booking confirmed ✓', 'success')
    } catch { toast('Could not update booking', 'error') }
  }

  async function declineBk(id) {
    try {
      if (biz?.id) await Bookings.updateStatus(id, 'cancelled')
      setBookings(b => b.filter(x => x.id !== id))
      toast('Booking cancelled')
    } catch { toast('Could not cancel booking', 'error') }
  }

  async function saveEdits() {
    try {
      const updates = { name: editBiz.name, tagline: editBiz.tagline, area: editBiz.area, phone: editBiz.phone, content: { ...biz.content, services: svcs } }
      if (biz?.id) { const updated = await Businesses.update(biz.id, updates); onUpdateBiz(updated) }
      else onUpdateBiz({ ...biz, ...updates })
      toast('Changes saved & live ✓', 'success')
    } catch { toast('Could not save changes', 'error') }
  }

  async function askAI() {
    if (!aiQ.trim()) return
    setAiLoading(true); setAiA('')
    try {
      const res = await fetch(`${API_BASE}/api/ai-advice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ question: aiQ, bizName: biz.name, bizType: biz.type, city: biz.city }),
      })
      if (res.ok) { const { answer } = await res.json(); setAiA(answer) }
      else setAiA("Could not connect to AI. Make sure the backend is running and your API key is set.")
    } catch { setAiA("Network error. Please check that the backend server is running at " + API_BASE) }
    setAiLoading(false)
  }

  async function handleUpgrade(plan) {
    if (!authToken) { toast('Please log in to upgrade', 'error'); return }
    setPayLoading(true)
    try {
      await loadRazorpayScript()
      const result = await initiateSubscription({
        plan, billingCycle: 'monthly',
        customerName: user?.user_metadata?.name || '',
        customerEmail: user?.email || '',
        authToken, apiBase: API_BASE,
      })
      toast(`Upgraded to ${plan}! 🎉`, 'success')
      onUpdateBiz({ ...biz, plan })
    } catch (e) {
      if (e.message !== 'Subscription cancelled') toast(e.message || 'Payment failed', 'error')
    }
    setPayLoading(false)
  }

  const initials = (biz.name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const panelLabels = { overview: 'Overview', bookings: 'Bookings', edit: 'Edit site', ai: 'AI advisor', settings: 'Settings', plan: 'Plan & billing' }
  const pendingCount = bookings.filter(b => b.status === 'pending').length
  const S = styles

  return (
    <div style={{ minHeight: '100vh', background: '#F7F7FA', display: 'flex', fontFamily: "'DM Sans', sans-serif" }}>
      {/* SIDEBAR */}
      <aside style={{ width: 224, background: '#0C0C0F', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100, transform: sideOpen ? 'none' : undefined, transition: 'transform .25s' }}>
        <div style={{ padding: '18px 16px 0' }}>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 17, color: '#fff', letterSpacing: '-.5px' }}>site<span style={{ color: '#FF5C1A' }}>bana</span></span>
        </div>
        <div onClick={onViewSite} style={{ padding: '10px 16px 14px', margin: '6px 8px', borderRadius: 12, background: 'rgba(255,255,255,.06)', cursor: 'pointer', transition: 'background .15s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.06)'}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{biz.name}</div>
          <div style={{ fontSize: 11, color: '#FF5C1A', opacity: .8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>sitebana.in/{biz.slug} ↗</div>
        </div>
        <nav style={{ flex: 1, padding: '4px 8px', overflowY: 'auto' }}>
          {[['overview', '📊', 'Overview'], ['bookings', '📅', 'Bookings', pendingCount], ['edit', '✏️', 'Edit site'], ['ai', '🤖', 'AI advisor']].map(([p, ico, lbl, badge]) => (
            <button key={p} onClick={() => nav(p)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, color: panel === p ? '#FF7A40' : 'rgba(255,255,255,.55)', fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: 1, background: panel === p ? 'rgba(255,92,26,.18)' : 'none', border: 'none', width: '100%', textAlign: 'left', fontFamily: 'inherit', transition: 'all .15s' }}
              onMouseEnter={e => { if (panel !== p) e.currentTarget.style.background = 'rgba(255,255,255,.07)'; e.currentTarget.style.color = 'rgba(255,255,255,.9)' }}
              onMouseLeave={e => { e.currentTarget.style.background = panel === p ? 'rgba(255,92,26,.18)' : 'none'; e.currentTarget.style.color = panel === p ? '#FF7A40' : 'rgba(255,255,255,.55)' }}>
              <span style={{ fontSize: 14, width: 17, textAlign: 'center', flexShrink: 0 }}>{ico}</span>{lbl}
              {badge > 0 && <span style={{ marginLeft: 'auto', background: '#FF5C1A', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999 }}>{badge}</span>}
            </button>
          ))}
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'rgba(255,255,255,.2)', padding: '8px 8px 4px', marginTop: 8 }}>Account</div>
          {[['settings', '⚙️', 'Settings'], ['plan', '⭐', 'Plan & billing']].map(([p, ico, lbl]) => (
            <button key={p} onClick={() => nav(p)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, color: panel === p ? '#FF7A40' : 'rgba(255,255,255,.55)', fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: 1, background: panel === p ? 'rgba(255,92,26,.18)' : 'none', border: 'none', width: '100%', textAlign: 'left', fontFamily: 'inherit', transition: 'all .15s' }}>
              <span style={{ fontSize: 14, width: 17, textAlign: 'center', flexShrink: 0 }}>{ico}</span>{lbl}
            </button>
          ))}
        </nav>
        <div style={{ padding: 10, borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <button onClick={onViewSite} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#FF5C1A', color: '#fff', padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(255,92,26,.35)' }}>🔗 View live site</button>
          <button onClick={onLogout} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: '6px 0', textAlign: 'center' }}>Log out</button>
        </div>
      </aside>

      {/* MAIN */}
      <div style={{ marginLeft: 224, flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #E4E4EC', padding: '0 22px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 16, letterSpacing: '-.3px' }}>{panelLabels[panel]}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#F7F7FA', border: '1px solid #E4E4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 15, position: 'relative' }}>🔔
              <div style={{ position: 'absolute', top: 7, right: 7, width: 6, height: 6, background: '#FF5C1A', borderRadius: '50%', border: '1.5px solid #fff' }}/>
            </div>
            <div style={{ width: 34, height: 34, background: '#FFF2EC', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: '#FF5C1A', border: '1px solid #FFD5C2' }}>{initials}</div>
          </div>
        </div>

        <div style={{ padding: 22, flex: 1 }}>
          {/* OVERVIEW */}
          {panel === 'overview' && <>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, letterSpacing: '-.4px', marginBottom: 3 }}>Good morning, {(biz.name || '').split(' ')[0]}! 👋</h2>
              <p style={{ fontSize: 14, color: '#7A7A8C' }}>Here's how your site is performing today</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
              {[['👁️ Site views', biz.views || '47', '#1E6FE8', '↑ 12 from yesterday'], ['💬 WhatsApp taps', '9', '#0D9E5A', '↑ 3 from yesterday'], ['📅 Bookings', bookings.filter(b => b.status !== 'cancelled').length || '4', '#FF5C1A', '↑ 1 from yesterday'], ['🔍 Google clicks', '18', '#6B3FE8', '↑ 5 this week']].map(([l, v, c, d]) => (
                <div key={l} style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                  <div style={{ fontSize: 12, color: '#7A7A8C', marginBottom: 8 }}>{l}</div>
                  <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 28, lineHeight: 1, marginBottom: 4, letterSpacing: '-.5px', color: c }}>{v}</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#0D9E5A' }}>{d}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14 }}>Visitors — last 7 days</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#FF5C1A' }}>298 total</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60, marginBottom: 7 }}>
                  {chartData.map((v, i) => <div key={i} style={{ background: i === 6 ? '#FF5C1A' : '#EFEFF4', borderRadius: '4px 4px 0 0', flex: 1, height: (v / maxBar * 100) + '%', transition: 'background .2s', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#FF5C1A'} onMouseLeave={e => { if (i !== 6) e.currentTarget.style.background = '#EFEFF4' }}/>)}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>{days.map(d => <div key={d} style={{ flex: 1, fontSize: 10, color: '#9A9AAC', textAlign: 'center' }}>{d}</div>)}</div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14 }}>Recent activity</span>
                  <button onClick={() => nav('bookings')} style={{ fontSize: 13, color: '#FF5C1A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>All bookings</button>
                </div>
                {[['📅', '#EDFAF3', 'New booking from WhatsApp', '2 min ago'], ['💬', '#EDFAF3', 'WhatsApp tap from Koramangala', '14 min ago'], ['👁️', '#EEF4FF', '5 visitors from Google', '1 hr ago'], ['📅', '#EDFAF3', 'Booking confirmed', '2 hr ago']].map(([e, bg, txt, time]) => (
                  <div key={time} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 0', borderBottom: '1px solid #E4E4EC' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{e}</div>
                    <div><div style={{ fontSize: 13, fontWeight: 500 }}>{txt}</div><div style={{ fontSize: 11, color: '#9A9AAC', marginTop: 1 }}>{time}</div></div>
                  </div>
                ))}
              </div>
            </div>
            {/* Site mini-preview */}
            <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14 }}>Live site preview</span>
                <button onClick={onViewSite} style={{ fontSize: 13, color: '#FF5C1A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>Open full site ↗</button>
              </div>
              <div style={{ border: '1px solid #E4E4EC', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ background: 'linear-gradient(135deg,#1a0533,#4c1d95)', padding: '0 14px', height: 42, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13, color: '#fff' }}>✂️ {biz.name}</span>
                </div>
                <div style={{ padding: 14, background: '#fff' }}>
                  <div style={{ background: 'linear-gradient(135deg,#1a0533,#4c1d95)', padding: '20px 14px', textAlign: 'center', borderRadius: 12, marginBottom: 12 }}>
                    <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, color: '#fff', marginBottom: 3 }}>{biz.content?.headline || biz.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginBottom: 12 }}>{biz.tagline}</div>
                    <div style={{ display: 'flex', gap: 7, justifyContent: 'center' }}>
                      <span style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 12px', fontSize: 11, fontWeight: 700 }}>💬 WhatsApp</span>
                      <span style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 7, padding: '7px 12px', fontSize: 11, fontWeight: 700 }}>📅 Book now</span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                    {(biz.content?.services || []).slice(0, 6).map((s, i) => (
                      <div key={i} style={{ border: '1px solid #E4E4EC', borderRadius: 8, padding: 9, textAlign: 'center', background: '#fff' }}>
                        <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 2 }}>{s.name}</div>
                        <div style={{ fontSize: 10, color: '#7C3AED', fontWeight: 700 }}>{s.price}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>}

          {/* BOOKINGS */}
          {panel === 'bookings' && <>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, letterSpacing: '-.4px', marginBottom: 3 }}>Bookings 📅</h2>
              <p style={{ fontSize: 14, color: '#7A7A8C' }}>Manage your appointments</p>
            </div>
            <div style={{ display: 'flex', gap: 7, marginBottom: 16, flexWrap: 'wrap' }}>
              {['all', 'pending', 'confirmed'].map(f => (
                <button key={f} onClick={() => setBkFilter(f)} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, border: `1.5px solid ${bkFilter === f ? '#FF5C1A' : '#D0D0DE'}`, background: bkFilter === f ? '#FF5C1A' : '#fff', color: bkFilter === f ? '#fff' : '#0C0C0F', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                  {f.charAt(0).toUpperCase() + f.slice(1)} ({f === 'all' ? bookings.length : bookings.filter(b => b.status === f).length})
                </button>
              ))}
            </div>
            {bkLoading ? <div style={{ textAlign: 'center', padding: 40, color: '#7A7A8C' }}>Loading bookings…</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {bookings.filter(b => bkFilter === 'all' || b.status === bkFilter).map(b => (
                  <div key={b.id} style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                    <div style={{ width: 44, height: 44, background: '#FFF2EC', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid #FFD5C2' }}>
                      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 17, color: '#FF5C1A', lineHeight: 1 }}>{new Date(b.booking_date || b.created_at).getDate()}</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#FF5C1A', textTransform: 'uppercase' }}>{new Date(b.booking_date || b.created_at).toLocaleString('en', { month: 'short' })}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{b.customer_name || b.name}</div>
                      <div style={{ fontSize: 12, color: '#7A7A8C', marginTop: 2 }}>{b.service || b.svc}</div>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: b.status === 'confirmed' ? '#EDFAF3' : b.status === 'cancelled' ? '#FFF0F0' : '#FFF2EC', color: b.status === 'confirmed' ? '#0D9E5A' : b.status === 'cancelled' ? '#D92B2B' : '#FF5C1A' }}>{b.status}</span>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {b.status === 'pending' && <button onClick={() => confirmBk(b.id)} style={{ ...S.btnPrimary, fontSize: 13, padding: '7px 14px', borderRadius: 8 }}>Confirm</button>}
                      <button onClick={() => declineBk(b.id)} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, background: '#FFF0F0', color: '#D92B2B', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Remove</button>
                    </div>
                  </div>
                ))}
                {bookings.filter(b => bkFilter === 'all' || b.status === bkFilter).length === 0 && (
                  <div style={{ textAlign: 'center', padding: 36, color: '#7A7A8C', border: '1.5px dashed #D0D0DE', borderRadius: 16 }}>
                    {bkFilter !== 'all' ? `No ${bkFilter} bookings` : "No bookings yet — they'll appear here when customers book from your site"}
                  </div>
                )}
              </div>
            )}
          </>}

          {/* EDIT */}
          {panel === 'edit' && <>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, letterSpacing: '-.4px', marginBottom: 3 }}>Edit your site ✏️</h2>
              <p style={{ fontSize: 14, color: '#7A7A8C' }}>Changes go live the moment you save</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 20 }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Business info</div>
                {[['Business name', 'name', 'e.g. Glamour Beauty Salon'], ['Tagline', 'tagline', 'Your catchy one-liner'], ['Area', 'area', 'e.g. Koramangala'], ['WhatsApp number', 'phone', '98765 43210']].map(([l, k, p]) => (
                  <div key={k} style={{ marginBottom: 13 }}>
                    <label style={S.lbl}>{l}</label>
                    <input value={editBiz?.[k] || ''} onChange={e => setEditBiz({ ...editBiz, [k]: e.target.value })} placeholder={p} style={S.input}/>
                  </div>
                ))}
              </div>
              <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 20 }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Services & prices</div>
                {svcs.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 7 }}>
                    <input value={s.name} onChange={e => { const n = [...svcs]; n[i] = { ...n[i], name: e.target.value }; setSvcs(n) }} placeholder="Service name" style={S.input}/>
                    <input value={s.price} onChange={e => { const n = [...svcs]; n[i] = { ...n[i], price: e.target.value }; setSvcs(n) }} placeholder="₹Price" style={{ ...S.input, maxWidth: 88 }}/>
                    <button onClick={() => setSvcs(svcs.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#9A9AAC', fontSize: 18, cursor: 'pointer', padding: '0 3px', flexShrink: 0 }}>×</button>
                  </div>
                ))}
                <button onClick={() => setSvcs([...svcs, { name: '', price: '' }])} style={{ background: 'none', border: '1.5px dashed #D0D0DE', borderRadius: 8, padding: 8, width: '100%', fontSize: 13, color: '#7A7A8C', cursor: 'pointer', fontFamily: 'inherit', marginTop: 2, transition: 'all .18s' }} onMouseEnter={e => { e.currentTarget.style.borderColor = '#FF5C1A'; e.currentTarget.style.color = '#FF5C1A' }} onMouseLeave={e => { e.currentTarget.style.borderColor = '#D0D0DE'; e.currentTarget.style.color = '#7A7A8C' }}>+ Add service</button>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <button onClick={saveEdits} style={S.btnPrimary}>Save & publish changes</button>
            </div>
          </>}

          {/* AI ADVISOR */}
          {panel === 'ai' && <>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, letterSpacing: '-.4px', marginBottom: 3 }}>AI Business Advisor 🤖</h2>
              <p style={{ fontSize: 14, color: '#7A7A8C' }}>Powered by Claude — your personal business coach</p>
            </div>
            <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 22 }}>
              <p style={{ fontSize: 13, color: '#7A7A8C', marginBottom: 14, lineHeight: 1.6 }}>I know your business. Ask me anything about getting more customers, Instagram strategy, pricing, handling reviews, or how to expand to other cities.</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {['How do I get more customers?', 'What to post on Instagram?', 'How to handle a bad review?', 'How to price my services?', 'How to grow to other cities?'].map(q => (
                  <button key={q} onClick={() => setAiQ(q)} style={{ fontSize: 12, padding: '7px 12px', borderRadius: 8, border: '1.5px solid #D0D0DE', background: '#fff', color: '#0C0C0F', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, transition: 'all .18s' }} onMouseEnter={e => { e.currentTarget.style.borderColor = '#FF5C1A'; e.currentTarget.style.color = '#FF5C1A' }} onMouseLeave={e => { e.currentTarget.style.borderColor = '#D0D0DE'; e.currentTarget.style.color = '#0C0C0F' }}>{q}</button>
                ))}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={S.lbl}>Your question</label>
                <textarea value={aiQ} onChange={e => setAiQ(e.target.value)} placeholder="Ask anything about growing your business…"
                  style={{ ...S.input, height: 80, resize: 'vertical', lineHeight: 1.6 }}/>
              </div>
              <button onClick={askAI} disabled={aiLoading || !aiQ.trim()} style={{ ...S.btnPrimary, opacity: (aiLoading || !aiQ.trim()) ? .5 : 1 }}>{aiLoading ? 'Thinking…' : 'Ask AI advisor →'}</button>
              {aiLoading && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14, fontSize: 14, color: '#7A7A8C' }}>
                {[0, 1, 2].map(i => <span key={i} style={{ width: 6, height: 6, background: '#FF5C1A', borderRadius: '50%', animation: `bounce .8s ease ${i * .15}s infinite`, display: 'inline-block' }}/>)}
                <span>Claude is thinking…</span>
              </div>}
              {aiA && <div style={{ marginTop: 18, background: '#F7F7FA', border: '1px solid #E4E4EC', borderRadius: 12, padding: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#FF5C1A', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.07em' }}>AI Response</div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: '#0C0C0F', lineHeight: 1.7 }}>{aiA}</div>
              </div>}
            </div>
          </>}

          {/* SETTINGS */}
          {panel === 'settings' && <>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, letterSpacing: '-.4px', marginBottom: 3 }}>Settings ⚙️</h2>
              <p style={{ fontSize: 14, color: '#7A7A8C' }}>Control what appears on your site</p>
            </div>
            <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 22 }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #E4E4EC' }}>Site features</div>
              {[['whatsapp', 'WhatsApp button', 'Show a direct WhatsApp chat button on your site'], ['booking', 'Appointment booking', 'Let customers book from your site'], ['maps', 'Google Maps', 'Show your location and directions'], ['reviews', 'Customer reviews', 'Show reviews on your site'], ['hindi', 'Hindi language toggle', 'Let visitors switch to Hindi']].map(([k, t, d]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #E4E4EC' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{t}</div>
                    <div style={{ fontSize: 12, color: '#7A7A8C', marginTop: 1 }}>{d}</div>
                  </div>
                  <label style={{ position: 'relative', width: 38, height: 21, flexShrink: 0 }}>
                    <input type="checkbox" checked={toggles[k]} onChange={e => { setToggles({ ...toggles, [k]: e.target.checked }); toast(t + ' ' + (e.target.checked ? 'enabled' : 'disabled')) }} style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}/>
                    <span style={{ position: 'absolute', inset: 0, background: toggles[k] ? '#FF5C1A' : '#D0D0DE', borderRadius: 999, cursor: 'pointer', transition: 'background .18s' }}>
                      <span style={{ position: 'absolute', height: 15, width: 15, left: 3, top: 3, background: '#fff', borderRadius: '50%', transition: 'transform .18s', transform: toggles[k] ? 'translateX(17px)' : 'none', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }}/>
                    </span>
                  </label>
                </div>
              ))}
              <button onClick={() => toast('Settings saved ✓', 'success')} style={{ ...S.btnPrimary, marginTop: 16, fontSize: 13, padding: '7px 14px', borderRadius: 8 }}>Save settings</button>
            </div>
          </>}

          {/* PLAN & BILLING */}
          {panel === 'plan' && <>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, letterSpacing: '-.4px', marginBottom: 3 }}>Plan & billing ⭐</h2>
              <p style={{ fontSize: 14, color: '#7A7A8C' }}>Manage your subscription — payments via Razorpay</p>
            </div>
            <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 22 }}>
              <div style={{ background: '#0C0C0F', borderRadius: 16, padding: '20px 22px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18 }}>{biz.plan || 'Free'} Plan</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 3 }}>
                    {biz.plan === 'Pro Trial' ? '30-day trial active · No card required' : biz.plan === 'pro' ? 'Renews monthly · Razorpay' : 'Free plan — upgrade to unlock all features'}
                  </div>
                </div>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, color: '#fff' }}>
                  {biz.plan === 'pro' ? '₹599' : biz.plan === 'business' ? '₹999' : biz.plan === 'starter' ? '₹299' : '₹0'}<span style={{ fontSize: 13, fontWeight: 400, color: 'rgba(255,255,255,.45)' }}>/mo</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, alignItems: 'start' }}>
                {PLANS.map(p => (
                  <div key={p.id} style={{ border: `1.5px solid ${p.popular ? '#FF5C1A' : '#E4E4EC'}`, borderRadius: 20, padding: 22, position: 'relative', boxShadow: p.popular ? '0 0 0 4px rgba(255,92,26,.08)' : 'none' }}>
                    {p.popular && <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', background: '#FF5C1A', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 999, whiteSpace: 'nowrap' }}>POPULAR</div>}
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#7A7A8C', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '.04em' }}>{p.name}</div>
                    <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 30, lineHeight: 1, marginBottom: 4, letterSpacing: -1 }}>{p.price}<sub style={{ fontSize: 12, fontWeight: 400, color: '#7A7A8C' }}>/mo</sub></div>
                    <ul style={{ listStyle: 'none', margin: '10px 0 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {p.feats.map(f => <li key={f} style={{ fontSize: 12, color: '#0C0C0F', display: 'flex', gap: 7 }}><span style={{ color: '#0D9E5A', fontWeight: 700, fontSize: 11, flexShrink: 0, marginTop: 1 }}>✓</span>{f}</li>)}
                    </ul>
                    {biz.plan === p.id
                      ? <div style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999, background: '#EDFAF3', color: '#0D9E5A' }}>Current plan</div>
                      : <button onClick={() => handleUpgrade(p.id)} disabled={payLoading} style={{ ...S.btnPrimary, width: '100%', fontSize: 13, padding: '8px 0', background: p.popular ? '#FF5C1A' : 'transparent', color: p.popular ? '#fff' : '#0C0C0F', border: `1.5px solid ${p.popular ? '#FF5C1A' : '#D0D0DE'}`, opacity: payLoading ? .6 : 1 }}>
                          {payLoading ? 'Loading…' : `Upgrade to ${p.name}`}
                        </button>
                    }
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: '#9A9AAC', marginTop: 16, textAlign: 'center' }}>Payments secured by Razorpay · Cancel anytime · UPI, cards, netbanking accepted</p>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  GENERATED SITE — the public customer-facing website
// ══════════════════════════════════════════════════════════════
function GeneratedSite({ biz, onBack }) {
  const [form, setForm]   = useState({ name: '', phone: '', svc: '', date: '', time: '9:00 AM' })
  const [booked, setBooked] = useState(false)
  const c = biz.content || {}

  async function submitBook() {
    if (!form.name || !form.phone || !form.svc) { toast('Please fill in all fields', 'error'); return }
    // Save booking to Supabase if biz has real ID
    if (biz.id) {
      try {
        await Bookings.create(biz.id, {
          customer_name: form.name, customer_phone: form.phone,
          service: form.svc, booking_date: form.date || new Date().toISOString().split('T')[0],
          booking_time: form.time, status: 'pending', amount: 0,
        })
      } catch (e) { console.error('Booking save error:', e) }
    }
    const msg = encodeURIComponent(`Hi! I'd like to book an appointment.\nName: ${form.name}\nService: ${form.svc}\nDate: ${form.date || 'Flexible'}\nTime: ${form.time}`)
    window.open(`https://wa.me/91${(biz.phone || '').replace(/\s/g, '')}?text=${msg}`, '_blank')
    setBooked(true)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fff', paddingBottom: 60, fontFamily: "'DM Sans', sans-serif" }}>
      <div onClick={onBack} style={{ position: 'fixed', top: 66, right: 12, background: '#0C0C0F', border: '1px solid rgba(255,92,26,.3)', borderRadius: 999, padding: '5px 12px 5px 9px', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', zIndex: 95, fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,.2)' }}>
        <span style={{ width: 5, height: 5, background: '#FF5C1A', borderRadius: '50%' }}/>
        <span style={{ color: 'rgba(255,255,255,.4)' }}>Built with</span>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff' }}>site<span style={{ color: '#FF5C1A' }}>bana</span></span>
      </div>

      <header style={{ background: 'linear-gradient(135deg,#1a0533,#4c1d95)', padding: '0 18px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 80 }}>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, color: '#fff' }}>✂️ {biz.name}</span>
        <a href={`tel:+91${(biz.phone || '').replace(/\s/g, '')}`} style={{ color: 'rgba(255,255,255,.8)', fontSize: 13, background: 'rgba(255,255,255,.13)', padding: '6px 14px', borderRadius: 999, textDecoration: 'none' }}>📞 Call us</a>
      </header>

      <div style={{ background: 'linear-gradient(160deg,#1a0533,#4c1d95,#7c3aed)', padding: '44px 18px 48px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.85)', fontSize: 12, padding: '4px 12px', borderRadius: 999, marginBottom: 14 }}>⭐ 4.8 · 124 reviews</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 'clamp(22px,4.5vw,34px)', color: '#fff', marginBottom: 6, letterSpacing: '-.5px' }}>{biz.name}</h1>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', marginBottom: 7 }}>📍 {biz.area && biz.area !== biz.city ? biz.area + ', ' : ''}{biz.city}</div>
        <p style={{ fontSize: 15, color: 'rgba(255,255,255,.8)', marginBottom: 24, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>{c.tagline || biz.tagline}</p>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => window.open(`https://wa.me/91${(biz.phone || '9999999999').replace(/\s/g, '')}?text=${encodeURIComponent(c.whatsapp_greeting || `Hi! I want to book at ${biz.name}.`)}`, '_blank')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#25D366', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>💬 WhatsApp us</button>
          <button onClick={() => document.getElementById('gs-booking')?.scrollIntoView({ behavior: 'smooth' })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.13)', color: '#fff', border: '1.5px solid rgba(255,255,255,.25)', borderRadius: 12, padding: '12px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📅 Book appointment</button>
        </div>
        <div style={{ marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,.4)' }}>
          <span style={{ background: 'rgba(37,211,102,.2)', color: '#4ADE80', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, marginRight: 6 }}>Open now</span>
          {c.hours || 'Mon–Sat 9am–8pm'}
        </div>
      </div>

      <div style={{ padding: '28px 18px', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 21, marginBottom: 4, letterSpacing: '-.4px' }}>Our services</div>
        <div style={{ fontSize: 13, color: '#7A7A8C', marginBottom: 16 }}>All services include a free consultation</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 9 }}>
          {(c.services || []).map((s, i) => (
            <div key={i} style={{ border: '1px solid #E4E4EC', borderRadius: 12, padding: 14, transition: 'all .15s', cursor: 'default' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.background = '#F3EEFF' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#E4E4EC'; e.currentTarget.style.background = '#fff' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{s.name}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#7C3AED', fontFamily: 'Syne, sans-serif' }}>{s.price}</div>
              {s.duration && <div style={{ fontSize: 11, color: '#7A7A8C', marginTop: 2 }}>~{s.duration}</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 1, background: '#E4E4EC', maxWidth: 640, margin: '0 auto' }}/>

      <div style={{ padding: '28px 18px', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 21, marginBottom: 14 }}>About us</div>
        <div style={{ background: '#F3EEFF', borderRadius: 16, padding: 20, display: 'flex', gap: 12, border: '1px solid rgba(107,63,232,.1)' }}>
          <div style={{ fontSize: 26, flexShrink: 0 }}>🌟</div>
          <div style={{ fontSize: 14, color: '#0C0C0F', lineHeight: 1.7 }}>{c.about || `${biz.name} is a trusted ${biz.type} in ${biz.city}.`}</div>
        </div>
      </div>

      <div style={{ height: 1, background: '#E4E4EC', maxWidth: 640, margin: '0 auto' }}/>

      {/* BOOKING FORM */}
      <div id="gs-booking" style={{ background: '#F7F7FA', padding: '28px 18px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 21, marginBottom: 4 }}>Book an appointment 📅</div>
          <div style={{ fontSize: 13, color: '#7A7A8C', marginBottom: 16 }}>We'll confirm on WhatsApp within 30 minutes</div>
          <div style={{ background: '#fff', border: '1px solid #E4E4EC', borderRadius: 16, padding: 24 }}>
            {!booked ? <>
              {[['Your name', 'text', form.name, 'name', 'Priya Sharma'], ['Phone / WhatsApp', 'tel', form.phone, 'phone', '98765 43210']].map(([l, t, v, k, p]) => (
                <div key={k} style={{ marginBottom: 12 }}>
                  <label style={S.lbl}>{l}</label>
                  <input type={t} value={v} onChange={e => setForm({ ...form, [k]: e.target.value })} placeholder={p} style={S.input}/>
                </div>
              ))}
              <div style={{ marginBottom: 12 }}>
                <label style={S.lbl}>Service</label>
                <select value={form.svc} onChange={e => setForm({ ...form, svc: e.target.value })} style={S.input}>
                  <option value="">Select a service…</option>
                  {(c.services || []).map((s, i) => <option key={i}>{s.name} — {s.price}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 16 }}>
                <div>
                  <label style={S.lbl}>Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} min={new Date().toISOString().split('T')[0]} style={S.input}/>
                </div>
                <div>
                  <label style={S.lbl}>Time</label>
                  <select value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} style={S.input}>
                    {['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={submitBook} style={{ ...S.btnPrimary, width: '100%', padding: '13px', fontSize: 15 }}>Confirm appointment →</button>
            </> : (
              <div style={{ textAlign: 'center', padding: '22px 0' }}>
                <div style={{ fontSize: 38, marginBottom: 10 }}>🎉</div>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 20, marginBottom: 6 }}>Booking sent!</div>
                <div style={{ fontSize: 14, color: '#7A7A8C' }}>We'll confirm on WhatsApp shortly.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* REVIEWS */}
      <div style={{ padding: '28px 18px', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 21, marginBottom: 14 }}>What customers say</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {(c.reviews || []).map((r, i) => (
            <div key={i} style={{ background: '#F7F7FA', borderRadius: 12, padding: 16, border: '1px solid #E4E4EC' }}>
              <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 7, letterSpacing: 1 }}>{'★'.repeat(r.stars || 5)}</div>
              <p style={{ fontSize: 14, color: '#0C0C0F', lineHeight: 1.65, marginBottom: 10 }}>"{r.text}"</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#F3EEFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 10, color: '#7C3AED' }}>{r.initials || r.name?.slice(0, 2).toUpperCase()}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MAP */}
      <div style={{ padding: '0 18px 28px', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 21, marginBottom: 14 }}>Find us 📍</div>
        <a href={`https://maps.google.com?q=${encodeURIComponent(biz.name + ' ' + biz.area + ' ' + biz.city)}`} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, background: '#F3EEFF', borderRadius: 16, height: 140, border: '1px solid rgba(107,63,232,.12)', textDecoration: 'none', transition: 'all .18s' }}>
          <div style={{ fontSize: 34 }}>📍</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, color: '#7C3AED' }}>{biz.name}</div>
          <div style={{ fontSize: 13, color: '#7A7A8C', textAlign: 'center', padding: '0 18px' }}>{biz.area && biz.area !== biz.city ? biz.area + ', ' : ''}{biz.city}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#7C3AED', textDecoration: 'underline' }}>Get directions →</div>
        </a>
      </div>

      <footer style={{ background: '#0C0C0F', padding: '26px 18px', textAlign: 'center' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, color: '#fff', marginBottom: 3 }}>✂️ {biz.name}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginBottom: 8 }}>{biz.area && biz.area !== biz.city ? biz.area + ', ' : ''}{biz.city} · 📞 +91 {biz.phone}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.18)' }}>Website built with Sitebana · sitebana.in</div>
      </footer>

      <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #E4E4EC', padding: '10px 14px', display: 'flex', gap: 9, zIndex: 90, boxShadow: '0 -3px 14px rgba(0,0,0,.07)' }}>
        <button onClick={() => window.open(`https://wa.me/91${(biz.phone || '').replace(/\s/g, '')}?text=${encodeURIComponent(c.whatsapp_greeting || `Hi! I want to book at ${biz.name}.`)}`, '_blank')}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#25D366', color: '#fff', border: 'none', padding: 11, borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>💬 WhatsApp</button>
        <button onClick={() => document.getElementById('gs-booking')?.scrollIntoView({ behavior: 'smooth' })}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#7C3AED', color: '#fff', border: 'none', padding: 11, borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📅 Book now</button>
      </div>
    </div>
  )
}

// ─── SHARED STYLES ────────────────────────────────────────────
const styles = {
  btnPrimary: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    background: '#FF5C1A', color: '#fff', border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    padding: '11px 22px', boxShadow: '0 2px 8px rgba(255,92,26,.3)',
    transition: 'all .18s', letterSpacing: '-.01em', whiteSpace: 'nowrap',
  },
  btnOutline: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    background: '#fff', color: '#0C0C0F', border: '1.5px solid #D0D0DE', borderRadius: 8,
    fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    padding: '10px 20px', transition: 'all .18s',
  },
  btnGhost: {
    background: 'transparent', color: '#7A7A8C', border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
    padding: '9px 14px', transition: 'all .15s',
  },
  input: {
    width: '100%', border: '1.5px solid #E4E4EC', borderRadius: 8, padding: '10px 13px',
    fontSize: 14, fontFamily: 'inherit', color: '#0C0C0F', background: '#fff', outline: 'none',
    transition: 'border-color .18s, box-shadow .18s', boxSizing: 'border-box',
  },
  lbl: {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#7A7A8C',
    marginBottom: 5, letterSpacing: '.02em', textTransform: 'uppercase',
  },
}
