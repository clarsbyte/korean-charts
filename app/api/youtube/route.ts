import { NextRequest, NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scrapeYouTubeVideo } = require("../index.js");

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const song = searchParams.get("song")?.trim() || "";
  const artist = searchParams.get("artist")?.trim() || "";

  if (!song) {
    return NextResponse.json({ error: "song is required" }, { status: 400 });
  }

  try {
    const result = await scrapeYouTubeVideo(song, artist);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        song,
        artist,
        error: error instanceof Error ? error.message : "Unexpected YouTube scraping error",
      },
      { status: 500 },
    );
  }
}
