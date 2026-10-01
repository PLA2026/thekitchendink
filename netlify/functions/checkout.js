// netlify/functions/checkout.js
// Handles POST requests to create a Stripe Checkout session
// Also manages inventory via inventory.json in the repo
// Environment variables required in Netlify dashboard:
//   STRIPE_SECRET_KEY = rk_live_...
//   GITHUB_TOKEN = ghp_... (GitHub personal access token with repo write access)
//   GITHUB_REPO = PLA2026/thekitchendink

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CATALOG = {
  'Roots Hoodie':                   { price: 18000, sizes: ['S','M','L','XL'] },
  'Polly Three-Quarter Sleeve Tee': { price: 4000,  sizes: ['S','M','L','XL'] },
  'PICKLE Crew Sweatshirt':         { price: 8000,  sizes: ['S','M','L','XL'] },
  'PICKLE Hoodie Sweatshirt':       { price: 8000,  sizes: ['S','M','L','XL'] },
};

const GITHUB_REPO = process.env.GITHUB_REPO || 'PLA2026/thekitchendink';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const INVENTORY_PATH = 'inventory.json';

async function getInventory() {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${INVENTORY_PATH}`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
  );
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { inventory: JSON.parse(content), sha: data.sha };
}

async function saveInventory(inventory, sha) {
  const content = Buffer.from(JSON.stringify(inventory, null, 2)).toString('base64');
  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${INVENTORY_PATH}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Update inventory after purchase',
        content,
        sha,
      }),
    }
  );
}

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

  // Validate all items against catalog
  for (const item of items) {
    const product = CATALOG[item.name];
    if (!product) {
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown product: ${item.name}` }) };
    }
    if (!product.sizes.includes(item.size)) {
      return { statusCode: 400, body: JSON.stringify({ error: `Invalid size ${item.size} for ${item.name}` }) };
    }
  }

  // Check inventory
  let inventory, sha;
  try {
    ({ inventory, sha } = await getInventory());
  } catch (err) {
    console.error('Failed to read inventory:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not check inventory. Please try again.' }) };
  }

  for (const item of items) {
    const stock = inventory[item.name]?.[item.size] ?? 0;
    if (stock < item.qty) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Sorry, ${item.name} in size ${item.size} is sold out!` })
      };
    }
  }

  // Build Stripe line items
  const line_items = items.map(item => ({
    price_data: {
      currency: 'usd',
      unit_amount: CATALOG[item.name].price,
      product_data: {
        name: `${item.name} (Size: ${item.size})`,
      },
    },
    quantity: item.qty,
  }));

  const origin = event.headers.origin || 'https://thekitchendink.netlify.app';

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      shipping_address_collection: { allowed_countries: ['US', 'CA'] },
      payment_intent_data: { statement_descriptor_suffix: 'KITCHEN DINK' },
      success_url: `${origin}/thankyou.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/index.html#merch`,
    });
  } catch (err) {
    console.error('Stripe error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not start checkout. Please try again.' }) };
  }

  // Decrement inventory
  try {
    for (const item of items) {
      inventory[item.name][item.size] -= item.qty;
    }
    await saveInventory(inventory, sha);
  } catch (err) {
    console.error('Failed to update inventory:', err);
    // Don't block the checkout — inventory update failure is non-fatal
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  };
};
