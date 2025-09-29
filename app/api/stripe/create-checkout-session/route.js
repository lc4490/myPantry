export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

const PRICE_MAP = {
  starter: process.env.STRIPE_PRICE_ID_STARTER_MONTHLY,
  pro: process.env.STRIPE_PRICE_ID_PRO_MONTHLY,
};

export async function POST(req) {
  try {
    const { email, plan = "starter" } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }
    if (!PRICE_MAP[plan]) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const priceId = PRICE_MAP[plan];

    // Find or create customer
    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer =
      customers.data[0] ||
      (await stripe.customers.create({
        email,
        metadata: { firebaseEmail: email },
      }));

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}?upgrade=success`,
      cancel_url: `${siteUrl}?upgrade=canceled`,
      allow_promotion_codes: true,
      metadata: { firebaseEmail: email, plan },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}
