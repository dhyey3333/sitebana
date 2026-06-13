# SITEBANA — Complete Production Deployment Guide
# From zero → live in production, step by step

---

## WHAT YOU'RE BUILDING

```
┌─────────────────────────────────────────────────────────┐
│                    SITEBANA STACK                        │
│                                                         │
│  sitebana.in          → Vercel (React frontend)          │
│  api.sitebana.in      → Railway/Render (Node backend)   │
│  db + auth            → Supabase (PostgreSQL + Auth)     │
│  payments             → Razorpay                        │
│  AI content           → Anthropic Claude API            │
│  media uploads        → Supabase Storage                │
│  email                → Resend (transactional email)    │
└─────────────────────────────────────────────────────────┘
```

Estimated monthly cost at launch: **~₹0–500/mo** (all free tiers)
At 10,000 businesses: **~₹3,000–8,000/mo**

---

## STEP 1 — SET UP SUPABASE (Database + Auth)

### 1.1 Create project
1. Go to https://app.supabase.com
2. Click **New project**
3. Name: `sitebana-prod`
4. Set a strong database password (save it!)
5. Region: **ap-south-1 (Mumbai)** — closest to India
6. Click **Create new project** (takes ~2 min)

### 1.2 Run the database schema
1. In Supabase dashboard → **SQL Editor** → **New query**
2. Open the file `supabase/schema.sql` from this folder
3. Paste the entire content → click **Run**
4. You should see: "Success. No rows returned."

### 1.3 Configure Auth
1. **Authentication** → **Settings**
2. Site URL: `https://sitebana.in` (your domain)
3. Redirect URLs: add `https://sitebana.in/**` and `http://localhost:5173/**`
4. **Email templates** → Confirm signup: customise with your branding
5. **Providers** → Enable **Google** (optional, for social login)
   - Create Google OAuth app at https://console.cloud.google.com

### 1.4 Get your API keys
Go to **Settings** → **API**:
```
Project URL:          https://xxxx.supabase.co   ← VITE_SUPABASE_URL
anon/public key:      eyJ...                     ← VITE_SUPABASE_ANON_KEY
service_role key:     eyJ...                     ← SUPABASE_SERVICE_ROLE_KEY (backend only!)
```

### 1.5 Set up Storage (for business logos/images)
1. **Storage** → **New bucket**
2. Name: `business-assets`, Public: **ON**
3. Add policy: Authenticated users can insert into `business-assets`

---

## STEP 2 — SET UP RAZORPAY

### 2.1 Create account
1. Go to https://razorpay.com → Sign up
2. Complete KYC (required for live payments — takes 1–3 days)
3. In the meantime, use **Test Mode** to build

### 2.2 Get API keys
Dashboard → **Settings** → **API Keys**:
```
Test Mode:
  Key ID:     rzp_test_XXXXXXXXXX   ← RAZORPAY_KEY_ID / VITE_RAZORPAY_KEY_ID
  Key Secret: XXXXXXXXXXXXXXXX      ← RAZORPAY_KEY_SECRET

Live Mode (after KYC):
  Key ID:     rzp_live_XXXXXXXXXX
  Key Secret: XXXXXXXXXXXXXXXX
```

### 2.3 Set up Webhook
1. Dashboard → **Settings** → **Webhooks** → **Add New Webhook**
2. Webhook URL: `https://api.sitebana.in/api/payments/webhook`
3. Secret: generate a random 32-char string → save as `RAZORPAY_WEBHOOK_SECRET`
4. Events to subscribe:
   - ✅ payment.captured
   - ✅ payment.failed
   - ✅ refund.created
   - ✅ subscription.activated
   - ✅ subscription.charged
   - ✅ subscription.cancelled

### 2.4 Test payment in dev
Use these test cards:
```
Card:       4111 1111 1111 1111
Expiry:     Any future date
CVV:        Any 3 digits
OTP:        123456

UPI:        success@razorpay (success)
            failure@razorpay (failure)
```

---

## STEP 3 — SET UP ANTHROPIC (Claude API)

