import type { NextConfig } from "next";

const config: NextConfig = {
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
