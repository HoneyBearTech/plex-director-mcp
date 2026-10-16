import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import axios from "axios";
import { fetchPoster } from "../src/tools/movies.js";
import { fakeApi } from "./helpers.js";

let fake: ReturnType<typeof fakeApi> | undefined;
afterEach(() => fake?.restore());

describe("fetchPoster", () => {
  it("downloads a TMDb poster with a timeout, a size cap and no redirects", async () => {
    fake = fakeApi(axios, () => ({
      data: Buffer.from("jpegbytes"),
      headers: { "content-type": "image/jpeg" },
    }));
    const poster = await fetchPoster("https://image.tmdb.org/t/p/w500/abc.jpg");
    assert.deepEqual(poster, {
      data: Buffer.from("jpegbytes").toString("base64"),
      mimeType: "image/jpeg",
    });
    const [call] = fake.calls;
    assert.equal(call?.url, "https://image.tmdb.org/t/p/w500/abc.jpg");
    assert.deepEqual(call?.limits, {
      timeout: 10_000,
      maxContentLength: 5 * 1024 * 1024,
      maxRedirects: 0,
    });
  });

  it("never requests a URL outside the allowed hosts (the URL comes from Radarr's metadata)", async () => {
    fake = fakeApi(axios, () => ({ data: Buffer.from("x") }));
    for (const url of [
      "http://image.tmdb.org/t/p/w500/abc.jpg",
      "https://192.168.1.10:8989/MediaCover/1/poster.jpg",
      "https://localhost/poster.jpg",
      "https://image.tmdb.org.evil.example/poster.jpg",
      "file:///etc/passwd",
      "not a url",
    ]) {
      assert.equal(await fetchPoster(url), null, url);
    }
    assert.equal(fake.calls.length, 0);
  });

  it("drops a reply that isn't an image, and a failed download", async () => {
    fake = fakeApi(axios, () => ({
      data: Buffer.from("<html>"),
      headers: { "content-type": "text/html" },
    }));
    assert.equal(await fetchPoster("https://image.tmdb.org/t/p/w500/abc.jpg"), null);
    fake.restore();
    fake = fakeApi(axios, () => ({ status: 404 }));
    assert.equal(await fetchPoster("https://image.tmdb.org/t/p/w500/abc.jpg"), null);
  });
});
