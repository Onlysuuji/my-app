const nextConfig = {
  async headers() {
    return [
      {
        source: "/player/:path*", // ← ffmpegを使うページだけ
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;