export async function onRequestPost(context) {
  const { request, env } = context;

  const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;

  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Stripe key not configured.' }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const PRICE_MAP = {
    'Roots Hoodie':                    'price_1ULPIfK3JYl815aClbp6dio7',
    'Polly Three-Quarter Sleeve Tee':  'price_1ULPPdK3JYl815aC6yhODAgn',
    'PICKLE Crew Sweatshirt':          'price_1ULPxyK3JYl815aCMBgCC2SX',
    'PICKLE Hoodie Sweatshirt':        'price_1ULQ0TK3JYl815aCo752Jte3',
  };

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { items } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return new Response(JSON.stringify({ error: 'Cart is empty.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const line_items = [];
  for (const item of items) {
    const priceId = PRICE_MAP[item.name];
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: `Price ID not configured for: ${item.name}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    line_items.push({ price: priceId, quantity: item.qty });
  }

  const sizeMetadata = {};
  items.forEach((item, i) => {
    sizeMetadata[`item_${i + 1}`] = `${item.name} — Size: ${item.size} — Qty: ${item.qty}`;
  });

  const origin = new URL(request.url).origin;

  const sessionPayload = {
    mode: 'payment',
    line_items,
    shipping_address_collection: { allowed_countries: ['US', 'CA'] },
    payment_intent_data: {
      metadata: sizeMetadata,
      statement_descriptor_suffix: 'KITCHEN DINK',
    },
    success_url: `${origin}/thankyou.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/index.html#merch`,
  };

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeStripeBody(sessionPayload),
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok || !session.url) {
    return new Response(
      JSON.stringify({ error: session.error?.message || 'Stripe error.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function encodeStripeBody(obj, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(encodeStripeBody(value, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object') {
          parts.push(encodeStripeBody(item, `${fullKey}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}
