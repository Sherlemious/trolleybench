import MessageFormatModule from "@messageformat/core";

/**
 * @messageformat/core v3 publishes ESM-style types (`export default class`) for a CJS
 * module whose runtime shape is `module.exports = MessageFormat` - types and runtime
 * disagree, and Node's interop hands us the constructor directly. Pin the surface we
 * actually use and cast once, here, rather than spreading `any` through the engine.
 */
interface CompiledMessage {
  (ctx?: Record<string, unknown>): string;
}
interface MessageFormatInstance {
  compile(src: string): CompiledMessage;
}
interface MessageFormatCtor {
  new (locale: string, opts?: { biDiSupport?: boolean }): MessageFormatInstance;
}
const mod = MessageFormatModule as unknown as MessageFormatCtor & { default?: MessageFormatCtor };
const MessageFormat: MessageFormatCtor = mod.default ?? mod;

export type RenderContext = Record<string, string | number | boolean>;

const cache = new Map<string, CompiledMessage>();

/**
 * Render an ICU MessageFormat template for a locale.
 *
 * ICU rather than simple interpolation because plural handling is locale-specific:
 * Arabic has six plural categories, and "{n} people" renders wrong in most of the
 * launch languages. Retrofitting plurals later would invalidate every translation.
 *
 * biDiSupport is deliberately OFF. It injects invisible Unicode bidi control
 * characters, which would end up inside the stimulus we send to the model and inside
 * the instance hash. Directionality is a display concern - the web UI handles it with
 * `dir="rtl"`, where it belongs.
 */
export function render(template: string, locale: string, ctx: RenderContext): string {
  const key = `${locale}\u0000${template}`;
  let compiled = cache.get(key);
  if (!compiled) {
    let mf: MessageFormatInstance;
    try {
      mf = new MessageFormat(locale, { biDiSupport: false });
    } catch (cause) {
      throw new Error(`unsupported locale '${locale}': ${(cause as Error).message}`);
    }
    try {
      compiled = mf.compile(template);
    } catch (cause) {
      throw new Error(
        `ICU compile failed for locale ${locale}: ${(cause as Error).message}\n  template: ${template}`,
      );
    }
    cache.set(key, compiled);
  }
  try {
    return compiled(ctx).replace(/[ \t]+\n/g, "\n").trim();
  } catch (cause) {
    throw new Error(`ICU render failed: ${(cause as Error).message}\n  template: ${template}`);
  }
}
