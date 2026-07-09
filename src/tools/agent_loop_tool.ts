import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgentLoop } from "../utils/agent_loop.js";
import { ApiGuardMiddleware } from "../utils/api_guard_middleware.js";
import { ipcPipe } from "../utils/ipc_pipe.js";

let stateBroadcaster: ((state: Record<string, unknown>) => void) | null = null;

export function setAgentLoopStateBroadcaster(broadcaster: ((state: Record<string, unknown>) => void) | null): void {
  stateBroadcaster = broadcaster;
}

export function registerAgentLoopTool(server: McpServer) {
  const apiGuard = new ApiGuardMiddleware();
  const agentLoop = new AgentLoop(apiGuard, ipcPipe.send.bind(ipcPipe), stateBroadcaster);

  server.tool(
    "start_mission",
    "Starts the autonomous AI Admin mission loop. Provide a high-level goal prompt and the AI will decompose it into tasks, execute tools, and report back.",
    {
      prompt: z.string().describe("The high-level mission goal (e.g., 'Restart the marketing bot and generate LinkedIn content')")
    },
    async ({ prompt }) => {
      try {
        const result = await agentLoop.executeMission(prompt);
        const response = {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "MISSION_EXECUTED",
              mission_id: result.missionId,
              completed: result.completed,
              summary: result.summary
            }, null, 2)
          }]
        };
        setTimeout(() => process.exit(result.completed ? 0 : 1), 100);
        return response;
      } catch (error: any) {
        console.error("[AGENT_LOOP_TOOL_ERROR]", error);
        setTimeout(() => process.exit(1), 100);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Mission execution failed: ${error?.message || String(error)}` }]
        };
      }
    }
  );
}
