// netlify/functions/checkout.js
// Handles POST requests to create a Stripe Checkout session
// Environment variable required in Netlify dashboard:
//   STRIPE_SECRET_KEY = rk_live_...

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICE_MAP = {
  'Roots Hoodie':                   { price: 18000, name: 'Roots Hoodie' },
  'Polly Three-Quarter Sleeve Tee': { price: 4000,  name: 'Polly Three-Quarter Sleeve Tee' },
  'PICKLE Crew Sweatshirt':         { price: 8000,  name: 'PICKLE Crew Sweatshirt' },
  'PICKLE Hoodie Sweatshirt':       { price: 8000,  name: 'PICKLE Hoodie Sweatshirt' },
};

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const { items } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty.' }) };
  }

  const line_items = [];

  for (const item of items) {
    const product = PRICE_MAP[item.name];
    if (!product) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Product not found: ${item.name}` })
      };
    }
    line_items.push({
      price_data: {
        currency: 'usd',
        unit_amount: product.price,
        product_data: {
          name: `${product.name} (Size: ${item.size})`,
        },
      },
      quantity: item.qty,
    });
  }

  const origin = event.headers.origin || 'https://thekitchendink.org';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      shipping_address_collection: {
        allowed_countries: ['US', 'CA'],
      },
      payment_intent_data: {
        statement_descriptor_suffix: 'KITCHEN DINK',
      },
      success_url: `${origin}/thankyou.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/index.html#merch`,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not start checkout. Please try again.' }),
    };
  }
};
