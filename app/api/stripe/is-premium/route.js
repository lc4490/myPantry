export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

const PRICE_MAP = {
  starter: process.env.STRIPE_PRICE_ID_STARTER_MONTHLY,
  pro: process.env.STRIPE_PRICE_ID_PRO_MONTHLY,
};
const GOOD = new Set(["active", "trialing", "past_due"]); // treat these as premium

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email)
      return NextResponse.json({ error: "Missing email" }, { status: 400 });

    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer = customers.data[0];
    if (!customer) return NextResponse.json({ isPremium: false, tier: null });

    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 20,
      // no expansion needed; items[].price is included
    });

    let tier = null;

    // If a user somehow has both, prefer Pro
    for (const s of subs.data) {
      if (!GOOD.has(s.status)) continue;
      const priceIds = s.items.data.map((it) => it.price?.id);
      if (priceIds.includes(PRICE_MAP.pro)) tier = "pro";
      else if (priceIds.includes(PRICE_MAP.starter)) tier = tier || "starter";
    }

    return NextResponse.json({ isPremium: !!tier, tier });
  } catch (err) {
    console.error("[is-premium] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
