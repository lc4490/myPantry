import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/vision/predict
 * body: { imgDataUrl: string }  // data URL or a remote URL
 * returns: { label: string }
 */
export async function POST(req) {
  try {
    const { imgDataUrl } = await req.json();
    if (!imgDataUrl) {
      return NextResponse.json(
        { error: "imgDataUrl is required" },
        { status: 400 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Identify the main object in this picture in as few words as possible",
            },
            {
              type: "image_url",
              image_url: { url: imgDataUrl, detail: "low" },
            },
          ],
        },
      ],
    });

    let result = (completion.choices?.[0]?.message?.content || "").trim();
    console.log(result);
    // normalize like your frontend did
    // result = result.replace(/\./g, "");
    // result = result
    //   .split(/\s+/)
    //   .filter(Boolean)
    //   .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    //   .join(" ");

    return NextResponse.json({ result });
  } catch (err) {
    console.error("predict error", err);
    return NextResponse.json({ error: "Failed to predict" }, { status: 500 });
  }
}
