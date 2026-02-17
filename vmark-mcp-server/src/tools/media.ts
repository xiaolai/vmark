/**
 * Media Insert Tools
 *
 * Purpose: MCP tools for inserting video, audio, and video embeds. Each tool
 * builds an HTML tag and sends it via the bridge as an insertMedia request.
 * The frontend pipeline promotes the HTML to block_video, block_audio, or
 * video_embed nodes.
 *
 * @coordinates-with hooks/mcpBridge/mediaHandlers.ts — frontend handler
 * @module tools/media
 */

import { VMarkMcpServer, resolveWindowId, requireStringArg, getStringArg } from '../server.js';
import type { BridgeRequest } from '../bridge/types.js';

/** Escape a string for safe use in an HTML attribute value. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Provider ID validation patterns — keep in sync with src/utils/videoProviderRegistry.ts
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const VIMEO_ID_RE = /^\d+$/;
const BILIBILI_BV_RE = /^BV[a-zA-Z0-9]{10}$/;

type VideoProvider = 'youtube' | 'vimeo' | 'bilibili';

interface ProviderEmbed {
  buildUrl: (videoId: string) => string;
  validateId: (videoId: string) => boolean;
  idDescription: string;
  defaultWidth: number;
  defaultHeight: number;
}

const PROVIDER_EMBEDS: Record<VideoProvider, ProviderEmbed> = {
  youtube: {
    buildUrl: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
    validateId: (id) => YOUTUBE_ID_RE.test(id),
    idDescription: 'Must be exactly 11 alphanumeric characters (plus - and _).',
    defaultWidth: 560,
    defaultHeight: 315,
  },
  vimeo: {
    buildUrl: (id) => `https://player.vimeo.com/video/${id}`,
    validateId: (id) => VIMEO_ID_RE.test(id),
    idDescription: 'Must be a numeric Vimeo video ID.',
    defaultWidth: 560,
    defaultHeight: 315,
  },
  bilibili: {
    buildUrl: (id) => `https://player.bilibili.com/player.html?bvid=${id}`,
    validateId: (id) => BILIBILI_BV_RE.test(id),
    idDescription: 'Must be a Bilibili BV ID (e.g., "BV1xx411c7mD").',
    defaultWidth: 560,
    defaultHeight: 350,
  },
};

const VALID_PROVIDERS = Object.keys(PROVIDER_EMBEDS);

/** Only allow safe URL schemes for media src attributes. */
const ALLOWED_SCHEMES = /^(https?|file):\/\//i;

export function registerMediaTools(server: VMarkMcpServer): void {
  // insert_video tool
  server.registerTool(
    {
      name: 'insert_video',
      description:
        'Insert a video element into the document. ' +
        'Generates an HTML5 <video> tag with the specified source path or URL.',
      inputSchema: {
        type: 'object',
        properties: {
          src: {
            type: 'string',
            description: 'Video file path (relative or absolute) or URL.',
          },
          title: {
            type: 'string',
            description: 'Optional title attribute for the video.',
          },
          poster: {
            type: 'string',
            description: 'Optional poster image path or URL.',
          },
          baseRevision: {
            type: 'string',
            description: 'The document revision this insert is based on.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['src', 'baseRevision'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const src = requireStringArg(args, 'src');
      if (!ALLOWED_SCHEMES.test(src)) {
        return VMarkMcpServer.errorResult('src must use http, https, or file protocol');
      }
      const baseRevision = requireStringArg(args, 'baseRevision');
      const title = getStringArg(args, 'title');
      const poster = getStringArg(args, 'poster');

      const attrs: string[] = [`src="${escapeAttr(src)}"`, 'controls'];
      if (title) attrs.push(`title="${escapeAttr(title)}"`);
      if (poster) attrs.push(`poster="${escapeAttr(poster)}"`);

      const html = `<video ${attrs.join(' ')}></video>`;

      try {
        const request: BridgeRequest = {
          type: 'insertMedia',
          mediaHtml: html,
          baseRevision,
          windowId,
        };
        const result = await server.sendBridgeRequest(request);
        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert video: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // insert_audio tool
  server.registerTool(
    {
      name: 'insert_audio',
      description:
        'Insert an audio element into the document. ' +
        'Generates an HTML5 <audio> tag with the specified source path or URL.',
      inputSchema: {
        type: 'object',
        properties: {
          src: {
            type: 'string',
            description: 'Audio file path (relative or absolute) or URL.',
          },
          title: {
            type: 'string',
            description: 'Optional title attribute for the audio.',
          },
          baseRevision: {
            type: 'string',
            description: 'The document revision this insert is based on.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['src', 'baseRevision'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const src = requireStringArg(args, 'src');
      if (!ALLOWED_SCHEMES.test(src)) {
        return VMarkMcpServer.errorResult('src must use http, https, or file protocol');
      }
      const baseRevision = requireStringArg(args, 'baseRevision');
      const title = getStringArg(args, 'title');

      const attrs: string[] = [`src="${escapeAttr(src)}"`, 'controls'];
      if (title) attrs.push(`title="${escapeAttr(title)}"`);

      const html = `<audio ${attrs.join(' ')}></audio>`;

      try {
        const request: BridgeRequest = {
          type: 'insertMedia',
          mediaHtml: html,
          baseRevision,
          windowId,
        };
        const result = await server.sendBridgeRequest(request);
        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert audio: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // insert_video_embed tool (supports YouTube, Vimeo, Bilibili)
  server.registerTool(
    {
      name: 'insert_video_embed',
      description:
        'Insert a video embed (iframe) into the document. ' +
        'Supports YouTube (privacy-enhanced), Vimeo, and Bilibili. ' +
        'Generates a provider-specific iframe tag.',
      inputSchema: {
        type: 'object',
        properties: {
          videoId: {
            type: 'string',
            description: 'Video ID. YouTube: 11-char ID (e.g., "dQw4w9WgXcQ"). Vimeo: numeric ID (e.g., "123456789"). Bilibili: BV ID (e.g., "BV1xx411c7mD").',
          },
          provider: {
            type: 'string',
            description: 'Video provider: "youtube" (default), "vimeo", or "bilibili".',
            enum: ['youtube', 'vimeo', 'bilibili'],
          },
          baseRevision: {
            type: 'string',
            description: 'The document revision this insert is based on.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['videoId', 'baseRevision'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const videoId = requireStringArg(args, 'videoId');
      const baseRevision = requireStringArg(args, 'baseRevision');
      const provider = (getStringArg(args, 'provider') ?? 'youtube') as VideoProvider;

      if (!VALID_PROVIDERS.includes(provider)) {
        return VMarkMcpServer.errorResult(
          `Invalid provider: "${provider}". Must be one of: ${VALID_PROVIDERS.join(', ')}.`
        );
      }

      const embed = PROVIDER_EMBEDS[provider];
      if (!embed.validateId(videoId)) {
        return VMarkMcpServer.errorResult(
          `Invalid ${provider} video ID: "${videoId}". ${embed.idDescription}`
        );
      }

      const embedUrl = embed.buildUrl(videoId);
      const html = `<iframe src="${embedUrl}" width="${embed.defaultWidth}" height="${embed.defaultHeight}" frameborder="0" allowfullscreen></iframe>`;

      try {
        const request: BridgeRequest = {
          type: 'insertMedia',
          mediaHtml: html,
          baseRevision,
          windowId,
        };
        const result = await server.sendBridgeRequest(request);
        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert video embed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

}
