// src/utils/network_guard.ts
import { URL } from "node:url";
import dns from "node:dns/promises";

/**
 * Validates a target URL to ensure it does not point to internal,
 * private, or loopback network addresses (SSRF Protection).
 */
export class NetworkGuard {
    private readonly PRIVATE_IP_PATTERN = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|::1$|fc00::)/;

    public validateURL(url: string): boolean {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
            if (this.PRIVATE_IP_PATTERN.test(parsed.hostname)) return false;
            return true;
        } catch {
            return false;
        }
    }
}

export async function validateRemoteUrl(untrustedUrl: string): Promise<string> {
  const parsedUrl = new URL(untrustedUrl);
  
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`SECURITY ALERT: Protocol '${parsedUrl.protocol}' is forbidden.`);
  }

  const hostname = parsedUrl.hostname;

  if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "localhost.localdomain") {
    throw new Error(`SECURITY ALERT: Access to local domains is blocked.`);
  }

  try {
    const lookup = await dns.lookup(hostname);
    const ip = lookup?.address;

    if (ip) {
      const isLoopback = ip.startsWith("127.");
      const isPrivate =
        ip.startsWith("10.") ||
        ip.startsWith("192.168.") ||
        (ip.startsWith("172.") && parseInt(ip.split(".")[1] ?? "0", 10) >= 16 && parseInt(ip.split(".")[1] ?? "0", 10) <= 31);
      const isLinkLocal = ip.startsWith("169.254.");

      if (isLoopback || isPrivate || isLinkLocal) {
        throw new Error(`SECURITY ALERT: URL resolves to a restricted local network address: ${ip}`);
      }
    }

    return untrustedUrl;
  } catch (error: any) {
    throw new Error(`Network Guard Validation Failed: ${error.message}`);
  }
}