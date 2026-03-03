import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get("keyword");

  if (!keyword) {
    return NextResponse.json({ error: "Missing keyword" }, { status: 400 });
  }

  try {
    const floUrl = `https://www.music-flo.com/api/search/v2/search/integration?keyword=${encodeURIComponent(
      keyword
    )}`;
    
    // We fetch from the FLO API
    const response = await fetch(floUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }
    });

    if (!response.ok) {
      throw new Error(`FLO API responded with status: ${response.status}`);
    }

    const data = await response.json();

    // The FLO API has a specific deeply nested structure
    // Let's try to extract the first Track's 500x500 album image
    let imageUrl = null;

    if (data?.data?.list) {
      const trackSection = data.data.list.find((section: any) => section.type === "TRACK");
      if (trackSection?.list?.length > 0) {
        const firstTrack = trackSection.list[0];
        const albumImages = firstTrack?.album?.imgList;
        
        if (albumImages && albumImages.length > 0) {
          // Find the 500 size image or fallback to the largest available
          const img500 = albumImages.find((img: any) => img.size === 500);
          imageUrl = img500 ? img500.url : albumImages[albumImages.length - 1].url;
        }
      }
    }

    if (!imageUrl) {
      return NextResponse.json({ error: "No image found" }, { status: 404 });
    }

    return NextResponse.json({ imageUrl });

  } catch (error) {
    console.error("Error fetching FLO image:", error);
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 500 });
  }
}
