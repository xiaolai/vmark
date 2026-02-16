/**
 * Media Insert Tools
 *
 * Purpose: MCP tools for inserting video, audio, and YouTube embeds. Each tool
 * builds an HTML tag and sends it via the bridge as an insertMedia request.
 * The frontend pipeline promotes the HTML to block_video, block_audio, or
 * youtube_embed nodes.
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

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

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

  // insert_youtube tool
  server.registerTool(
    {
      name: 'insert_youtube',
      description:
        'Insert a YouTube embed into the document. ' +
        'Generates a privacy-enhanced iframe (youtube-nocookie.com).',
      inputSchema: {
        type: 'object',
        properties: {
          videoId: {
            type: 'string',
            description: 'YouTube video ID (e.g., "dQw4w9WgXcQ").',
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

      if (!YOUTUBE_ID_RE.test(videoId)) {
        return VMarkMcpServer.errorResult(
          `Invalid YouTube video ID: "${videoId}". Must be exactly 11 alphanumeric characters (plus - and _).`
        );
      }

      const html = `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}" width="560" height="315" frameborder="0" allowfullscreen></iframe>`;

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
          `Failed to insert YouTube embed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
