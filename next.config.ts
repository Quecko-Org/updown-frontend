import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@account-kit/react",
    "@account-kit/core",
    "@account-kit/infra",
    "@account-kit/signer",
    "@account-kit/smart-contracts",
  ],
};

export default nextConfig;
