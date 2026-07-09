export interface ReformulatedTool {
  step: number;
  tool: string;
  parameters: Record<string, unknown>;
  depends_on_step: number | null;
  output_marker: string | null;
}

export interface ReformulatedPrompt {
  mission_id: string;
  status: "REFORMAT_READY" | "VALIDATION_ERROR" | "BLOCKED";
  tool_chain: ReformulatedTool[];
  validation_errors: string[];
}

type PromptCategory = 
  | "social_media_content"
  | "browser_flow"
  | "asset_optimization"
  | "backup_operation"
  | "code_implementation"
  | "metrics_logging"
  | "multi_step_mission"
  | "unknown";

export class PromptReformulator {
  private extractMissionId(): string {
    return `mission-${Date.now()}`;
  }

  private detectCategory(prompt: string): PromptCategory {
    const lower = prompt.toLowerCase();
    
    if (lower.includes("write") && (lower.includes("post") || lower.includes("content")) && lower.includes("campaign")) {
      return "social_media_content";
    }
    if (lower.includes("scrape") || lower.includes("login") || (lower.includes("extract") && lower.includes("url"))) {
      return "browser_flow";
    }
    if (lower.includes("optimize") && (lower.includes("video") || lower.includes("image")) && lower.includes("linkedin")) {
      return "asset_optimization";
    }
    if ((lower.includes("backup") && lower.includes("patch")) || (lower.includes("before") && lower.includes("create snapshot"))) {
      return "backup_operation";
    }
    if (lower.includes("implement") || lower.includes("middleware") || (lower.includes("code") && lower.includes("add"))) {
      return "code_implementation";
    }
    if ((lower.match(/\band\b/gi)?.length ?? 0) >= 2) {
      return "multi_step_mission";
    }
if (lower.includes("and") && (lower.match(/\band\b/gi)?.length ?? 0) >= 2) {
      return "multi_step_mission";
    }
    if (lower.includes("log") && lower.includes("metric") && !lower.includes("and")) {
      return "metrics_logging";
    }
    return "unknown";
  }

  private extractSocialMediaData(prompt: string): { content_type: string; campaign: string; platform: string; hashtags: boolean; cta: boolean } {
    const platforms = ["facebook", "linkedin", "twitter", "instagram"];
    const foundPlatform = platforms.find(p => prompt.toLowerCase().includes(p)) || "generic";
    
    const words = prompt.split(/\s+/);
    let campaign = "unknown_campaign";
    const hiluxIndex = words.findIndex(w => /hilux/i.test(w));
    if (hiluxIndex >= 0) {
      campaign = [words[hiluxIndex], words[hiluxIndex + 1] || "", words[hiluxIndex + 2] || ""].join(" ").replace(/[.,]/g, '').trim();
    }
    
    return {
      content_type: "text",
      campaign: campaign || "unknown_campaign",
      platform: foundPlatform,
      hashtags: /hashtag/i.test(prompt),
      cta: /call-to-action|cta|contact|visit|book/i.test(prompt)
    };
  }

  private extractBrowserData(prompt: string): { url: string | null; task: string; profile: string; screenshot: boolean } {
    const urlMatch = /https?:\/\/[^\s]+/i.exec(prompt);
    const profileMatch = /(?:profile|session)\s*[:\-]?\s*([a-z0-9_]+)/i.exec(prompt) || /(\w+_?\w+)\s*(?:session|profile)/i.exec(prompt);
    
    const taskDescription = prompt.replace(urlMatch?.[0] || "", "").replace(profileMatch?.[0] || "", "").trim();
    
    return {
      url: urlMatch?.[0] || null,
      task: taskDescription || "browser_task",
      profile: profileMatch?.[1] || "default",
      screenshot: /screenshot/i.test(prompt)
    };
  }

  private extractAssetData(prompt: string): { inputPath: string | null; platform: string } {
    const pathMatch = /\/home\/elo\/workspace\/[^\s]+/i.exec(prompt);
    const platforms = ["linkedin", "facebook", "instagram", "standard"];
    const foundPlatform = platforms.find(p => prompt.toLowerCase().includes(p)) || "standard_image";
    
    return {
      inputPath: pathMatch?.[0] || null,
      platform: foundPlatform
    };
  }

  private extractMetricsData(prompt: string): { project: string; impressions: number; clicks: number; conversions: number } {
    const impressionsMatch = /(\d+)\s*(?:impressions?|views?)/i.exec(prompt);
    const clicksMatch = /(\d+)\s*(?:clicks?|visits?)/i.exec(prompt);
    const conversionsMatch = /(\d+)\s*(?:conversions?|sales?|leads?)/i.exec(prompt);
    const projectMatch = /(?:for|campaign)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i.exec(prompt);
    
    return {
      project: projectMatch?.[1] || "unknown_project",
      impressions: parseInt(impressionsMatch?.[1] || "0"),
      clicks: parseInt(clicksMatch?.[1] || "0"),
      conversions: parseInt(conversionsMatch?.[1] || "0")
    };
  }

  private extractMultiStepData(prompt: string): string[] {
    const steps: string[] = [];
    const andSplit = prompt.split(/\s+and\s+/i);
    
    for (const step of andSplit) {
      const trimmed = step.trim();
      if (trimmed) {
        steps.push(trimmed);
      }
    }
    
    return steps.length > 1 ? steps : [prompt];
  }

