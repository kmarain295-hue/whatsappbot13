import { memo } from 'react';
import { classNames } from '~/utils/classNames';

/*
 * Renders the result of an SDK-powered tool call with purpose-built UI instead
 * of a raw JSON dump. Each SDK tool sets a `tool` field on its result object
 * (see app/lib/.server/llm/sdk-tools.ts) — we branch on it here.
 *
 * This is intentionally minimal: it only handles the well-known SDK tool result
 * shapes and falls back to a <pre> for anything unexpected, so it never breaks
 * the existing MCP tool-result rendering.
 */

interface SdkToolResultProps {
  result: any;
}

interface SdkResultShape {
  tool: string;
  error?: string;
  [key: string]: unknown;
}

function isSdkResult(result: any): result is SdkResultShape {
  return result && typeof result === 'object' && typeof result.tool === 'string';
}

export const SdkToolResult = memo(({ result }: SdkToolResultProps) => {
  if (!isSdkResult(result)) {
    return null;
  }

  // Error results share an `error` field regardless of tool.
  if (typeof result.error === 'string') {
    return (
      <div className="text-xs text-red-500 flex items-center gap-1.5">
        <div className="i-ph:warning-circle w-4 h-4 shrink-0" />
        <span>{result.error}</span>
      </div>
    );
  }

  const tool = result.tool as string;

  switch (tool) {
    case 'image_generation':
    case 'image_editing':
      return <ImageResult result={result} />;

    case 'text_to_speech':
      return <AudioResult result={result} />;

    case 'video_generation':
      return <VideoResult result={result} />;

    case 'image_search':
      return <ImageSearchResult result={result} />;

    case 'web_search':
      return <WebSearchResult result={result} />;

    case 'page_reader':
      return <PageReaderResult result={result} />;

    case 'vision_ocr':
    case 'speech_to_text':
      return <TextResult result={result} />;

    default:
      // Unknown SDK tool — show a compact JSON view as a safe fallback.
      return (
        <pre className="text-xs text-bolt-elements-textPrimary whitespace-pre-wrap break-words m-0">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
  }
});

SdkToolResult.displayName = 'SdkToolResult';

/* ----------------------------- sub-renderers ----------------------------- */

function ImageResult({ result }: { result: any }) {
  if (!result.image_base64) {
    return <FallbackNote note={result.note} />;
  }

  const mime = result.mime || 'image/png';
  const dataUrl = `data:${mime};base64,${result.image_base64}`;
  const ext = mime.split('/')[1] || 'png';

  return (
    <div className="space-y-2">
      {result.prompt && <p className="text-xs text-bolt-elements-textSecondary italic">"{result.prompt}"</p>}
      <a href={dataUrl} target="_blank" rel="noreferrer" className="block">
        <img
          src={dataUrl}
          alt={result.prompt || 'Generated image'}
          className="max-w-full max-h-80 rounded-lg border border-bolt-elements-borderColor"
        />
      </a>
      <div className="flex items-center gap-3">
        <a
          href={dataUrl}
          download={`alphacode-image-${Date.now()}.${ext}`}
          className="inline-flex items-center gap-1 text-xs text-purple-500 hover:text-purple-600 hover:underline"
        >
          <span className="i-ph:download-simple w-3.5 h-3.5" />
          Download image
        </a>
        <span className="text-[11px] text-bolt-elements-textTertiary">Click image to open full size</span>
      </div>
    </div>
  );
}

function AudioResult({ result }: { result: any }) {
  if (!result.audio_base64) {
    return <FallbackNote note={result.note} />;
  }

  const mime = result.mime || 'audio/wav';
  const dataUrl = `data:${mime};base64,${result.audio_base64}`;

  return (
    <div className="space-y-1.5">
      <audio controls preload="metadata" src={dataUrl} className="w-full" style={{ minHeight: '32px' }}>
        Your browser does not support the audio element.
      </audio>
      <div className="flex items-center gap-3">
        <a
          href={dataUrl}
          download={`alphacode-tts-${Date.now()}.wav`}
          className="inline-flex items-center gap-1 text-xs text-purple-500 hover:text-purple-600 hover:underline"
        >
          <span className="i-ph:download-simple w-3.5 h-3.5" />
          Download audio
        </a>
        <span className="text-[11px] text-bolt-elements-textTertiary">({mime})</span>
      </div>
    </div>
  );
}

function VideoResult({ result }: { result: any }) {
  if (!result.video_url) {
    return <FallbackNote note={result.error ? String(result.error) : 'No video URL returned.'} />;
  }

  return (
    <div className="space-y-2">
      {result.prompt && <p className="text-xs text-bolt-elements-textSecondary italic">"{result.prompt}"</p>}
      <video
        controls
        src={result.video_url}
        className="max-w-full max-h-80 rounded-lg border border-bolt-elements-borderColor"
      >
        Your browser does not support the video element.
      </video>
    </div>
  );
}

function ImageSearchResult({ result }: { result: any }) {
  const results: any[] = result.results || [];

  if (results.length === 0) {
    return <FallbackNote note="No images found." />;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-bolt-elements-textSecondary">
        {results.length} image(s) found for "{result.query}"
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {results.map((img, i) => (
          <a
            key={i}
            href={img.url}
            target="_blank"
            rel="noreferrer"
            className="block group/img rounded-md overflow-hidden border border-bolt-elements-borderColor hover:border-purple-400 transition-colors"
            title={img.caption || ''}
          >
            <img
              src={img.url}
              alt={img.caption || ''}
              className="w-full h-24 object-cover group-hover/img:opacity-90 transition-opacity"
              loading="lazy"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

function WebSearchResult({ result }: { result: any }) {
  const results: any[] = result.results || [];

  if (results.length === 0) {
    return <FallbackNote note="No results found." />;
  }

  return (
    <ul className="space-y-2">
      {results.map((r, i) => (
        <li key={i} className="text-xs">
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="text-purple-500 hover:text-purple-600 font-medium hover:underline"
          >
            {r.title || r.url}
          </a>
          {r.source && <span className="text-bolt-elements-textTertiary ml-1">· {r.source}</span>}
          {r.snippet && <p className="text-bolt-elements-textSecondary mt-0.5 leading-relaxed">{r.snippet}</p>}
        </li>
      ))}
    </ul>
  );
}

function PageReaderResult({ result }: { result: any }) {
  return (
    <div className="space-y-1">
      {result.title && <p className="text-xs font-semibold text-bolt-elements-textPrimary">{result.title}</p>}
      {result.url && (
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-purple-500 hover:underline break-all"
        >
          {result.url}
        </a>
      )}
      {result.content && (
        <pre
          className={classNames(
            'text-xs text-bolt-elements-textSecondary whitespace-pre-wrap break-words',
            'max-h-60 overflow-y-auto mt-1 p-2 rounded bg-black/5 dark:bg-white/5',
          )}
        >
          {stripHtml(result.content)}
        </pre>
      )}
    </div>
  );
}

function TextResult({ result }: { result: any }) {
  const text = result.result || result.transcript || '';

  if (!text) {
    return <FallbackNote note="No text returned." />;
  }

  return (
    <pre className="text-xs text-bolt-elements-textPrimary whitespace-pre-wrap break-words m-0 max-h-60 overflow-y-auto">
      {text}
    </pre>
  );
}

function FallbackNote({ note }: { note?: string }) {
  if (!note) {
    return null;
  }

  return <p className="text-xs text-bolt-elements-textSecondary">{note}</p>;
}

/** Strips HTML tags to produce plain text for the page-reader preview. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

export default SdkToolResult;
