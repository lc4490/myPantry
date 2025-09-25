import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const priceId = process.env.STRIPE_PRICE_ID;

    // Try to find or create customer
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
      metadata: { firebaseEmail: email },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
