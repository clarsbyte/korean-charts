import { NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getChartsData } = require("../index.js");

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await getChartsData();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        sources: [],
        error: error instanceof Error ? error.message : "Unexpected server error",
      },
      { status: 500 },
    );
  }
}
