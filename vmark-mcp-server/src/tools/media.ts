/**
 * Media composite tool — math, diagrams, SVG, wiki links, CJK formatting,
 * video, audio, and video embeds.
 *
 * Merges former vmark.ts + media.ts into a single tool.
 *
 * @coordinates-with hooks/mcpBridge/mediaHandlers.ts — frontend handler
 * @module tools/media
 */

import {
  VMarkMcpServer,
  getWindowIdArg,
  requireStringArg,
  getStringArg,
} from '../server.js';
import type { BridgeRequest } from '../bridge/types.js';

/** Escape a string for safe use in an HTML attribute value. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
const ALLOWED_SCHEMES = /^(https?|file):\/\//i;

export function registerMediaTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'media',
      description:
        'Insert math, diagrams, media, wiki links, and CJK formatting.\n\n' +
        'Actions:\n' +
        '- math_inline: Insert inline LaTeX (param: latex)\n' +
        '- math_block: Insert block LaTeX equation (param: latex)\n' +
        '- mermaid: Insert Mermaid diagram (param: code)\n' +
        '- markmap: Insert Markmap mindmap (param: code)\n' +
        '- svg: Insert SVG graphic (param: code)\n' +
        '- wiki_link: Insert [[target]] wiki link (params: target, displayText?)\n' +
        '- video: Insert HTML5 video (params: src, baseRevision, title?, poster?)\n' +
        '- audio: Insert HTML5 audio (params: src, baseRevision, title?)\n' +
        '- video_embed: Insert iframe video embed (params: videoId, baseRevision, provider?)\n' +
        '- cjk_punctuation: Convert CJK punctuation (param: direction)\n' +
        '- cjk_spacing: Fix CJK-Latin spacing (param: spacingAction)',
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: [
              'math_inline', 'math_block', 'mermaid', 'markmap', 'svg',
              'wiki_link', 'video', 'audio', 'video_embed',
              'cjk_punctuation', 'cjk_spacing',
            ],
          },
          latex: { type: 'string', description: 'LaTeX expression (for math_inline, math_block).' },
          code: { type: 'string', description: 'Diagram/SVG code (for mermaid, markmap, svg).' },
          target: { type: 'string', description: 'Wiki link target (for wiki_link).' },
          displayText: { type: 'string', description: 'Wiki link display text (for wiki_link).' },
          src: { type: 'string', description: 'Media URL/path (for video, audio).' },
          title: { type: 'string', description: 'Title attribute (for video, audio).' },
          poster: { type: 'string', description: 'Poster image URL (for video).' },
          videoId: { type: 'string', description: 'Video ID (for video_embed).' },
          provider: {
            type: 'string',
            enum: ['youtube', 'vimeo', 'bilibili'],
            description: 'Video provider (for video_embed, default: youtube).',
          },
          baseRevision: { type: 'string', description: 'Document revision (for video, audio, video_embed).' },
          direction: {
            type: 'string',
            enum: ['to-fullwidth', 'to-halfwidth'],
            description: 'Conversion direction (for cjk_punctuation).',
          },
          spacingAction: {
            type: 'string',
            enum: ['add', 'remove'],
            description: 'Add or remove CJK spacing (for cjk_spacing).',
          },
          windowId: { type: 'string', description: 'Optional window identifier.' },
        },
      },
    },
    async (args) => {
      const action = args.action as string;
      const windowId = getWindowIdArg(args);

      switch (action) {
        case 'math_inline':
          return handleMathInline(server, windowId, args);
        case 'math_block':
          return handleMathBlock(server, windowId, args);
        case 'mermaid':
          return handleMermaid(server, windowId, args);
        case 'markmap':
          return handleMarkmap(server, windowId, args);
        case 'svg':
          return handleSvg(server, windowId, args);
        case 'wiki_link':
          return handleWikiLink(server, windowId, args);
        case 'video':
          return handleVideo(server, windowId, args);
        case 'audio':
          return handleAudio(server, windowId, args);
        case 'video_embed':
          return handleVideoEmbed(server, windowId, args);
        case 'cjk_punctuation':
          return handleCjkPunctuation(server, windowId, args);
        case 'cjk_spacing':
          return handleCjkSpacing(server, windowId, args);
        default:
          return VMarkMcpServer.errorResult(`Unknown media action: ${action}`);
      }
    }
  );
}

// --- Math ---

async function handleMathInline(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const latex = requireStringArg(args, 'latex');
    await server.sendBridgeRequest<null>({ type: 'vmark.insertMathInline', latex, windowId });
    return VMarkMcpServer.successResult(`Inserted inline math: ${latex}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert inline math: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleMathBlock(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const latex = requireStringArg(args, 'latex');
    await server.sendBridgeRequest<null>({ type: 'vmark.insertMathBlock', latex, windowId });
    return VMarkMcpServer.successResult('Inserted block math equation');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert block math: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- Diagrams ---

async function handleMermaid(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const code = requireStringArg(args, 'code');
    await server.sendBridgeRequest<null>({ type: 'vmark.insertMermaid', code, windowId });
    return VMarkMcpServer.successResult('Inserted Mermaid diagram');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert Mermaid diagram: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleMarkmap(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const code = requireStringArg(args, 'code');
    await server.sendBridgeRequest<null>({ type: 'vmark.insertMarkmap', code, windowId });
    return VMarkMcpServer.successResult('Inserted Markmap mindmap');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert Markmap mindmap: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleSvg(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const code = requireStringArg(args, 'code');
    await server.sendBridgeRequest<null>({ type: 'vmark.insertSvg', code, windowId });
    return VMarkMcpServer.successResult('Inserted SVG graphic');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert SVG graphic: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- Wiki Link ---

async function handleWikiLink(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const target = requireStringArg(args, 'target');
    const displayText = getStringArg(args, 'displayText');
    await server.sendBridgeRequest<null>({
      type: 'vmark.insertWikiLink',
      target,
      displayText,
      windowId,
    });
    const linkText = displayText ? `[[${target}|${displayText}]]` : `[[${target}]]`;
    return VMarkMcpServer.successResult(`Inserted wiki link: ${linkText}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert wiki link: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- Video / Audio ---

async function handleVideo(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
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

    const request: BridgeRequest = { type: 'insertMedia', mediaHtml: html, baseRevision, windowId };
    const result = await server.sendBridgeRequest(request);
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert video: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleAudio(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
    const src = requireStringArg(args, 'src');
    if (!ALLOWED_SCHEMES.test(src)) {
      return VMarkMcpServer.errorResult('src must use http, https, or file protocol');
    }
    const baseRevision = requireStringArg(args, 'baseRevision');
    const title = getStringArg(args, 'title');

    const attrs: string[] = [`src="${escapeAttr(src)}"`, 'controls'];
    if (title) attrs.push(`title="${escapeAttr(title)}"`);
    const html = `<audio ${attrs.join(' ')}></audio>`;

    const request: BridgeRequest = { type: 'insertMedia', mediaHtml: html, baseRevision, windowId };
    const result = await server.sendBridgeRequest(request);
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert audio: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleVideoEmbed(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  try {
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

    const request: BridgeRequest = { type: 'insertMedia', mediaHtml: html, baseRevision, windowId };
    const result = await server.sendBridgeRequest(request);
    return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to insert video embed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// --- CJK ---

async function handleCjkPunctuation(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  const direction = requireStringArg(args, 'direction');
  if (direction !== 'to-fullwidth' && direction !== 'to-halfwidth') {
    return VMarkMcpServer.errorResult('direction must be "to-fullwidth" or "to-halfwidth"');
  }

  try {
    await server.sendBridgeRequest<null>({
      type: 'vmark.cjkPunctuationConvert',
      direction,
      windowId,
    });
    return VMarkMcpServer.successResult(`Converted punctuation ${direction}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to convert punctuation: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleCjkSpacing(
  server: VMarkMcpServer, windowId: string, args: Record<string, unknown>
) {
  const spacingAction = requireStringArg(args, 'spacingAction');
  if (spacingAction !== 'add' && spacingAction !== 'remove') {
    return VMarkMcpServer.errorResult('spacingAction must be "add" or "remove"');
  }

  try {
    await server.sendBridgeRequest<null>({
      type: 'vmark.cjkSpacingFix',
      action: spacingAction,
      windowId,
    });
    return VMarkMcpServer.successResult(
      spacingAction === 'add' ? 'Added CJK spacing' : 'Removed CJK spacing'
    );
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to fix CJK spacing: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
