const nextConfig = {
  typedRoutes: true,
  ...(process.env.CLOUDFLARE_PAGES === "1" ? { output: "export" } : {})
};

export default nextConfig;
