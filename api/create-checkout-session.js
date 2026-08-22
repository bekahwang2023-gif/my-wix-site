const Stripe = require('stripe');
const menuData = require('../menu-data.json');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PICKUP_SLOTS = [
  '12:00 PM - 1:00 PM',
  '5:30 PM - 6:30 PM',
];

const MIN_ORDER_CENTS = 5000; // $50.00
const MIN_LEAD_DAYS = 3;
const MA_TAX_RATE = 0.0625; // Massachusetts meals/sales tax

function isValidPickupDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + MIN_LEAD_DAYS);
  const picked = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(picked.getTime())) return false;
  return picked.getTime() >= minDate.getTime();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const { items, pickupDate, pickupSlot, name, email, phone } = body;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Your cart is empty.' });
    return;
  }
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Name is required.' });
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    res.status(400).json({ error: 'A valid email is required.' });
    return;
  }
  if (!phone || !String(phone).trim()) {
    res.status(400).json({ error: 'Phone number is required.' });
    return;
  }
  if (!PICKUP_SLOTS.includes(pickupSlot)) {
    res.status(400).json({ error: 'Please select a valid pickup time window.' });
    return;
  }
  if (!isValidPickupDate(pickupDate)) {
    res.status(400).json({
      error: `Pickup date must be at least ${MIN_LEAD_DAYS} days from today.`,
    });
    return;
  }

  const menuById = new Map(menuData.map((item) => [item.id, item]));
  let subtotalCents = 0;
  const orderSummaryParts = [];

  for (const cartItem of items) {
    const menuItem = cartItem && menuById.get(cartItem.id);
    const qty = cartItem && Number(cartItem.qty);
    if (!menuItem || !Number.isInteger(qty) || qty <= 0) {
      res.status(400).json({ error: 'Your cart contains an invalid item.' });
      return;
    }
    subtotalCents += menuItem.priceCents * qty;
    orderSummaryParts.push(`${menuItem.name} x${qty}`);
  }

  if (subtotalCents < MIN_ORDER_CENTS) {
    res.status(400).json({ error: 'Order minimum is $50.00 before checkout.' });
    return;
  }

  const taxCents = Math.round(subtotalCents * MA_TAX_RATE);

  let orderSummary = orderSummaryParts.join(', ');
  if (orderSummary.length > 480) {
    orderSummary = `${orderSummary.slice(0, 477)}...`;
  }

  const lineItems = [
    {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: subtotalCents,
        product_data: { name: 'Food Subtotal / 菜品总价' },
      },
    },
    {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: taxCents,
        product_data: { name: 'MA Sales Tax (6.25%) / 州消费税' },
      },
    },
  ];

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: email,
      metadata: {
        pickupDate,
        pickupSlot,
        customerName: name,
        customerPhone: phone,
        orderItems: orderSummary,
      },
      success_url: `${origin}/order-success.html`,
      cancel_url: `${origin}/order.html?canceled=true`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout session error:', err);
    res.status(500).json({
      error: 'Something went wrong creating your checkout session. Please try again.',
    });
  }
};
