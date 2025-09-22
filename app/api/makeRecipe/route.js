import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
/**
 * POST /api/recipes/craft
 * body: { pantryList: Array<{name: string}> }
 * returns: { recipes: Array<{recipe, ingredients, instructions, image?}> }
 */
export async function POST(req) {
  try {
    const { ingredientsCsv } = await req.json();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content:
            `Here is a list of ingredients: ${ingredientsCsv}. ` +
            `Classify them into foods and non-foods. Create 2-3 recipes only using the foods provided. ` +
            `Do not use foods that are not in the ingredients list. Only print the recipes. ` +
            `Format it like this:\n` +
            `Recipe: Fish & Ham Sandwich\n` +
            `Ingredients: Fish, Ham\n` +
            `Instructions: Layer slices of ham and cooked fish between two pieces of bread. Serve chilled or grilled.`,
        },
      ],
      temperature: 0.4,
    });

    const result = (completion.choices?.[0]?.message?.content || "").trim();

    return NextResponse.json({ result });
  } catch (err) {
    console.error("craft recipes error", err);
    return NextResponse.json(
      { error: "Failed to craft recipes" },
      { status: 500 }
    );
  }
}
