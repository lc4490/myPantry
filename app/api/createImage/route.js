import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const maxDuration = 30;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST /api/images/generate
 * body: { label: string }
 * returns: { dataUrl: string|null }
 */
export async function POST(req) {
  const { label } = await req.json();
  if (!label)
    return NextResponse.json({ error: "label is required" }, { status: 400 });

  // up to 2 retries on 429
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai.images.generate({
        model: "dall-e-2",
        prompt: label,
        n: 1,
        size: "256x256",
        response_format: "b64_json",
      });
      const b64 = response.data?.[0]?.b64_json;
      return NextResponse.json({
        dataUrl: b64 ? `data:image/png;base64,${b64}` : null,
      });
    } catch (error) {
      const status = error?.status || error?.response?.status;
      if (status === 429 && attempt < 2) {
        console.warn("Rate limit—retrying in 10s…");
        await sleep(10_000);
        continue;
      }
      console.error("image generate error", error);
      return NextResponse.json(
        { error: "Failed to generate image" },
        { status: 500 }
      );
    }
  }
}