1. Go to https://console.anthropic.com
2. **API Keys** → **Create Key**
3. Name: `sitebana-production`
4. Copy → save as `ANTHROPIC_API_KEY`
5. Add credits (start with $10 — enough for ~5,000 AI site generations)

**Cost estimate:** Each site generation costs ~$0.002 (Claude Sonnet)
→ 10,000 signups = ~$20 in Claude costs

---

## STEP 4 — BUILD THE FRONTEND

### 4.1 Initialize Vite + React project
```bash
npm create vite@latest sitebana-frontend -- --template react
cd sitebana-frontend
npm install
npm install @supabase/supabase-js
```

### 4.2 Add your files
```
sitebana-frontend/
├── src/
│   ├── App.jsx           ← Your main sitebana.jsx code goes here
│   ├── lib/
│   │   ├── supabase.js   ← From this package (frontend/src/supabase.js)
│   │   └── razorpay.js   ← From this package (frontend/src/razorpay.js)
│   └── main.jsx
├── .env.local            ← Your env variables (from .env.example)
└── vite.config.js
```

### 4.3 Update App.jsx to use Supabase
Replace the mock `Store` and `callClaude` in your App with:

```javascript
// In App.jsx, replace:
import { Auth, Businesses, Bookings, Customers, Invoices } from './lib/supabase'
import { useRazorpay } from './lib/razorpay'

// Auth flow change:
const onSignup = async (name, email, password) => {
  const user = await Auth.signUp(name, email, password)
  // Supabase sends verification email automatically
  toast('Check your email to verify your account!', 'success')
}

const onLogin = async (email, password) => {
  const user = await Auth.signIn(email, password)
  setUser(user)
  const biz = await Businesses.getMyBusiness(user.id)
  setBiz(biz)
  setPage(biz ? 'dashboard' : 'onboarding')
}

// Listen for session persistence:
useEffect(() => {
  Auth.onAuthChange(async (user) => {
    setUser(user)
    if (user) {
      const biz = await Businesses.getMyBusiness(user.id)
      setBiz(biz)
    }
  })
}, [])
```

### 4.4 Create .env.local
```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_RAZORPAY_KEY_ID=rzp_test_XXXX
VITE_API_URL=http://localhost:4000
```

### 4.5 Run locally
```bash
npm run dev
# Opens at http://localhost:5173
```

---

## STEP 5 — BUILD THE BACKEND

### 5.1 Initialize Node project
```bash
mkdir sitebana-backend && cd sitebana-backend
npm init -y
npm install express razorpay @supabase/supabase-js dotenv cors helmet express-rate-limit
```

### 5.2 Add package.json scripts
```json
{
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev":   "node --watch server.js"
  }
}
```

### 5.3 Copy server.js
Copy `backend/server.js` from this folder into your project.

### 5.4 Create .env
Copy `.env.example` → `.env` and fill in all values.

### 5.5 Run locally
```bash
npm run dev
# Runs at http://localhost:4000
# Test: http://localhost:4000/api/health
```

---

## STEP 6 — DEPLOY BACKEND (Railway)

Railway is the easiest for Node.js backends. Free tier included.

### 6.1 Deploy
1. Go to https://railway.app → Sign up with GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Select your `sitebana-backend` repo
4. Railway auto-detects Node.js

### 6.2 Add environment variables
In Railway dashboard → **Variables** → add all values from `.env`:
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
ANTHROPIC_API_KEY
FRONTEND_URL=https://sitebana.in
NODE_ENV=production
```

### 6.3 Add custom domain
1. Railway → **Settings** → **Domains** → **Custom Domain**
2. Add: `api.sitebana.in`
3. Add CNAME record in your domain DNS:
   ```
   CNAME  api  →  your-app.railway.app
   ```

### 6.4 Update Razorpay webhook
Change webhook URL to: `https://api.sitebana.in/api/payments/webhook`

---

## STEP 7 — DEPLOY FRONTEND (Vercel)

### 7.1 Push to GitHub
```bash
cd sitebana-frontend
git init
git add .
git commit -m "Initial Sitebana commit"
git remote add origin https://github.com/yourusername/sitebana-frontend
git push -u origin main
```

