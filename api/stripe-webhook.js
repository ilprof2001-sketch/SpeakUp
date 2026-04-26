import Stripe from 'stripe';
import { createClerkClient } from '@clerk/backend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed' || 
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated') {
    
    const session = event.data.object;
    const customerEmail = session.customer_email || session.customer_details?.email;

    if (customerEmail) {
      try {
        const users = await clerk.users.getUserList({ emailAddress: [customerEmail] });
        if (users.data.length > 0) {
          const user = users.data[0];
          await clerk.users.updateUserMetadata(user.id, {
            publicMetadata: { premium: true }
          });
          console.log('Premium unlocked for:', customerEmail);
        }
      } catch (err) {
        console.error('Error updating user metadata:', err);
        return res.status(500).json({ error: 'Failed to update user' });
      }
    }
  }

  res.status(200).json({ received: true });
}
