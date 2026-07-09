// src/utils/command_validator.ts

export type OptimizeProfile = "instagram_reels" | "facebook_feed" | "standard_image";

export const getFfmpegArgsForProfile = (profile: OptimizeProfile, input: string, output: string): string[] => {
  const baseArgs = ["-y", "-i", input];
  
  switch (profile) {
    case "instagram_reels":
      return [...baseArgs, "-c:v", "libx264", "-crf", "23", "-vf", "crop=ih*(9/16):ih,scale=1080:-2", output];
    case "facebook_feed":
      return [...baseArgs, "-c:v", "libx264", "-b:v", "2M", "-vf", "scale=1080:-2", output];
    case "standard_image":
      return [...baseArgs, "-vf", "scale='min(1080,iw)':-1", output];
    default:
      throw new Error("Invalid optimization profile selected.");
  }
};

export class CommandValidator {
    private static readonly ALLOWED_FFMPEG_FLAGS = new Set([
        '-i', '-vcodec', '-acodec', '-preset', '-crf', '-y'
    ]);

    public static validateFFmpegArgs(args: string[]): boolean {
        const metaPattern = /[;&|><$]/;
        if (args.some(arg => metaPattern.test(arg))) return false;

        return args.every(arg => 
            !arg.startsWith('-') || this.ALLOWED_FFMPEG_FLAGS.has(arg)
        );
    }
}
