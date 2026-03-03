import { NextResponse } from "next/server";

const ALLOWED_HOST_SUFFIXES = ["music-flo.com", "flo-cdn.com"];

const isAllowedImageHost = (hostname: string) =>
  ALLOWED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const urlParam = searchParams.get("url");

  if (!urlParam) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let imageUrl: URL;
  try {
    imageUrl = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (imageUrl.protocol !== "https:" || !isAllowedImageHost(imageUrl.hostname)) {
    return NextResponse.json({ error: "Blocked host" }, { status: 400 });
  }

  try {
    const upstream = await fetch(imageUrl.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "force-cache",
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: "Failed to fetch image" }, { status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const bytes = await upstream.arrayBuffer();

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to proxy image" }, { status: 500 });
  }
}