  private generateToolChain(category: PromptCategory, prompt: string): ReformulatedTool[] {
    switch (category) {
      case "social_media_content":
        const social = this.extractSocialMediaData(prompt);
        return [
          {
            step: 1,
            tool: "WRITE_TECHNICAL_REPORT",
            parameters: {
              missionId: this.extractMissionId(),
              entry: `{"status": "content_generation_needed", "platform": "${social.platform}", "campaign": "${social.campaign}", "hashtags": ${social.hashtags}, "cta": ${social.cta}}`
            },
            depends_on_step: null,
            output_marker: "CONTENT_GENERATED|||"
          },
          {
            step: 2,
            tool: "WRITE_EXECUTIVE_REPORT",
            parameters: {
              missionId: this.extractMissionId(),
              summary: "Generated social media content for campaign"
            },
            depends_on_step: 1,
            output_marker: null
          }
        ];

      case "browser_flow":
        const browser = this.extractBrowserData(prompt);
        if (!browser.url) {
          return [];
        }
        return [
          {
            step: 1,
            tool: "EXECUTE_BROWSER_FLOW",
            parameters: {
              url: browser.url,
              taskDescription: browser.task,
              sessionProfile: browser.profile,
              screenshotName: browser.screenshot ? `browser_${Date.now()}` : undefined
            },
            depends_on_step: null,
            output_marker: "SCRAPED_CONTENT|||title:|||content:|||"
          }
        ];

      case "asset_optimization":
        const asset = this.extractAssetData(prompt);
        if (!asset.inputPath) {
          return [];
        }
        return [
          {
            step: 1,
            tool: "OPTIMIZE_MARKETING_ASSETS",
            parameters: {
              inputPath: asset.inputPath,
              platform: asset.platform as "linkedin_document" | "facebook_feed" | "instagram_reels" | "standard_image",
              outputDirectory: "/home/elo/workspace/optimized_out"
            },
            depends_on_step: null,
            output_marker: "OPTIMIZED_PATH|||"
          }
        ];

      case "metrics_logging":
        const metrics = this.extractMetricsData(prompt);
        return [
          {
            step: 1,
            tool: "LOG_CAMPAIGN_METRICS",
            parameters: {
              project: metrics.project,
              impressions: metrics.impressions,
              clicks: metrics.clicks,
              conversions: metrics.conversions
            },
            depends_on_step: null,
            output_marker: `METRIC_RECORDED|||${metrics.project}:${(metrics.clicks / metrics.impressions * 100 || 0).toFixed(2)}%`
          }
        ];

      case "multi_step_mission":
        const steps = this.extractMultiStepData(prompt);
        const tools: ReformulatedTool[] = [];
        
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if (!step) continue;
          const stepCat = this.detectCategory(step);
          const stepTools = this.generateToolChain(stepCat, step);
          
          stepTools.forEach((t, idx) => {
            tools.push({
              ...t,
              step: tools.length + idx + 1,
              depends_on_step: i === 0 ? null : tools.length
            });
          });
        }
        
        return tools;

      case "backup_operation":
        return [
          {
            step: 1,
            tool: "STAGE_SECURE_BACKUP",
            parameters: {
              sourcePath: "/home/elo/workspace",
              backupName: `pre_operation_backup_${Date.now()}`
            },
            depends_on_step: null,
            output_marker: "BACKUP_CREATED|||path:|||"
          }
        ];

      case "code_implementation":
        const filePathMatch = /\/home\/elo\/workspace\/[^\s]+/i.exec(prompt);
        return [
          {
            step: 1,
            tool: "PATCH_FILE_DIFF",
            parameters: {
              targetPath: filePathMatch?.[0] || "/home/elo/workspace/src/active_module.ts",
              searchBlock: "",
              replacementBlock: ""
            },
            depends_on_step: null,
            output_marker: "PATCH_PREPARED|||"
          }
        ];

      default:
        return [
          {
            step: 1,
            tool: "WRITE_TECHNICAL_REPORT",
            parameters: {
              missionId: this.extractMissionId(),
              entry: `{"raw_prompt": "${prompt.replace(/"/g, '\\"')}", "status": "passed_to_llm"}`
            },
            depends_on_step: null,
            output_marker: null
          }
        ];
    }
  }

  reformulate(prompt: string, missionIdOverride?: string): ReformulatedPrompt {
    const missionId = missionIdOverride || this.extractMissionId();
    const category = this.detectCategory(prompt);
    const toolChain = this.generateToolChain(category, prompt);

    if (toolChain.length === 0) {
      return {
        mission_id: missionId,
        status: "VALIDATION_ERROR",
        tool_chain: [],
        validation_errors: ["Missing required parameters for tool execution"]
      };
    }

    return {
      mission_id: missionId,
      status: "REFORMAT_READY",
      tool_chain: toolChain,
      validation_errors: []
    };
  }
}

export function createReformulatedPrompt(rawPrompt: string, missionIdOverride?: string): ReformulatedPrompt {
  const reformulator = new PromptReformulator();
  return reformulator.reformulate(rawPrompt, missionIdOverride);
}