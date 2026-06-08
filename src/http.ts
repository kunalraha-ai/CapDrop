import * as https from "https";
import { URL } from "url";

export function httpsPost(urlStr: string, headers: Record<string, string>, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const options: https.RequestOptions = {
        method: "POST",
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body)
        }
      };

      const req = https.request(options, (res) => {
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
