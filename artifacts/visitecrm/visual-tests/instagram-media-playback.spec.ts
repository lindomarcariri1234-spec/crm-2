import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { devices, expect, test } from "@playwright/test";

const mobileDevice = devices["Pixel 7"]!;
test.use({ ...mobileDevice });

const mediaFiles = {
  "/instagram-audio.mp3": {
    body: readFileSync(new URL("./fixtures/instagram-audio.mp3", import.meta.url)),
    contentType: "audio/mpeg",
  },
  "/instagram-video.mp4": {
    body: readFileSync(new URL("./fixtures/instagram-video.mp4", import.meta.url)),
    contentType: "video/mp4",
  },
} satisfies Record<string, { body: Buffer; contentType: string }>;

let mediaServer: Server;
let mediaOrigin = "";
const rangedPaths: string[] = [];

function sendMedia(request: IncomingMessage, response: ServerResponse) {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const media = mediaFiles[path as keyof typeof mediaFiles];
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");

  if (!media) {
    response.writeHead(404, { "Content-Type": "video/mp4" });
    response.end("Not found");
    return;
  }

  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", media.contentType);
  const rangeHeader = request.headers.range;
  const rangeMatch = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  if (!rangeMatch) {
    response.writeHead(200, { "Content-Length": media.body.length });
    response.end(media.body);
    return;
  }

  const start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
  const requestedEnd = rangeMatch[2] ? Number(rangeMatch[2]) : media.body.length - 1;
  if (start >= media.body.length || requestedEnd < start) {
    response.writeHead(416, { "Content-Range": `bytes */${media.body.length}` });
    response.end();
    return;
  }

  const end = Math.min(requestedEnd, media.body.length - 1);
  rangedPaths.push(path);
  response.writeHead(206, {
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${media.body.length}`,
  });
  response.end(media.body.subarray(start, end + 1));
}

test.beforeAll(async () => {
  mediaServer = createServer(sendMedia);
  await new Promise<void>((resolve, reject) => {
    mediaServer.once("error", reject);
    mediaServer.listen(0, "127.0.0.1", resolve);
  });
  const address = mediaServer.address();
  if (!address || typeof address === "string") throw new Error("Local media server did not bind to a TCP port.");
  mediaOrigin = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

test.afterAll(async () => {
  if (mediaServer?.listening) {
    await new Promise<void>((resolve, reject) => {
      mediaServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("plays locally served Instagram audio and video in mobile Chromium and reports an unavailable URL", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Pixel 7 mobile emulation is supported by Chromium.");

  for (const [path, expectedType] of [
    ["/instagram-audio.mp3", "audio/mpeg"],
    ["/instagram-video.mp4", "video/mp4"],
  ]) {
    const response = await page.request.get(`${mediaOrigin}${path}`, {
      headers: { Range: "bytes=0-511" },
    });
    expect(response.status()).toBe(206);
    expect(response.headers()["content-type"]).toBe(expectedType);
    expect(response.headers()["accept-ranges"]).toBe("bytes");
    expect(response.headers()["content-range"]).toMatch(/^bytes 0-511\/\d+$/);
  }
  expect(rangedPaths).toEqual(["/instagram-audio.mp3", "/instagram-video.mp4"]);

  await page.goto(
    `/visual-tests/index.html?scenario=instagram-media-playback&mediaBase=${encodeURIComponent(mediaOrigin)}`,
  );
  const mobileContext = await page.evaluate(() => ({
    width: window.innerWidth,
    touchPoints: navigator.maxTouchPoints,
    userAgent: navigator.userAgent,
  }));
  expect(mobileContext.width).toBe(412);
  expect(mobileContext.touchPoints).toBeGreaterThan(0);
  expect(mobileContext.userAgent).toContain("Android");

  const audio = page.getByTestId("instagram-audio-fixture").locator("audio");
  const video = page.getByTestId("instagram-video-fixture").locator("video");
  await expect(audio).toBeVisible();
  await expect(video).toBeVisible();

  await audio.evaluate(async (element: HTMLAudioElement) => {
    element.muted = true;
    await element.play();
  });
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0.1);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);

  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.1);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);

  const failedMedia = page.getByTestId("instagram-failed-video-fixture");
  await expect(failedMedia.getByRole("status")).toHaveText("Anexo indisponível ou expirado");
  await expect(failedMedia.locator("video")).toHaveCount(0);
});