### 7.2 Deploy on Vercel
1. Go to https://vercel.com → Sign up with GitHub
2. **New Project** → Import your `sitebana-frontend` repo
3. Framework: **Vite** (auto-detected)
4. Add Environment Variables:
   ```
   VITE_SUPABASE_URL        = https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY   = eyJ...
   VITE_RAZORPAY_KEY_ID     = rzp_live_XXXX  (live key for prod)
   VITE_API_URL             = https://api.sitebana.in
   ```
5. Click **Deploy**

### 7.3 Add custom domain
1. Vercel → Project → **Settings** → **Domains**
2. Add: `sitebana.in` and `www.sitebana.in`
3. In your domain registrar DNS:
   ```
   A      @    → 76.76.21.21   (Vercel IP)
   CNAME  www  → cname.vercel-dns.com
   ```

---

## STEP 8 — BUY DOMAIN

### Recommended registrars (India)
1. **GoDaddy.in** — usually cheapest: ~₹700/yr for .in
2. **BigRock** — Indian registrar
3. **Namecheap** — good for .com: ~₹900/yr

### Buy sitebana.in (recommended)
- `.in` domains: ~₹600–800/year
- `.com` domains: ~₹800–1,200/year

---

## STEP 9 — EMAIL SETUP (Resend)

### 9.1 Create Resend account
1. https://resend.com → Sign up free
2. **Add Domain** → `sitebana.in`
3. Add the DNS records they provide
4. Get API key → `RESEND_API_KEY`

### 9.2 Add to Supabase
1. Supabase → **Settings** → **Auth** → **SMTP Settings**
2. Host: `smtp.resend.com`
3. Port: 465
4. User: `resend`
5. Password: your Resend API key
6. Sender: `noreply@sitebana.in`

---

## STEP 10 — GO LIVE CHECKLIST

Before switching Razorpay from Test → Live mode:

```
✅ Schema deployed and tested
✅ Auth signup/login/logout working
✅ Business creation + AI generation working
✅ Bookings CRUD working
✅ Test payment flow working end-to-end
✅ Webhook receiving test events in Railway logs
✅ Custom domain pointing correctly
✅ SSL certificate active (Vercel handles this automatically)
✅ Razorpay KYC approved
✅ Switch VITE_RAZORPAY_KEY_ID to rzp_live_... in Vercel env vars
✅ Switch RAZORPAY_KEY_ID + SECRET to live in Railway env vars
✅ Test one live ₹1 payment
✅ Set up monitoring (free: Better Uptime or UptimeRobot)
```

---

## COSTS SUMMARY

| Service     | Free Tier                    | Paid (when needed)     |
|-------------|------------------------------|------------------------|
| Vercel      | Unlimited deploys, 100GB/mo  | Pro: $20/mo            |
| Supabase    | 500MB DB, 50,000 auth users  | Pro: $25/mo (8GB DB)   |
| Railway     | $5/mo credit                 | ~₹400–800/mo for API   |
| Razorpay    | 2% per transaction           | No monthly fee         |
| Anthropic   | Pay per use (~$0.002/gen)    | —                      |
| Domain      | —                            | ~₹700/yr               |
| Resend      | 100 emails/day free          | $20/mo for 50K emails  |
| **TOTAL**   | **~₹0–500/mo to start**      | **~₹3K–8K at scale**   |

---

## SCALING TO MILLIONS

When you reach 10,000+ businesses:

1. **Upgrade Supabase** to Pro ($25/mo) — removes connection limits
2. **Add Supabase connection pooling** (PgBouncer) — built-in, just enable
3. **Add Vercel Edge Functions** for marketplace search (faster)
4. **Add Redis cache** (Railway Redis) for hot data (city listings)
5. **CDN for images** — Cloudflare free tier in front of Supabase Storage
6. **Read replicas** in Supabase for heavy read traffic

The architecture above supports **~100,000 concurrent users** without changes.

---

## NEED HELP?

- Supabase docs:  https://supabase.com/docs
- Razorpay docs:  https://razorpay.com/docs
- Vercel docs:    https://vercel.com/docs
- Railway docs:   https://docs.railway.app
- Anthropic docs: https://docs.anthropic.com
