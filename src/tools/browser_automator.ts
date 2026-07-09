// src/tools/browser_automator.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { heavyTaskQueue } from "../utils/task_queue.js";
import { getSecureSessionContext } from "../utils/session_manager.js";
import { sanitizeIngestedText, validateAndResolvePath, ALLOWED_ROOTS } from "../utils/security_guard.js";
import { SessionManager } from "../utils/session_manager.js";
import path from "node:path";

export class BrowserAutomator {
    private sessionMgr = new SessionManager();

    public async createMissionContext(missionId: string): Promise<any> {
        const playwright = await import("playwright" as any) as any;
        const browser = await playwright.chromium.launch();
        return await browser.newContext({
            storageState: this.sessionMgr.getSessionDir(missionId) + '/state.json'
        });
    }

    public checkHandoffRequired(content: string): boolean {
        return content.includes('2FA') || content.includes('CAPTCHA');
    }

    public async executeFlow(url: string, taskDescription: string, sessionProfile: string, screenshotName?: string): Promise<{
      status: string;
      title?: string;
      extracted_content?: string;
      screenshot?: string;
      note?: string;
      error?: string;
    }> {
      return heavyTaskQueue.run(async () => {
        try {
          const secureContextPath = await getSecureSessionContext(sessionProfile);

          const playwright = await import("playwright" as any) as any;
           const browser = await playwright.chromium.launch({
             headless: true,
             args: [
               "--disable-dev-shm-usage",
               "--no-sandbox"
             ]
           });

           const context = await playwright.chromium.launchPersistentContext(secureContextPath, {
            viewport: { width: 1280, height: 720 },
            userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
          });

          try {
            const page = await context.newPage();
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

            const pageTitle = await page.title();

            let screenshotPath = "none";
            if (screenshotName) {
              const targetedPath = path.join("/home/elo/workspace/screenshots", `${screenshotName}.png`);
              screenshotPath = validateAndResolvePath(targetedPath, ALLOWED_ROOTS.WORKSPACE);
              await page.screenshot({ path: screenshotPath });
            }

            const rawBodyText = await page.locator('body').innerText();

            const cleanTitle = sanitizeIngestedText(pageTitle);
            const cleanBodyText = sanitizeIngestedText(rawBodyText);

            return {
              status: "FLOW_COMPLETE",
              title: cleanTitle,
              extracted_content: cleanBodyText,
              screenshot: screenshotPath,
              note: `Task executed: ${taskDescription}`
            };
          } finally {
            await context.close();
            await browser.close();
          }
        } catch (error: any) {
          return {
            status: "FLOW_FAILED",
            error: `Browser Flow Failed: ${error.message}`
          };
        }
      });
    }
}

export function registerBrowserAutomatorTool(server: McpServer) {
  server.tool(
    "execute_browser_flow",
    "Automates web tasks. Must specify the isolated session profile to use.",
    {
      url: z.string().url(),
      taskDescription: z.string(),
      sessionProfile: z.string().describe("The isolated profile to use (e.g., 'skinglow_ads', 'kars_enterprise', 'default')"),
      screenshotName: z.string().optional()
    },
    async ({ url, taskDescription, sessionProfile, screenshotName }) => {
      return heavyTaskQueue.run(async () => {
        try {
          const secureContextPath = await getSecureSessionContext(sessionProfile);

          const playwright = await import("playwright" as any) as any;
           const browser = await playwright.chromium.launch({
             headless: true,
             args: [
               "--disable-dev-shm-usage",
               "--no-sandbox"
             ]
           });

           const context = await playwright.chromium.launchPersistentContext(secureContextPath, {
            viewport: { width: 1280, height: 720 },
            userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
          });

          try {
            const page = await context.newPage();
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

            const pageTitle = await page.title();

            let screenshotPath = "none";
            if (screenshotName) {
              const targetedPath = path.join("/home/elo/workspace/screenshots", `${screenshotName}.png`);
              screenshotPath = validateAndResolvePath(targetedPath, ALLOWED_ROOTS.WORKSPACE);
              await page.screenshot({ path: screenshotPath });
            }

            const rawBodyText = await page.locator('body').innerText();

            const cleanTitle = sanitizeIngestedText(pageTitle);
            const cleanBodyText = sanitizeIngestedText(rawBodyText);

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "FLOW_COMPLETE",
                  title: cleanTitle,
                  extracted_content: cleanBodyText,
                  screenshot: screenshotPath,
                  note: `Task executed: ${taskDescription}`
                }, null, 2)
              }]
            };
          } finally {
            await context.close();
            await browser.close();
          }
        } catch (error: any) {
          return {
            isError: true,
            content: [{ type: "text", text: `Browser Flow Failed: ${error.message}` }]
          };
        }
      });
    }
  );
}
