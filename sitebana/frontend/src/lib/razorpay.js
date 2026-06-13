// ============================================================
//  SITEBANA — Razorpay Payment Integration (Frontend)
//  File: frontend/src/lib/razorpay.js
//
//  Usage:
//    const { openCheckout } = useRazorpay()
//    await openCheckout({ amount: 599, invoiceId: 'uuid', businessName: 'My Salon' })
// ============================================================

/**
 * Loads the Razorpay checkout script dynamically.
 * Call once at app boot or lazily before checkout.
 */
export function loadRazorpayScript() {
  return new Promise(resolve => {
    if (window.Razorpay) return resolve(true)
    const script    = document.createElement('script')
    script.src      = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload   = () => resolve(true)
    script.onerror  = () => resolve(false)
    document.body.appendChild(script)
  })
}

/**
 * Full payment flow:
 *  1. Call your backend to create a Razorpay order
 *  2. Open Razorpay checkout modal
 *  3. On success, verify signature with your backend
 *  4. Return verified payment result
 *
 * @param {object} params
 * @param {number}  params.amount         - Amount in INR (e.g. 599)
 * @param {string}  params.invoiceId      - Your invoice UUID (optional)
 * @param {string}  params.businessId     - Your business UUID
 * @param {string}  params.businessName   - Shown in Razorpay modal
 * @param {string}  params.customerName   - Pre-fills name in modal
 * @param {string}  params.customerEmail  - Pre-fills email
 * @param {string}  params.customerPhone  - Pre-fills phone
 * @param {string}  params.description    - Payment description
 * @param {string}  params.authToken      - Supabase JWT for your backend
 * @param {string}  params.apiBase        - Your backend URL
 */
export async function initiatePayment({
  amount,
  invoiceId,
  businessId,
  businessName,
  customerName  = '',
  customerEmail = '',
  customerPhone = '',
  description   = 'Payment',
  authToken,
  apiBase       = import.meta.env.VITE_API_URL || 'http://localhost:4000',
}) {
  // 1. Load Razorpay script
  const loaded = await loadRazorpayScript()
  if (!loaded) throw new Error('Failed to load Razorpay. Check your internet connection.')

  // 2. Create order on your backend
  const orderRes = await fetch(`${apiBase}/api/payments/create-order`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body:    JSON.stringify({ invoice_id: invoiceId, business_id: businessId, amount }),
  })
  if (!orderRes.ok) {
    const err = await orderRes.json()
    throw new Error(err.error || 'Failed to create payment order')
  }
  const { order_id, key_id } = await orderRes.json()

  // 3. Open Razorpay checkout
  return new Promise((resolve, reject) => {
    const options = {
      key:         key_id || import.meta.env.VITE_RAZORPAY_KEY_ID,
      amount:      amount * 100,    // paise
      currency:    'INR',
      name:        'Sitebana',
      description: `${businessName} — ${description}`,
      order_id,
      prefill: {
        name:    customerName,
        email:   customerEmail,
        contact: customerPhone,
      },
      notes: {
        business_name: businessName,
        invoice_id:    invoiceId || '',
      },
      theme: { color: '#FF6B00' },
      modal: {
        ondismiss: () => reject(new Error('Payment cancelled by user')),
      },
      handler: async function(response) {
        try {
          // 4. Verify signature on backend
          const verifyRes = await fetch(`${apiBase}/api/payments/verify`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body:    JSON.stringify({
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
              invoice_id:          invoiceId,
            }),
          })
          if (!verifyRes.ok) {
            const err = await verifyRes.json()
            throw new Error(err.error || 'Payment verification failed')
          }
          const result = await verifyRes.json()
          resolve({ ...result, order_id, payment_id: response.razorpay_payment_id })
        } catch (err) {
          reject(err)
        }
      },
    }

    const rzp = new window.Razorpay(options)
    rzp.on('payment.failed', event => reject(new Error(event.error.description)))
    rzp.open()
  })
}

/**
 * Platform subscription checkout
 * @param {object} params
 * @param {string} params.plan           - 'starter' | 'pro' | 'business'
 * @param {string} params.billingCycle   - 'monthly' | 'yearly'
 * @param {string} params.authToken      - Supabase JWT
 */
export async function initiateSubscription({
  plan,
  billingCycle = 'monthly',
  customerName,
  customerEmail,
  customerPhone,
  authToken,
  apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000',
}) {
  const loaded = await loadRazorpayScript()
  if (!loaded) throw new Error('Failed to load Razorpay.')

  const subRes = await fetch(`${apiBase}/api/subscriptions/create`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body:    JSON.stringify({ plan, billing_cycle: billingCycle }),
  })
  if (!subRes.ok) throw new Error('Failed to create subscription')
  const { subscription_id, key_id } = await subRes.json()

  const PLAN_NAMES = { starter: 'Starter ₹299/mo', pro: 'Pro ₹599/mo', business: 'Business ₹999/mo' }

  return new Promise((resolve, reject) => {
    const options = {
      key:             key_id || import.meta.env.VITE_RAZORPAY_KEY_ID,
      subscription_id,
      name:            'Sitebana',
      description:     PLAN_NAMES[plan],
      prefill: {
        name:    customerName,
        email:   customerEmail,
        contact: customerPhone,
      },
      theme:  { color: '#FF6B00' },
      modal:  { ondismiss: () => reject(new Error('Subscription cancelled')) },
      handler: response => resolve(response),
    }
    const rzp = new window.Razorpay(options)
    rzp.on('payment.failed', e => reject(new Error(e.error.description)))
    rzp.open()
  })
}

/**
 * React hook for easy use in components
 *
 * Example:
 *   const { pay, loading, error } = useRazorpay()
 *   await pay({ amount: 599, invoiceId, businessName: 'My Salon' })
 */
export function useRazorpay(authToken, apiBase) {
  const [loading, setLoading] = React.useState(false)
  const [error,   setError]   = React.useState(null)

  const pay = React.useCallback(async (params) => {
    setLoading(true)
    setError(null)
    try {
      const result = await initiatePayment({ ...params, authToken, apiBase })
      setLoading(false)
      return result
    } catch (err) {
      setError(err.message)
      setLoading(false)
      throw err
    }
  }, [authToken, apiBase])

  const subscribe = React.useCallback(async (params) => {
    setLoading(true)
    setError(null)
    try {
      const result = await initiateSubscription({ ...params, authToken, apiBase })
      setLoading(false)
      return result
    } catch (err) {
      setError(err.message)
      setLoading(false)
      throw err
    }
  }, [authToken, apiBase])

  return { pay, subscribe, loading, error }
}
