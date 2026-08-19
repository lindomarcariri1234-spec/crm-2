export function getTripVideoEmbedUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "youtu.be" || hostname === "www.youtu.be") {
    const videoId = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(videoId)
      ? `https://www.youtube.com/embed/${videoId}`
      : null;
  }

  if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
    const videoId = url.searchParams.get("v");
    return videoId && /^[\w-]{11}$/.test(videoId)
      ? `https://www.youtube.com/embed/${videoId}`
      : null;
  }

  if (hostname === "vimeo.com" || hostname.endsWith(".vimeo.com")) {
    const videoId = url.pathname.match(/\/(\d+)(?:\/)?$/)?.[1];
    return videoId ? `https://player.vimeo.com/video/${videoId}` : null;
  }

  return null;
}