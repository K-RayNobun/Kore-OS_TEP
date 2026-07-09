// src/tools/marketing_policy.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// --- Deeply Typed Configuration Schema for Social Platforms ---
interface PlatformConstraints {
  maxCharacterCount: number;
  maxAssetSizeMB: number;
  allowedAspectRatios: string[];
  preferredFormatting: string;
  hashtagStrategy: string;
}

interface BrandStrategy {
  toneOfVoice: string;
  targetAudience: string;
  primaryHooks: string[];
}

// 1. HARD PLATFORM RULES (Technical Boundaries)
const PLATFORM_RULES: Record<string, PlatformConstraints> = {
  facebook: {
    maxCharacterCount: 63206,
    maxAssetSizeMB: 10, // Optimized ceiling for standard feed assets
    allowedAspectRatios: ["1:1", "16:9", "4:5"],
    preferredFormatting: "Direct hook line, short paragraph breaks, clear emoji bullet points, prominent Call-To-Action link.",
    hashtagStrategy: "Minimalist. 1 to 3 broad brand hashtags at the very bottom."
  },
  instagram: {
    maxCharacterCount: 2200,
    maxAssetSizeMB: 8,
    allowedAspectRatios: ["1:1", "9:16", "4:5"],
    preferredFormatting: "High emotion hook, visual narrative, explicit swipe-left trigger instructions, clean white-space padding.",
    hashtagStrategy: "Aggressive segmentation. 5 to 15 targeted contextual and community tags hidden below spacing breaks."
  },
  linkedin: {
    maxCharacterCount: 3000,
    maxAssetSizeMB: 100, // Allows large document PDFs/Slide decks
    allowedAspectRatios: ["1:1", "16:9", "4:5"],
    preferredFormatting: "Executive narrative style, contrarian opening hook sentence, analytical formatting, bulleted takeaways, zero internal links in main text (place in comment section).",
    hashtagStrategy: "Highly focused. Exactly 3 professional domain keywords (e.g., #Entrepreneurship, #Automotive)."
  },
  x: {
    maxCharacterCount: 280, // Standard unverified ceiling
    maxAssetSizeMB: 5,
    allowedAspectRatios: ["1:1", "16:9"],
    preferredFormatting: "Single hyper-punchy statement or structured multi-part thread layout. Every line must read like an aphorism.",
    hashtagStrategy: "Extremely sparse. 0 to 1 integrated keyword inline. No block tagging."
  }
};

// 2. SEMANTIC BRAND STRATEGIES (Target Frameworks)
const BRAND_STRATEGIES: Record<string, BrandStrategy> = {
  cosmetics: {
    toneOfVoice: "Confident, aesthetic, glowing, highly persuasive, luxury-retail focused.",
    targetAudience: "Skincare consumers across major regional hubs including regional metros like Douala and international sectors like Toronto.",
    primaryHooks: ["Before/After validation statements", "Ingredient transparency hooks", "Self-care routine upgrades"]
  },
  automotive: {
    toneOfVoice: "Authoritative, highly reliable, industrial, emphasizing structural integrity and mechanics.",
    targetAudience: "Regional marketplace buyers, transport operators, and logistics businesses tracking imported vehicle inventory.",
    primaryHooks: ["Durability and mechanical reliability proofs", "Direct utility and transport capability breakdowns", "Import specification highlight parameters"]
  },
  infoproducts: {
    toneOfVoice: "Aggressive, metric-driven, action-oriented, instructional, focused on direct value creation frameworks.",
    targetAudience: "Aspiring entrepreneurs looking to scale digital revenue channels rapidly from scratch.",
    primaryHooks: ["Time-bound monetary conversion case studies (e.g., 0 to 200 within 12 days)", "Playbook execution step reveals", "Zero-to-one velocity breakdowns"]
  }
};

export function registerMarketingPolicyTool(server: McpServer) {
  server.tool(
    "get_marketing_policy",
    "Acts as the definitive rulebook router. Serves platform tech constraints and brand strategies to the AI browser to eliminate formatting errors.",
    {
      platform: z.enum(["facebook", "instagram", "linkedin", "x"]).describe("The targeted destination social platform"),
      brandProfile: z.enum(["cosmetics", "automotive", "infoproducts"]).describe("The specific vertical campaign strategy template")
    },
async ({ platform, brandProfile }) => {
       try {
         const technicalConstraints = PLATFORM_RULES[platform];
         const psychologicalStrategy = BRAND_STRATEGIES[brandProfile];
         
         if (!technicalConstraints || !psychologicalStrategy) {
           return {
             isError: true,
             content: [{ type: "text", text: `Invalid platform or brand profile configuration` }]
           };
         }

         return {
           content: [{
             type: "text",
             text: JSON.stringify({
               status: "ROUTED_SUCCESSFULLY",
               routing_fingerprint: `${brandProfile}:${platform}`,
               enforced_technical_boundaries: {
                 target_platform: platform,
                 max_text_characters: technicalConstraints.maxCharacterCount,
                 max_file_payload_mb: technicalConstraints.maxAssetSizeMB,
                 validated_aspect_ratios: technicalConstraints.allowedAspectRatios,
                 ui_layout_instructions: technicalConstraints.preferredFormatting,
                 tag_policy: technicalConstraints.hashtagStrategy
               },
               enforced_content_guardrails: {
                 brand_identity: brandProfile,
                 required_tone: psychologicalStrategy.toneOfVoice,
                 demographic_focus: psychologicalStrategy.targetAudience,
                 suggested_hook_angles: psychologicalStrategy.primaryHooks
               }
             }, null, 2)
           }]
         };

       } catch (error: any) {
         return {
           isError: true,
           content: [{ type: "text", text: `Policy routing catastrophic error: ${error.message}` }]
         };
       }
     }
  );
}