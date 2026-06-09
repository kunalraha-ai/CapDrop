import * as https from "https";
import * as http from "http";
import { URL } from "url";

/**
 * Protocol-aware HTTP/HTTPS POST helper.
 * Routes to `node:http` for http:// URLs (e.g. local Supabase at 127.0.0.1:54321)
 * and `node:https` for https:// URLs (e.g. remote Supabase, Gemini API).
 */
export function httpsPost(urlStr: string, headers: Record<string, string>, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const isHttps = url.protocol === "https:";
      const defaultPort = isHttps ? 443 : 80;

      const options: https.RequestOptions = {
        method: "POST",
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : defaultPort,
        path: url.pathname + url.search,
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body)
        }
      };

      // Choose http or https transport based on URL scheme
      const transport = isHttps ? https : http;

      const req = transport.request(options, (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseBody);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseBody || res.statusMessage}`));
          }
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      req.write(body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}
