// app/api/stripe/is-premium/route.js
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer = customers.data[0];
    if (!customer) return NextResponse.json({ isPremium: false });

    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 10,
    });

    const premiumStatuses = new Set(["active", "trialing", "past_due"]);
    const isPremium = subs.data.some((s) => premiumStatuses.has(s.status));

    return NextResponse.json({ isPremium });
  } catch (err) {
    console.error("[is-premium] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
