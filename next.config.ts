import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    // Every page here is dynamic, and Next's client cache keeps dynamic pages
    // for 0s by default — so returning to a page you just left refetched it
    // from scratch. 30s makes back-and-forth navigation instant. Saving
    // anything (Watch Later, deleting history) still refreshes immediately,
    // because those actions call revalidatePath, which clears this cache.
    staleTimes: { dynamic: 30 },
  },
  images: {
    remotePatterns: [
      // YouTube serves thumbnails from i.ytimg.com *and* i1-i4.ytimg.com; the
      // RSS feeds use the numbered hosts. Allowing only i.ytimg.com made most
      // feed thumbnails fail with a 400 from the image optimizer.
      { protocol: "https", hostname: "*.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
      { protocol: "https", hostname: "yt3.googleusercontent.com" },
    ],
  },
};

export default config;
